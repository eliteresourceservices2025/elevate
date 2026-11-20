import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage } from "./fake-storage";
import { nextVersion } from "./release-test-helpers";

// Creating, building, publishing and withdrawing releases, against a real database.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/activity/release-actions");
const service = await import("@/modules/activity/releases-service");
const queries = await import("@/modules/activity/release-queries");
const { pickUpdate } = await import("@/modules/activity/releases-logic");
const { setDocumentStorage } = await import("@/modules/documents/storage");

const fake = new FakeStorage();
setDocumentStorage(fake);
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let counter = 0;
async function user(roles: RoleSlug[]) {
  const id = randomUUID();
  const email = `rel${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
// Versions far above anything else, rising by one each time, so a new release is always the highest.
const notes = { added: "A new thing", improved: "", fixed: "" };
const base = { minRequired: false, addsCollection: false, policyVersionId: null };

const make = async (over: Record<string, unknown> = {}) => {
  const version = (over.version as string) ?? (await nextVersion());
  const r = await actions.createRelease({ version, ...notes, ...base, ...over });
  if (!r.ok) throw new Error(r.error);
  return { id: r.data.id, version };
};
const addBuilds = async (version: string, platforms: ("windows-x86_64" | "darwin-aarch64")[] = ["windows-x86_64"]) => {
  for (const platform of platforms) {
    for (const kind of ["installer", "update"] as const) {
      const res = await service.registerBuild({ version, platform, kind, storagePath: `releases/${version}/${platform}/${kind}/${randomUUID()}.exe`, fileName: "app.exe", sizeBytes: 1_000_000, sha256: "a".repeat(64), signature: kind === "update" ? "SIGTEXT" : null });
      if (!res.ok) throw new Error(res.error);
    }
  }
};
async function publishedMonitoringVersion(): Promise<string> {
  const [p] = await rows<{ id: string }>(sql`select id from docs.policies where kind = 'monitoring'`);
  const [v] = await rows<{ id: string }>(sql`
    insert into docs.policy_versions (policy_id, version, body, status, requires_ack, published_by, published_at)
    select ${p.id}, coalesce(max(version), 0) + 1, 'Test monitoring policy', 'published', false, ${randomUUID()}, now() from docs.policy_versions where policy_id = ${p.id} returning id`);
  return v.id;
}

describe("createRelease", () => {
  it("makes a draft with cleaned-up notes, and audits the id and version only", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const version = await nextVersion();
    const r = await make({ version, added: "  New page \n\n", fixed: "Fixed it" });
    const [row] = await rows<{ status: string; notes_added: string[]; notes_fixed: string[] }>(sql`select status, notes_added, notes_fixed from time.tracker_releases where id = ${r.id}`);
    expect(row).toEqual({ status: "draft", notes_added: ["New page"], notes_fixed: ["Fixed it"] });
    const [a] = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'tracker.release_created' and target_id = ${r.id}`);
    expect(a.metadata).toEqual({ version });
  });

  it("refuses a version that is not higher than every earlier one, an empty note and a bad version", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const high = await make();
    expect((await actions.createRelease({ version: "0.0.1", ...notes, ...base })).ok).toBe(false); // lower than the release made just above
    expect((await actions.createRelease({ version: high.version, ...notes, ...base })).ok).toBe(false);
    expect((await actions.createRelease({ version: await nextVersion(), added: "", improved: "", fixed: "", ...base })).ok).toBe(false);
    expect((await actions.createRelease({ version: "1.2", ...notes, ...base })).ok).toBe(false);
  });
});

