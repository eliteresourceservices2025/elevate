import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { FakeStorage } from "./fake-storage";
import { nextVersion } from "./release-test-helpers";

// The download page's data and the installer route: who can download, what is audited, what is never offered.

const current = vi.hoisted(() => ({ user: null as unknown, signedOut: false }));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => {
    if (current.signedOut) throw new Error("NEXT_REDIRECT");
    return current.user;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const releaseActions = await import("@/modules/activity/release-actions");
const service = await import("@/modules/activity/releases-service");
const queries = await import("@/modules/activity/release-queries");
const installer = await import("@/app/api/tracker/download/[platform]/route");
const { setDocumentStorage } = await import("@/modules/documents/storage");

setDocumentStorage(new FakeStorage());
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let counter = 0;
async function user(roles: string[]) {
  const id = randomUUID();
  const email = `dl${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Down', 'Load', ${email}, 'active', ${id})`);
  return { id, email, roles };
}
async function publish(platforms: ("windows-x86_64" | "darwin-aarch64")[] = ["windows-x86_64"]) {
  const version = await nextVersion();
  const made = await releaseActions.createRelease({ version, added: "A thing", improved: "", fixed: "", minRequired: false, addsCollection: false, policyVersionId: null });
  if (!made.ok) throw new Error(made.error);
  for (const platform of platforms) {
    for (const kind of ["installer", "update"] as const) {
      const r = await service.registerBuild({ version, platform, kind, storagePath: `releases/${version}/${platform}/${kind}/${randomUUID()}.exe`, fileName: "ELEVATE-Tracker-setup.exe", sizeBytes: 1_000_000, sha256: "f".repeat(64), signature: kind === "update" ? "SIG" : null });
      if (!r.ok) throw new Error(r.error);
    }
  }
  const pub = await releaseActions.publishRelease({ id: made.data.id });
  if (!pub.ok) throw new Error(pub.error);
  return { id: made.data.id, version };
}
const call = (platform: string) => installer.GET(new Request(`http://localhost/api/tracker/download/${platform}`), { params: Promise.resolve({ platform }) });

describe("getDownloadPage", () => {
  it("shows published releases newest first, hides drafts and withdrawn ones, and the newest is current", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const a = await publish();
    const b = await publish();
    const withdrawn = await publish();
    await releaseActions.withdrawRelease({ id: withdrawn.id });
    const draft = await releaseActions.createRelease({ version: await nextVersion(), added: "Draft only", improved: "", fixed: "", minRequired: false, addsCollection: false, policyVersionId: null });
    expect(draft.ok).toBe(true);
    current.user = await user(["employee"]);
    const page = await queries.getDownloadPage();
    const versions = page.releases.map((r) => r.version);
    expect(versions).toContain(a.version);
    expect(versions).toContain(b.version);
    expect(versions).not.toContain(withdrawn.version);
    expect(page.releases.every((r) => r.status === "published")).toBe(true);
    expect(page.current?.version).toBe(b.version);
    expect(page.releases.map((r) => r.version).indexOf(b.version)).toBeLessThan(page.releases.map((r) => r.version).indexOf(a.version));
  });
});

describe("the installer route", () => {
  it("redirects a signed-in person to a 60-second link and audits platform and version only", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const rel = await publish();
    const person = await user(["employee"]);
    current.user = person;
    current.signedOut = false;
    const res = await call("windows-x86_64");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("fake://tracker-builds/");
    expect(res.headers.get("location")).toContain("expires=60");
    const [a] = await rows<{ metadata: Record<string, unknown>; target_id: string }>(sql`select metadata, target_id from ops.audit_log where action = 'tracker.download' and actor_email = ${person.email} order by id desc limit 1`);
    expect(a.metadata).toEqual({ platform: "windows-x86_64", version: rel.version });
    expect(JSON.stringify(a.metadata)).not.toMatch(/exe|releases\//);
  });
  it("answers 404 for a platform with no installer and for an unknown platform, and audits nothing for them", async () => {
    current.user = await user(["hr_admin", "employee"]);
    await publish(["windows-x86_64"]);
    const person = await user(["employee"]);
    current.user = person;
    expect((await call("darwin-aarch64")).status).toBe(404);
    expect((await call("linux")).status).toBe(404);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'tracker.download' and actor_email = ${person.email}`)).toHaveLength(0);
  });
  it("is not served to a signed-out visitor", async () => {
    current.signedOut = true;
    await expect(call("windows-x86_64")).rejects.toThrow("NEXT_REDIRECT");
    current.signedOut = false;
  });
  it("never offers a withdrawn release's installer: the previous release is served again", async () => {
    current.user = await user(["hr_admin", "employee"]);
    const good = await publish();
    const bad = await publish();
    await releaseActions.withdrawRelease({ id: bad.id });
    const person = await user(["employee"]);
    current.user = person;
    expect((await call("windows-x86_64")).status).toBe(302);
    const [a] = await rows<{ metadata: { version: string } }>(sql`select metadata from ops.audit_log where action = 'tracker.download' and actor_email = ${person.email} order by id desc limit 1`);
    expect(a.metadata.version).toBe(good.version);
  });
});
