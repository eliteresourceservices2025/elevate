import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for the call settings page data: this month's estimate (not last month's), the warning, and saving.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const settings = await import("@/modules/calls/settings");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let counter = 0;

async function makeUser(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `s${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}
async function finishedCall(startedAt: string, gb: number, minutes: number): Promise<string> {
  const u = await makeUser();
  const conv = randomUUID();
  const callId = randomUUID();
  await db.execute(sql`insert into chat.conversations (id, kind, title, created_by) values (${conv}, 'group', 'x', ${u.id})`);
  await db.execute(sql`insert into chat.calls (id, conversation_id, started_by, started_at, ended_at, end_reason, max_participants) values (${callId}, ${conv}, ${u.id}, ${startedAt}::timestamptz, ${startedAt}::timestamptz + interval '10 minutes', 'ended', 3)`);
  await db.execute(sql`insert into chat.call_usage (call_id, estimated_gb, participant_minutes) values (${callId}, ${gb}, ${minutes})`);
  return callId;
}

describe("call settings view", () => {
  it("only a Super Admin may read or save", async () => {
    current.user = { id: randomUUID(), email: "e@example.com", roles: ["employee"] };
    await expect(settings.getCallSettingsView()).rejects.toThrow("Forbidden");
    current.user = { id: randomUUID(), email: "h@example.com", roles: ["hr_admin"] };
    await expect(settings.getCallSettingsView()).rejects.toThrow("Forbidden");
  });

  it("adds up this month's estimate and leaves out earlier months; warns past the level", async () => {
    current.user = { id: randomUUID(), email: "s@example.com", roles: ["super_admin"] };
    const before = await settings.getCallSettingsView();
    await finishedCall(new Date().toISOString(), 12.5, 300);
    await finishedCall(new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString(), 400, 9000);
    const after = await settings.getCallSettingsView();
    expect(after.monthGb - before.monthGb).toBeCloseTo(12.5, 2);
    expect(after.callsThisMonth - before.callsThisMonth).toBe(1);
    expect(after.participantMinutesThisMonth - before.participantMinutesThisMonth).toBe(300);
    expect(after.freeGb).toBe(1000);
    expect(after.recent.length).toBeGreaterThan(0);
    await settings.saveCallSettings(await makeUser(), { monthlyGbWarning: 50, townhallEnabled: true });
    expect((await settings.getCallSettingsView()).overWarning).toBe(after.monthGb >= 50);
  });

  it("saving changes the warning and the all-hands switch and writes an audit row with the before and after", async () => {
    const actor = await makeUser();
    await settings.saveCallSettings(actor, { monthlyGbWarning: 650, townhallEnabled: false });
    const [row] = await rows<{ monthly_gb_warning: number; townhall_enabled: boolean }>(sql`select monthly_gb_warning, townhall_enabled from chat.call_settings where id = 1`);
    expect(row).toEqual({ monthly_gb_warning: 650, townhall_enabled: false });
    const audit = await rows(sql`select 1 from ops.audit_log where action = 'call.settings' and actor_user_id = ${actor.id}`);
    expect(audit).toHaveLength(1);
    await settings.saveCallSettings(actor, { monthlyGbWarning: 700, townhallEnabled: true });
  });
});
