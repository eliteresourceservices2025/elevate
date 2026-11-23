import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { db } from "@/lib/db";

/**
 * Jibble is for screenshots until a person's work computer runs the ELEVATE Tracker App, which replaces them. Running both would watch
 * the same person twice, so the Jibble link steps aside for anyone with a connected (active) Tracker App computer.
 *
 * One exception: if Jibble is already running for the person (the last call sent to it was a start or a break end), the link keeps
 * going until Jibble has been told to stop, so connecting a computer in the middle of a shift never leaves Jibble running.
 */

/** SQL for "the Jibble link applies to this person": the team switch is on AND (no connected computer OR Jibble is running right now). */
export function jibbleAppliesSql(employeeId: SQL, teamSwitch: SQL): SQL {
  return sql`(${teamSwitch} and (
    not exists (select 1 from time.tracker_devices d where d.employee_id = ${employeeId} and d.status = 'active')
    or coalesce((select l.action from time.jibble_link_log l where l.employee_id = ${employeeId} and l.status = 'sent' and l.action in ('In', 'Out', 'StartBreak', 'EndBreak') order by l.created_at desc limit 1) in ('In', 'EndBreak'), false)))`;
}

/** True when the Tracker App stands in for Jibble for this person right now (a connected computer and Jibble not running). */
export async function trackerReplacesJibble(executor: Pick<typeof db, "execute">, employeeId: string): Promise<boolean> {
  const rows = (await executor.execute(sql`select ${jibbleAppliesSql(sql`${employeeId}::uuid`, sql`true`)} as applies`)) as unknown as { applies: boolean }[];
  const hasDevice = (await executor.execute(sql`select 1 as ok from time.tracker_devices d where d.employee_id = ${employeeId} and d.status = 'active' limit 1`)) as unknown as { ok: number }[];
  return hasDevice.length > 0 && rows[0]?.applies === false;
}