describe("publishRelease", () => {
  it("is refused with no builds, and with an installer but no update build for its platform", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const r = await make();
    expect((await actions.publishRelease({ id: r.id })).ok).toBe(false);
    await service.registerBuild({ version: r.version, platform: "windows-x86_64", kind: "installer", storagePath: `releases/${randomUUID()}`, fileName: "a.exe", sizeBytes: 1_000_000, sha256: "b".repeat(64), signature: null });
    const res = await actions.publishRelease({ id: r.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/update/i);
  });

  it("is refused for a release that adds data collection without a published monitoring policy version", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const none = await make({ addsCollection: true });
    await addBuilds(none.version);
    expect((await actions.publishRelease({ id: none.id })).ok).toBe(false);
    const [p] = await rows<{ id: string }>(sql`select id from docs.policies where kind = 'monitoring'`);
    // Only one draft is allowed per policy: use the one that is there, or make one.
    const [existing] = await rows<{ id: string }>(sql`select id from docs.policy_versions where policy_id = ${p.id} and status = 'draft'`);
    const draft = existing ?? (await rows<{ id: string }>(sql`insert into docs.policy_versions (policy_id, version, body, status, requires_ack) select ${p.id}, coalesce(max(version), 0) + 1, 'Draft', 'draft', false from docs.policy_versions where policy_id = ${p.id} returning id`))[0];
    const withDraft = await make({ addsCollection: true, policyVersionId: draft.id });
    await addBuilds(withDraft.version);
    expect((await actions.publishRelease({ id: withDraft.id })).ok).toBe(false);
    const good = await make({ addsCollection: true, policyVersionId: await publishedMonitoringVersion() });
    await addBuilds(good.version);
    expect((await actions.publishRelease({ id: good.id })).ok).toBe(true);
  });

  it("works once, audits id and version only, and a second publish is refused", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const r = await make();
    await addBuilds(r.version);
    expect((await actions.publishRelease({ id: r.id })).ok).toBe(true);
    expect((await actions.publishRelease({ id: r.id })).ok).toBe(false);
    const [a] = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'tracker.release_published' and target_id = ${r.id}`);
    expect(a.metadata).toEqual({ version: r.version });
  });

  it("is refused when a higher release was published while this one was a draft", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const early = await make();
    const later = await make();
    await addBuilds(early.version);
    await addBuilds(later.version);
    expect((await actions.publishRelease({ id: later.id })).ok).toBe(true);
    expect((await actions.publishRelease({ id: early.id })).ok).toBe(false);
  });
});

describe("withdrawRelease and what is offered", () => {
  it("marks it withdrawn, and the previous published release is offered again", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const a = await make();
    await addBuilds(a.version);
    await actions.publishRelease({ id: a.id });
    const b = await make();
    await addBuilds(b.version);
    await actions.publishRelease({ id: b.id });
    expect((await actions.withdrawRelease({ id: b.id })).ok).toBe(true);
    expect((await actions.withdrawRelease({ id: b.id })).ok).toBe(false);
    const all = await service.getPublishedReleases();
    expect(all.find((r) => r.version === b.version)?.status).toBe("withdrawn");
    const offered = pickUpdate({
      platform: "windows-x86_64",
      currentVersion: `${a.version.split(".")[0]}.0.0`,
      published: all.map((r) => ({ version: r.version, status: r.status, platforms: r.builds.filter((x) => x.kind === "update").map((x) => x.platform) })),
    });
    expect(offered).not.toBe(b.version);
    expect(offered).toBe(a.version);
  });
});

describe("a required release cannot lock a platform out", () => {
  it("is refused when an earlier published release had a Mac update this one lacks, and allowed once it has one", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const a = await make();
    await addBuilds(a.version, ["windows-x86_64", "darwin-aarch64"]);
    expect((await actions.publishRelease({ id: a.id })).ok).toBe(true);

    const b = await make({ minRequired: true });
    await addBuilds(b.version); // Windows only
    const refused = await actions.publishRelease({ id: b.id });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/darwin-aarch64/);

    const c = await make({ minRequired: true });
    await addBuilds(c.version, ["windows-x86_64", "darwin-aarch64"]);
    expect((await actions.publishRelease({ id: c.id })).ok).toBe(true);

    // A release that is not required may drop a platform.
    const d = await make();
    await addBuilds(d.version);
    expect((await actions.publishRelease({ id: d.id })).ok).toBe(true);

    // Withdrawn releases do not count, so other tests sharing this database are not held to these Mac builds.
    await actions.withdrawRelease({ id: a.id });
    await actions.withdrawRelease({ id: c.id });
  });
});

describe("deleteDraftRelease", () => {
  it("removes a draft with its builds, and refuses a published one", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const d = await make();
    await addBuilds(d.version);
    expect((await actions.deleteDraftRelease({ id: d.id })).ok).toBe(true);
    expect(await rows(sql`select 1 from time.tracker_releases where id = ${d.id}`)).toHaveLength(0);
    const p = await make();
    await addBuilds(p.version);
    await actions.publishRelease({ id: p.id });
    expect((await actions.deleteDraftRelease({ id: p.id })).ok).toBe(false);
  });
});

describe("registerBuild", () => {
  it("only accepts builds for an existing draft", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const none = await service.registerBuild({ version: "99.99.99", platform: "windows-x86_64", kind: "installer", storagePath: "x", fileName: "a.exe", sizeBytes: 1_000_000, sha256: "c".repeat(64), signature: null });
    expect(none.ok).toBe(false);
    const p = await make();
    await addBuilds(p.version);
    await actions.publishRelease({ id: p.id });
    const late = await service.registerBuild({ version: p.version, platform: "darwin-aarch64", kind: "installer", storagePath: `releases/${randomUUID()}`, fileName: "a.dmg", sizeBytes: 1_000_000, sha256: "d".repeat(64), signature: null });
    expect(late.ok).toBe(false);
  });
});

describe("listReleasesAdmin", () => {
  it("lists releases with their platforms for HR, newest version first", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const r = await make();
    await addBuilds(r.version, ["windows-x86_64", "darwin-aarch64"]);
    const list = await queries.listReleasesAdmin();
    const mine = list.find((x) => x.id === r.id);
    expect([...(mine?.platforms ?? [])].sort()).toEqual(["darwin-aarch64", "windows-x86_64"]);
    expect(list[0].id).toBe(r.id); // the newest version is first
  });
});

describe("getReleaseAdminView", () => {
  it("lists the releases and the published monitoring policy versions a release can name", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const versionId = await publishedMonitoringVersion();
    const r = await make();
    const view = await queries.getReleaseAdminView();
    expect(view.releases.some((x) => x.id === r.id)).toBe(true);
    const mine = view.policyVersions.find((v) => v.id === versionId);
    expect(mine?.label).toMatch(/^Version [0-9]+, published /);
  });
});
