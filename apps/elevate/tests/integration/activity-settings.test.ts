import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Thresholds and category rules, against a real database: saving is audited with before/after, applies to the app's settings,
// and archiving a rule stops it counting.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/activity/actions");
const queries = await import("@/modules/activity/queries");
const ingest = await import("@/modules/activity/ingest");
const jobs = await import("@/modules/activity/jobs");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let counter = 0;
async function user(roles: RoleSlug[]) {
  const id = randomUUID();
  const email = `set${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Set', 'Ting', ${email}, 'active', ${id}) returning id`);
  return { id, email, roles, employeeId: e.id };
}

describe("saveActivitySettings", () => {
  it("changes what the app is told, and audits the numbers before and after", async () => {
    const hr = await user(["hr_admin", "employee"]);
    current.user = hr;
    const before = await queries.getActivitySettings();
    const saved = await actions.saveActivitySettings({ idleTimeoutSeconds: 240, offlineGraceMinutes: 7, lowActivityPercent: 25 });
    expect(saved.ok).toBe(true);
    expect((await ingest.clockStateFor(hr.employeeId)).settings.idleTimeoutSeconds).toBe(240);
    const after = await queries.getActivitySettings();
    expect([after.idleTimeoutSeconds, after.offlineGraceMinutes, after.lowActivityPercent]).toEqual([240, 7, 25]);
    const [a] = await rows<{ before: { idleTimeoutSeconds: number }; after: { idleTimeoutSeconds: number } }>(
      sql`select "before", "after" from ops.audit_log where action = 'activity.settings_saved' and actor_email = ${hr.email} order by id desc limit 1`,
    );
    expect(a.before.idleTimeoutSeconds).toBe(before.idleTimeoutSeconds);
    expect(a.after.idleTimeoutSeconds).toBe(240);
  });

  it("refuses values outside the limits and anyone but HR and Super Admin", async () => {
    const hr = await user(["hr_admin", "employee"]);
    current.user = hr;
    expect((await actions.saveActivitySettings({ idleTimeoutSeconds: 5, offlineGraceMinutes: 7, lowActivityPercent: 25 })).ok).toBe(false);
    const lead = await user(["team_lead", "employee"]);
    current.user = lead;
    expect(await actions.saveActivitySettings({ idleTimeoutSeconds: 180, offlineGraceMinutes: 5, lowActivityPercent: 30 })).toEqual({ ok: false, error: "You do not have access to do that." });
  });
});

describe("archiveCategory", () => {
  it("removes the rule from the list and from the next rebuild of the totals", async () => {
    const hr = await user(["hr_admin", "employee"]);
    current.user = hr;
    const made = await actions.saveCategory({ pattern: "^zzarchive$", category: "work", rank: 10 });
    if (!made.ok) throw new Error(made.error);
    const p = await user(["employee"]);
    const [d] = await rows<{ id: string }>(sql`insert into time.tracker_devices (employee_id, name, os, token_hash) values (${p.employeeId}, 'PC', 'windows', ${randomUUID()}) returning id`);
    await db.execute(sql`insert into time.activity_segments (employee_id, device_id, started_at, ended_at, app, state) values (${p.employeeId}, ${d.id}, '2026-11-10T17:00:00Z', '2026-11-10T17:30:00Z', 'ZzArchive', 'active')`);
    await jobs.rebuildActivityMinutes("2026-11-10", p.employeeId);
    const [withRule] = await rows<{ work_minutes: number }>(sql`select work_minutes from time.activity_minutes where employee_id = ${p.employeeId} and date = '2026-11-10'`);
    expect(withRule.work_minutes).toBe(30);

    expect((await actions.archiveCategory({ id: made.data.id })).ok).toBe(true);
    expect((await queries.listCategories()).some((c) => c.id === made.data.id)).toBe(false);
    await jobs.rebuildActivityMinutes("2026-11-10", p.employeeId);
    const [without] = await rows<{ work_minutes: number }>(sql`select work_minutes from time.activity_minutes where employee_id = ${p.employeeId} and date = '2026-11-10'`);
    expect(without.work_minutes).toBe(0);
    const [audit] = await rows<{ target_id: string }>(sql`select target_id from ops.audit_log where action = 'activity.category_archived' order by id desc limit 1`);
    expect(audit.target_id).toBe(made.data.id);
  });
});
