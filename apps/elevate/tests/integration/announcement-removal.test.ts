import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Taking announcements and policies away: an announcement nobody acknowledged can be deleted for good (with what hangs off it);
// one people acknowledged is kept (archive only); a published policy can be archived, keeping its versions and acknowledgments.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/announcements/actions");
const popupActions = await import("@/modules/announcements/popup-actions");
const popupQueries = await import("@/modules/announcements/popup-queries");
const queries = await import("@/modules/announcements/queries");
const { todayInZone } = await import("@/modules/org/service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const today = todayInZone();
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const NO_ACCESS = "You do not have access to do that.";

async function person(label: string, roles: RoleSlug[] = ["employee"]) {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  const n = uniq(label);
  await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label}, ${n}, ${n + "@example.com"}, 'active', ${id})`);
  return { id, email, roles } as TestUser;
}
const idOf = (r: { ok: boolean; data?: { id: string }; error?: string }) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data!.id;
};
const count = async (q: ReturnType<typeof sql>) => (await rows<{ n: number }>(q))[0].n;

let hr: TestUser;
beforeAll(async () => {
  hr = await person("rm-hr", ["hr_admin", "employee"]);
});

const post = async (requiresAck: boolean) => {
  as(hr);
  return idOf(await actions.createAnnouncement({ title: uniq("Removal "), body: "Text.", audience: "all", teamIds: [], requiresAck }));
};

describe("deleting an announcement posted by mistake", () => {
  it("removes it and everything that hangs off it, when nobody acknowledged it", async () => {
    await person("rm-reader");
    const id = await post(true);
    expect((await popupActions.setPopup({ kind: "announcement", itemId: id, enabled: true, showFrom: today })).ok).toBe(true);
    expect(await count(sql`select count(*)::int as n from docs.announcement_recipients where announcement_id = ${id}::uuid`)).toBeGreaterThan(0);

    expect(await actions.deleteAnnouncement({ announcementId: id })).toEqual({ ok: true, data: undefined });
    for (const t of ["docs.announcements where id", "docs.announcement_recipients where announcement_id", "docs.popups where announcement_id", "docs.acknowledgment_reminders where announcement_id"]) {
      expect(await count(sql.raw(`select count(*)::int as n from ${t} = '${id}'::uuid`))).toBe(0);
    }
    expect(await queries.getAnnouncement(id)).toBeNull();
    // The audit entry says it happened, without the text
    const [audit] = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'announcement.delete' and target_id = ${id} limit 1`);
    expect(audit.metadata).toMatchObject({ files: 0 });
    expect(JSON.stringify(audit.metadata)).not.toContain("Text.");
  });

  it("is refused once someone acknowledged it (archive instead), and for anyone but HR", async () => {
    const reader = await person("rm-ack");
    const id = await post(true);
    as(reader);
    expect((await actions.acknowledge({ kind: "announcement", id })).ok).toBe(true);

    as(hr);
    const refused = await actions.deleteAnnouncement({ announcementId: id });
    expect(refused).toEqual({ ok: false, error: "People have already acknowledged this, and those records are kept. Archive it instead." });
    expect(await count(sql`select count(*)::int as n from docs.announcements where id = ${id}::uuid`)).toBe(1);
    expect((await actions.archiveAnnouncement({ announcementId: id })).ok).toBe(true);

    const other = await post(false);
    as(reader);
    expect(await actions.deleteAnnouncement({ announcementId: other })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await count(sql`select count(*)::int as n from docs.announcements where id = ${other}::uuid`)).toBe(1);
  });

  it("archiving takes an announcement out of the pop-up queue", async () => {
    const id = await post(false);
    as(hr);
    expect((await popupActions.setPopup({ kind: "announcement", itemId: id, enabled: true, showFrom: today })).ok).toBe(true);
    expect((await actions.archiveAnnouncement({ announcementId: id })).ok).toBe(true);
    expect(await count(sql`select count(*)::int as n from docs.popups where announcement_id = ${id}::uuid`)).toBe(0);
    expect((await popupQueries.listPopupQueue()).some((r) => r.itemId === id)).toBe(false);
  });
});

describe("archiving a published policy", () => {
  it("hides it and stops its pop-up and acknowledgment request, but keeps its versions and acknowledgments", async () => {
    const reader = await person("rm-pol");
    as(hr);
    const policyId = idOf(await actions.createPolicy({ title: uniq("Retire me "), body: "Version one.", requiresAck: true }));
    expect((await actions.publishDraft({ policyId })).ok).toBe(true);
    expect((await popupActions.setPopup({ kind: "policy", itemId: policyId, enabled: true, showFrom: today })).ok).toBe(true);
    const [v1] = await rows<{ id: string }>(sql`select id::text as id from docs.policy_versions where policy_id = ${policyId}::uuid and version = 1`);
    as(reader);
    expect((await actions.acknowledge({ kind: "policy_version", id: v1.id })).ok).toBe(true);
    expect((await queries.listMyPending()).some((p) => p.id === policyId)).toBe(false);

    const other = await person("rm-pol-2");
    as(other);
    expect((await queries.listMyPending()).some((p) => p.id === policyId)).toBe(true);

    as(hr);
    expect((await actions.archivePolicy({ policyId })).ok).toBe(true);
    as(other);
    expect((await queries.listMyPending()).some((p) => p.id === policyId)).toBe(false);
    expect((await popupQueries.listMyPopups()).some((p) => p.link.endsWith(policyId))).toBe(false);
    expect(await count(sql`select count(*)::int as n from docs.popups where policy_id = ${policyId}::uuid`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from docs.policy_versions where policy_id = ${policyId}::uuid and status = 'published'`)).toBe(1);
    expect(await count(sql`select count(*)::int as n from docs.acknowledgments where policy_version_id = ${v1.id}::uuid`)).toBe(1);
    as(hr);
    expect((await queries.listPolicies()).some((p) => p.id === policyId)).toBe(false);
  });

  it("still refuses the privacy notice and the monitoring policy, and non-HR", async () => {
    as(hr);
    const [special] = await rows<{ id: string }>(sql`select id::text as id from docs.policies where kind <> 'general' limit 1`);
    if (special) expect((await actions.archivePolicy({ policyId: special.id })).ok).toBe(false);
    const reader = await person("rm-pol-3");
    as(reader);
    expect(await actions.archivePolicy({ policyId: randomUUID() })).toEqual({ ok: false, error: NO_ACCESS });
  });
});
