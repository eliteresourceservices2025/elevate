import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// The sign-in pop-up queue: HR queues announcements and policies from a date and in an order; each person sees the ones that have
// come due, one at a time; one that needs acknowledgment stays until acknowledged, any other goes away once closed.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/announcements/actions");
const popupActions = await import("@/modules/announcements/popup-actions");
const popupQueries = await import("@/modules/announcements/popup-queries");
const { todayInZone } = await import("@/modules/org/service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const today = todayInZone();
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};

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

let hr: TestUser;
beforeAll(async () => {
  hr = await person("pop-hr", ["hr_admin", "employee"]);
});

/** A queued announcement, posted by HR to everyone. */
async function queuedAnnouncement(opts: { requiresAck: boolean; showFrom?: string }) {
  as(hr);
  const id = idOf(await actions.createAnnouncement({ title: uniq("Popup news "), body: "Read **this**.", audience: "all", teamIds: [], requiresAck: opts.requiresAck }));
  expect((await popupActions.setPopup({ kind: "announcement", itemId: id, enabled: true, showFrom: opts.showFrom ?? today })).ok).toBe(true);
  return id;
}

const mine = async (u: TestUser) => {
  as(u);
  return popupQueries.listMyPopups();
};

describe("sign-in pop-ups", () => {
  it("excludes the author even though HR can open the announcement page", async () => {
    const recipient = await person("pop-author-check");
    const id = await queuedAnnouncement({ requiresAck: false });
    expect((await mine(hr)).some((p) => p.subjectId === id)).toBe(false);
    expect((await mine(recipient)).some((p) => p.subjectId === id)).toBe(true);
    const [count] = await rows<{ n: number }>(sql`select count(*)::int as n from docs.announcement_recipients r join core.employees e on e.id = r.employee_id where r.announcement_id = ${id}::uuid and e.user_id = ${hr.id}`);
    expect(count.n).toBe(0);
  });

  it("changing a queued announcement's date does not reset an earlier dismissal or acknowledgment", async () => {
    const recipient = await person("pop-requeue");
    const closable = await queuedAnnouncement({ requiresAck: false });
    const required = await queuedAnnouncement({ requiresAck: true });
    as(recipient);
    expect((await popupActions.dismissPopup({ kind: "announcement", id: closable })).ok).toBe(true);
    expect((await actions.acknowledge({ kind: "announcement", id: required })).ok).toBe(true);
    as(hr);
    for (const id of [closable, required]) {
      expect((await popupActions.setPopup({ kind: "announcement", itemId: id, enabled: true, showFrom: addDays(today, 1) })).ok).toBe(true);
      expect((await popupActions.setPopup({ kind: "announcement", itemId: id, enabled: true, showFrom: today })).ok).toBe(true);
    }
    const ids = (await mine(recipient)).map((p) => p.subjectId);
    expect(ids).not.toContain(closable);
    expect(ids).not.toContain(required);
  });

  it("shows queued items in line order, only once their date has come, and not to people it was not sent to", async () => {
    const a = await person("pop-a");
    const first = await queuedAnnouncement({ requiresAck: false });
    const second = await queuedAnnouncement({ requiresAck: true });
    const later = await queuedAnnouncement({ requiresAck: false, showFrom: addDays(today, 3) });
    const late = await person("pop-late"); // hired after they were posted: not addressed

    const seen = (await mine(a)).map((p) => p.subjectId);
    expect(seen.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf(first)).toBeLessThan(seen.indexOf(second));
    expect(seen).not.toContain(later); // scheduled for the future
    expect((await mine(late)).map((p) => p.subjectId)).not.toContain(first);

    // HR moves the second in front of the first
    as(hr);
    expect((await popupActions.movePopup({ popupId: (await rows<{ id: string }>(sql`select id::text as id from docs.popups where announcement_id = ${second}::uuid`))[0].id, direction: "up" })).ok).toBe(true);
    const reordered = (await mine(a)).map((p) => p.subjectId);
    expect(reordered.indexOf(second)).toBeLessThan(reordered.indexOf(first));

    // The queue HR sees shows both states
    as(hr);
    const queue = await popupQueries.listPopupQueue();
    expect(queue.find((r) => r.itemId === later)).toMatchObject({ state: "scheduled" });
    expect(queue.find((r) => r.itemId === first)).toMatchObject({ state: "live" });
  });

  it("a closable one goes away once closed; one that needs acknowledgment cannot be closed, only acknowledged", async () => {
    const p = await person("pop-p");
    const closable = await queuedAnnouncement({ requiresAck: false });
    const mustAck = await queuedAnnouncement({ requiresAck: true });

    as(p);
    expect(await popupActions.dismissPopup({ kind: "announcement", id: mustAck })).toEqual({ ok: false, error: "This one needs your acknowledgment." });
    expect((await popupActions.dismissPopup({ kind: "announcement", id: closable })).ok).toBe(true);
    expect((await popupActions.dismissPopup({ kind: "announcement", id: closable })).ok).toBe(true); // twice is harmless
    let ids = (await mine(p)).map((x) => x.subjectId);
    expect(ids).not.toContain(closable);
    expect(ids).toContain(mustAck);

    as(p);
    expect((await actions.acknowledge({ kind: "announcement", id: mustAck })).ok).toBe(true);
    ids = (await mine(p)).map((x) => x.subjectId);
    expect(ids).not.toContain(mustAck);

    // Something that was never queued cannot be "closed"
    as(hr);
    const plain = idOf(await actions.createAnnouncement({ title: uniq("Plain "), body: "Not queued.", audience: "all", teamIds: [], requiresAck: false }));
    as(p);
    expect((await popupActions.dismissPopup({ kind: "announcement", id: plain })).ok).toBe(false);
  });

  it("queues a policy by its current version; a new version pops up again; taking it out of the queue stops it", async () => {
    const p = await person("pop-pol");
    as(hr);
    const policyId = idOf(await actions.createPolicy({ title: uniq("Pop policy "), body: "Version one.", requiresAck: true }));
    expect((await actions.publishDraft({ policyId })).ok).toBe(true);
    expect((await popupActions.setPopup({ kind: "policy", itemId: policyId, enabled: true, showFrom: today })).ok).toBe(true);
    const [v1] = await rows<{ id: string }>(sql`select id::text as id from docs.policy_versions where policy_id = ${policyId}::uuid and version = 1`);

    let list = await mine(p);
    expect(list.find((x) => x.subjectId === v1.id)).toMatchObject({ kind: "policy", requiresAck: true, version: 1, link: `/announcements/policies/${policyId}` });
    as(p);
    expect((await actions.acknowledge({ kind: "policy_version", id: v1.id })).ok).toBe(true);
    expect((await mine(p)).some((x) => x.subjectId === v1.id)).toBe(false);

    // Version two: everyone is asked again
    as(hr);
    expect((await actions.saveDraft({ policyId, body: "Version two.", requiresAck: true, changeNote: "Changed." })).ok).toBe(true);
    expect((await actions.publishDraft({ policyId })).ok).toBe(true);
    list = await mine(p);
    expect(list.find((x) => x.kind === "policy" && x.version === 2)).toBeDefined();

    // Out of the queue: gone
    as(hr);
    expect((await popupActions.setPopup({ kind: "policy", itemId: policyId, enabled: false })).ok).toBe(true);
    expect((await mine(p)).some((x) => x.kind === "policy" && x.link.endsWith(policyId))).toBe(false);
  });

  it("only HR can queue, reorder or look at the queue; the privacy notice cannot be queued", async () => {
    const p = await person("pop-emp");
    const id = await queuedAnnouncement({ requiresAck: false });
    as(p);
    expect((await popupActions.setPopup({ kind: "announcement", itemId: id, enabled: false })).ok).toBe(false);
    await expect(popupQueries.listPopupQueue()).rejects.toThrow();
    as(hr);
    const [privacy] = await rows<{ id: string }>(sql`select id::text as id from docs.policies where kind = 'privacy_notice' limit 1`);
    if (privacy) expect((await popupActions.setPopup({ kind: "policy", itemId: privacy.id, enabled: true })).ok).toBe(false);
  });
});
