import { sql } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";

// Payroll tables are append-only, so a test file cannot delete the pay lines it made, and open-ended lines (one file adds a deliberately
// unreadable one) would then be built into every run a later file creates in the same throwaway database. Call this once at the top
// of a payroll integration test file: after the file, every pay line it created gets an END version dated the line's first day, so the line
// is not in force for any later period. The row is copied column by column in SQL, ciphertext included, so nothing is decrypted.

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export function endPayrollLinesWhenDone(db: Executor): void {
  let mark = "";
  beforeAll(async () => {
    const [row] = (await db.execute(sql`select clock_timestamp()::text as t`)) as unknown as { t: string }[];
    mark = row.t;
  });
  afterAll(async () => {
    if (!mark) return;
    await db.execute(sql`
      insert into payroll.pay_lines (id, line_key, employee_id, client_id, alias, hours_per_day, payment_method, fte, ends_on, effective_from, amounts_enc, created_by)
      select gen_random_uuid(), l.line_key, l.employee_id, l.client_id, l.alias, l.hours_per_day, l.payment_method, l.fte, l.effective_from, l.effective_from, l.amounts_enc, l.created_by
      from (
        select distinct on (line_key) *
        from payroll.pay_lines
        where line_key in (
          select line_key from payroll.pay_lines
          group by line_key
          having min(created_at) >= ${mark}::timestamptz and bool_and(ends_on is null)
        )
        order by line_key, effective_from, created_at
      ) l`);
  });
}
