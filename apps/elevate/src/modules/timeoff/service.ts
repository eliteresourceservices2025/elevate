import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import type { LedgerEntryType, LedgerRow } from "./ledger";
import { balanceOf } from "./ledger";

// Server-only helpers (not server actions), so they may take a transaction. Callers authorize first.

type Executor = Pick<typeof db, "execute">;

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Serialises ledger writes for one person (held until the transaction ends), so two awards, adjustments or
 * (Phase 2.2) requests can never both pass a balance check made before either was written.
 */
export async function lockEmployeeLedger(tx: Executor, employeeId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`leave:${employeeId}`}))`);
}

/** Every ledger row for one person and leave type, in the shape the pure rules in ledger.ts use. */
export async function loadLedger(executor: Executor, employeeId: string, leaveTypeId: string): Promise<LedgerRow[]> {
  const rows = (await executor.execute(sql`
    select id, entry_type, days::float8 as days, effective_on::text as effective_on, expires_on::text as expires_on,
           (extract(epoch from created_at) * 1000)::float8 as created_ms
    from time.leave_ledger
    where employee_id = ${employeeId} and leave_type_id = ${leaveTypeId}
    order by effective_on, created_at, id`)) as unknown as {
    id: string; entry_type: LedgerEntryType; days: number; effective_on: string; expires_on: string | null; created_ms: number;
  }[];
  return rows.map((r) => ({ id: r.id, entryType: r.entry_type, days: Number(r.days), effectiveOn: r.effective_on, expiresOn: r.expires_on, createdAtMs: Number(r.created_ms) }));
}

export async function balanceNow(executor: Executor, employeeId: string, leaveTypeId: string): Promise<number> {
  return balanceOf(await loadLedger(executor, employeeId, leaveTypeId));
}

/**
 * Holiday dates applicable during a historical range. Assignment start/end dates are inclusive;
 * PH always applies, while a client's calendar applies only on dates served for that client.
 * Unlike the current-calendar selector, an archived client still counts for its past assignment.
 */
export async function historicalHolidayDatesFor(executor: Executor, employeeId: string, start: string, end: string): Promise<Set<string>> {
  const rows = (await executor.execute(sql`
    select distinct h.date::text as date from time.holidays h
    where h.archived_at is null and h.date between ${start}::date and ${end}::date
      and (h.calendar = 'PH' or exists (
        select 1 from core.client_assignments a join core.clients c on c.id = a.client_id
        where a.employee_id = ${employeeId} and c.holiday_calendar = h.calendar
          and a.start_date <= h.date and (a.end_date is null or a.end_date >= h.date)
      ))`)) as unknown as { date: string }[];
  return new Set(rows.map((row) => row.date));
}

/** The Philippines plus each currently assigned client's holiday calendar, for the normal calendar view. */
export async function holidayCalendarsFor(executor: Executor, employeeId: string): Promise<("PH" | "US")[]> {
  const rows = (await executor.execute(sql`
    select distinct c.holiday_calendar
    from core.client_assignments a join core.clients c on c.id = a.client_id
    where a.employee_id = ${employeeId} and a.end_date is null and c.archived_at is null`)) as unknown as { holiday_calendar: string }[];
  const set = new Set<"PH" | "US">(["PH"]);
  for (const r of rows) if (r.holiday_calendar === "US" || r.holiday_calendar === "PH") set.add(r.holiday_calendar);
  return [...set];
}
