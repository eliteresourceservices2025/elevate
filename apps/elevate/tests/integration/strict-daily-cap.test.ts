import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Strict time, daily cap (design 2026-11-24): HR sets how many hours a day each person without a schedule may work.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const orgActions = await import("@/modules/org/actions");
const queries = await import("@/modules/attendance/queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
let hr: TestUser;
let worker: { user: TestUser; employeeId: string };
const cap = async () => (await rows<{ daily_cap_minutes: number | null }>(sql`select daily_cap_minutes from core.employees where id = ${worker.employeeId}`))[0].daily_cap_minutes;

beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  const user = await makeUser("capworker", ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Cap', ${uniq("Aaa")}, ${user.email}, 'active', ${user.id}) returning id`);
  worker = { user, employeeId: e.id };
});

describe("setDailyCap", () => {
  it("HR sets and clears a person's daily cap, and each change is audited without the value", async () => {
    current.user = hr;
    expect((await orgActions.setDailyCap({ employeeId: worker.employeeId, minutes: 300 })).ok).toBe(true);
    expect(await cap()).toBe(300);
    expect((await orgActions.setDailyCap({ employeeId: worker.employeeId, minutes: null })).ok).toBe(true);
    expect(await cap()).toBeNull();
    const audit = await rows<{ after: unknown; before: unknown }>(sql`select before, after from ops.audit_log where action = 'employee.daily_cap' and target_id = ${worker.employeeId} order by occurred_at`);
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain("300");
  });

  it("refuses a cap of zero, a negative cap, or more than 16 hours", async () => {
    current.user = hr;
    for (const minutes of [0, -5, 961, 1.5]) expect((await orgActions.setDailyCap({ employeeId: worker.employeeId, minutes })).ok).toBe(false);
  });

  it("refuses an Employee changing their own cap", async () => {
    current.user = worker.user;
    expect(await orgActions.setDailyCap({ employeeId: worker.employeeId, minutes: 600 })).toEqual({ ok: false, error: "You do not have access to do that." });
  });

  it("shows the cap, and who has neither a schedule nor a cap, in the schedules list", async () => {
    current.user = hr;
    await orgActions.setDailyCap({ employeeId: worker.employeeId, minutes: 240 });
    const { rows: list } = await queries.listSchedules();
    const mine = list.find((r) => r.employeeId === worker.employeeId)!;
    expect(mine.dailyCapMinutes).toBe(240);
    await orgActions.setDailyCap({ employeeId: worker.employeeId, minutes: null });
    const again = (await queries.listSchedules()).rows.find((r) => r.employeeId === worker.employeeId)!;
    expect(again.dailyCapMinutes).toBeNull();
    expect(again.current).toBeNull();
  });
});
