import "server-only";
import { sql } from "drizzle-orm";
import { clockCorrections } from "@/modules/attendance/schema";
import { checkProposal } from "@/modules/attendance/service";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import type { Tx } from "@/modules/people/service";
import type { JibbleEntryEvidence } from "./http-client";

/** Conservative evidence rule. A proposal is not an attendance event and still needs an HR decision. */
export function canProposeJibbleStart(e: JibbleEntryEvidence, now: Date, lastClockOutMs: number | null, maxAgeMs = 30 * 60_000): boolean {
  const time = Date.parse(e.time), created = Date.parse(e.createdAt), updated = Date.parse(e.updatedAt);
  return e.state === "in" && e.clientType === "Desktop" && e.hasDeviceEvidence && !e.elevateOrigin &&
    [time, created, updated].every(Number.isFinite) && created === updated && Math.abs(time - created) <= 60_000 &&
    time <= now.getTime() + 60_000 && time >= now.getTime() - maxAgeMs && (lastClockOutMs === null || time > lastClockOutMs);
}

/** Caller holds the person's clock lock and Jibble reservation, and has rechecked eligibility and the latest entry. */
export async function createJibbleStartProposal(tx: Tx, employeeId: string, evidence: JibbleEntryEvidence, now: Date, lastClockOutMs: number | null): Promise<boolean> {
  if (!canProposeJibbleStart(evidence, now, lastClockOutMs)) return false;
  const [ambiguous] = (await tx.execute(sql`select 1 as present from time.jibble_link_log
    where employee_id = ${employeeId}::uuid and action = 'In' and created_at >= ${new Date(Date.parse(evidence.time) - 30 * 60_000).toISOString()}::timestamptz
      and (jibble_entry_id is null or jibble_entry_id = ${evidence.id}) limit 1`)) as unknown as { present: number }[];
  if (ambiguous) return false;
  const proposed = [{ type: "clock_in" as const, at: evidence.time }];
  if (await checkProposal(employeeId, proposed, now.getTime(), tx)) return false;
  const [pending] = (await tx.execute(sql`select count(*)::int as n from time.clock_corrections where employee_id = ${employeeId}::uuid and status = 'pending'`)) as unknown as { n: number }[];
  if (pending.n >= 3) return false;
  const [created] = await tx.insert(clockCorrections).values({
    employeeId, requestedBy: null, origin: "jibble", sourceJibblePersonId: evidence.personId, sourceJibbleEntryId: evidence.id,
    reason: "Jibble reports a Desktop clock-in while ELEVATE was out. Verify the entry and proposed time before deciding.",
    kind: "other", proposed,
  }).onConflictDoNothing().returning({ id: clockCorrections.id });
  if (!created) return false;
  const recipients = (await tx.execute(sql`select distinct u.id from core.users u join core.user_roles r on r.user_id = u.id
    where u.archived_at is null and r.role_slug in ('hr_admin','super_admin')
    union select user_id as id from core.employees where id = ${employeeId}::uuid and user_id is not null`)) as unknown as { id: string }[];
  await notify(tx, recipients.map(({ id }) => ({ userId: id, kind: "jibble.correction_proposed", title: "Jibble time entry needs review", body: "A Jibble Desktop clock-in was found while ELEVATE was out. A correction proposal is waiting for HR approval; no hours have been added.", link: "/attendance?tab=corrections" })));
  await writeAudit({ actor: null, action: "jibble.correction_proposed", targetType: "employee", targetId: employeeId, metadata: { correctionId: created.id, sourceEntryId: evidence.id } }, tx);
  return true;
}
