import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Strict time, breaks (design 2026-11-24): a break must be 15, 30 or 60 minutes and fit inside what is left of the day's allowance.
// The allowance is the schedule's break time (the company default when the schedule has none, or the person has no schedule).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/attendance/actions");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const MIN = 60_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

async function newPerson(label: string, schedule?: { breakMinutes: number }) {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label}, ${uniq(label)}, ${email}, 'active', ${id}) returning id`);
  if (schedule) {
    await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone)
      values (${e.id}, current_date - 30, '00:00', '23:59', array[1,2,3,4,5,6,7]::smallint[], ${schedule.breakMinutes}, 'America/Phoenix')`);
  }
  return { user: { id, email, roles: ["employee"] as RoleSlug[] } satisfies TestUser, employeeId: e.id };
}
const at = (offsetMin: number) => new Date(Date.now() + offsetMin * MIN).toISOString();
const event = (employeeId: string, type: string, when: string, planned: number | null = null) =>
  db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, planned_break_minutes) values (${employeeId}, ${type}, ${when}, ${planned})`);
/** Works since 3 hours ago and took one 15 minute break. */
async function workingWithOneBreak(label: string, breakMinutes: number | null) {
  const p = await newPerson(label, breakMinutes === null ? undefined : { breakMinutes });
  await event(p.employeeId, "clock_in", at(-180));
  await event(p.employeeId, "break_start", at(-120), 15);
  await event(p.employeeId, "break_end", at(-105));
  current.user = p.user;
  return p;
}

beforeAll(() => {
  current.user = null;
});

describe("starting a break", () => {
  it("is refused without a length", async () => {
    await workingWithOneBreak("nolen", 60);
    expect(await actions.startBreak()).toEqual({ ok: false, error: "Choose 15, 30 or 60 minutes for your break." });
  });

  it("is refused when the piece is more than what is left of the schedule's allowance", async () => {
    await workingWithOneBreak("toolong", 60); // 15 taken, 45 left
    expect(await actions.startBreak({ breakMinutes: 60 })).toEqual({ ok: false, error: "You only have 45 minutes of break left today." });
  });

  it("is allowed when it fits, and the rest of the allowance can be used later", async () => {
    await workingWithOneBreak("fits", 60);
    expect((await actions.startBreak({ breakMinutes: 30 })).ok).toBe(true);
  });

  it("says so when no break time is left", async () => {
    const p = await workingWithOneBreak("none", 15); // 15 taken of 15
    expect(p).toBeDefined();
    expect(await actions.startBreak({ breakMinutes: 15 })).toEqual({ ok: false, error: "You have no break time left today." });
  });

  it("uses the company default allowance when there is no schedule", async () => {
    await workingWithOneBreak("nosched", null); // default 60, 15 taken
    expect(await actions.startBreak({ breakMinutes: 60 })).toEqual({ ok: false, error: "You only have 45 minutes of break left today." });
    expect((await actions.startBreak({ breakMinutes: 30 })).ok).toBe(true);
  });

  it("uses the company default when the schedule has no break time", async () => {
    await workingWithOneBreak("zerobreak", 0);
    expect((await actions.startBreak({ breakMinutes: 30 })).ok).toBe(true);
  });

  it("reports the minutes left in the clock status", async () => {
    await workingWithOneBreak("status", 60);
    const { getClockStatus } = await import("@/modules/attendance/queries");
    expect((await getClockStatus())?.breakLeftMinutes).toBe(45);
  });
});
