import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeWorkingMismatches, recordWorkingMismatch } from "@/modules/jibble/mismatch-lifecycle";

async function person(managerId?: string) {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${userId}, ${email})`);
  const [employee] = (await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id)
    values ('Test', ${randomUUID()}, ${email}, 'active', ${userId}, ${managerId ?? null}) returning id`)) as unknown as { id: string }[];
  return { userId, employeeId: employee.id };
}

describe("Jibble working mismatch lifecycle", () => {
  it("notifies the person and direct lead once across concurrent observations, then permits a new incident after resolution", async () => {
    const lead = await person();
    const employee = await person(lead.employeeId);
    const results = await Promise.all(Array.from({ length: 3 }, () => recordWorkingMismatch(employee.employeeId, "working_jibble_out")));
    expect(results.filter(Boolean)).toHaveLength(1);
    const notices = (await db.execute(sql`select user_id from ops.notifications where kind = 'jibble.working_mismatch' and user_id in (${employee.userId}, ${lead.userId})`)) as unknown as { user_id: string }[];
    expect(notices.map((n) => n.user_id).sort()).toEqual([employee.userId, lead.userId].sort());
    expect(await recordWorkingMismatch(employee.employeeId, "working_jibble_break")).toBe(false);
    const afterChange = (await db.execute(sql`select user_id from ops.notifications where kind = 'jibble.working_mismatch' and user_id in (${employee.userId}, ${lead.userId})`)) as unknown as { user_id: string }[];
    expect(afterChange).toHaveLength(2);
    await closeWorkingMismatches(employee.employeeId);
    expect(await recordWorkingMismatch(employee.employeeId, "working_jibble_out")).toBe(true);
    const incidents = (await db.execute(sql`select resolved_at from time.jibble_mismatches where employee_id = ${employee.employeeId}`)) as unknown as { resolved_at: Date | null }[];
    expect(incidents).toHaveLength(2);
    expect(incidents.filter((i) => i.resolved_at === null)).toHaveLength(1);
  });

  it("notifies a newly assigned lead without notifying the person twice", async () => {
    const employee = await person();
    const lead = await person();
    await recordWorkingMismatch(employee.employeeId, "working_jibble_out");
    await db.execute(sql`update core.employees set manager_id = ${lead.employeeId} where id = ${employee.employeeId}`);
    await recordWorkingMismatch(employee.employeeId, "working_jibble_out");
    const notices = (await db.execute(sql`select user_id from ops.notifications where kind = 'jibble.working_mismatch' and user_id in (${employee.userId}, ${lead.userId})`)) as unknown as { user_id: string }[];
    expect(notices.map((n) => n.user_id).sort()).toEqual([employee.userId, lead.userId].sort());
  });
});
