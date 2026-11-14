import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";

// A small read the attendance module calls before it takes an approval back. Payroll owns its tables; attendance never reads them.

type Executor = Pick<typeof db, "execute">;

/**
 * Whether any day between two dates (inclusive) is already in an approved or paid payroll run for this person. A practice (test) run
 * does not count, and neither does a line a Preparer took off the run. Hours already used for real pay must be corrected in payroll,
 * not by taking the approval back.
 */
export async function hasConfirmedRunOver(executor: Executor, employeeId: string, from: string, to: string): Promise<boolean> {
  const rows = (await executor.execute(sql`
    select 1 as ok from payroll.pay_run_lines l join payroll.pay_runs r on r.id = l.run_id
    where l.employee_id = ${employeeId} and not l.excluded and not r.is_test and r.status in ('approved', 'paid')
      and r.period_start <= ${to}::date and r.period_end >= ${from}::date
    limit 1`)) as unknown as { ok: number }[];
  return rows.length > 0;
}
