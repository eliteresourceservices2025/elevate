import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { formatDays, expiryAmount, unusedByPool } from "./ledger";
import { leaveExpiryReminders, leaveLedger } from "./schema";
import { addDays, loadLedger, lockEmployeeLedger } from "./service";

// Background work (no signed-in person). src/inngest wraps this in a scheduled function. Rows written here
// have no creator ("System"), and audit rows have no actor.

type Award = { id: string; employee_id: string; leave_type_id: string; expires_on: string; user_id: string | null };

const awardsWhere = (condition: ReturnType<typeof sql>) =>
  db.execute(sql`
    select l.id, l.employee_id, l.leave_type_id, l.expires_on::text as expires_on, e.user_id
    from time.leave_ledger l join core.employees e on e.id = l.employee_id
    where l.entry_type = 'award' and l.expires_on is not null and ${condition}`) as unknown as Promise<Award[]>;

export type LeaveExpiryRun = { expired: number; daysWrittenOff: number; reminded: number };

/**
 * Daily. (1) Writes an expiry row for every award whose last day has passed, for whatever was left unused,
 * so the balance stays a plain sum. Each award expires once (a unique index), so running twice is safe.
 * (2) Once per award, tells the person when unused days will expire within 7 days.
 */
export async function runLeaveExpiry(today: string): Promise<LeaveExpiryRun> {
  let expired = 0;
  let daysWrittenOff = 0;
  let reminded = 0;

  const due = await awardsWhere(sql`l.expires_on < ${today}::date and not exists (select 1 from time.leave_ledger x where x.entry_type = 'expiry' and x.award_id = l.id)`);
  for (const award of due) {
    await db.transaction(async (tx) => {
      await lockEmployeeLedger(tx, award.employee_id);
      const rows = await loadLedger(tx, award.employee_id, award.leave_type_id);
      const left = expiryAmount(rows, award.id, award.expires_on);

      const written = await tx
        .insert(leaveLedger)
        .values({
          employeeId: award.employee_id,
          leaveTypeId: award.leave_type_id,
          entryType: "expiry",
          days: String(-left),
          reason: left > 0 ? "Expired unused" : "Expired, nothing left",
          effectiveOn: addDays(award.expires_on, 1),
          awardId: award.id,
          createdBy: null,
        })
        .onConflictDoNothing()
        .returning({ id: leaveLedger.id });
      if (written.length === 0) return;

      expired += 1;
      daysWrittenOff += left;
      if (left > 0 && award.user_id) {
        await notify(tx, { userId: award.user_id, kind: "timeoff.expired", title: `${formatDays(left)} of prize time off expired`, body: "They were not used by the expiry date.", link: "/time-off" });
      }
      await writeAudit({ actor: null, action: "leave.expire", targetType: "employee", targetId: award.employee_id, metadata: { awardId: award.id, days: left } }, tx);
    });
  }

  const soon = await awardsWhere(
    sql`l.expires_on >= ${today}::date and l.expires_on <= ${addDays(today, 7)}::date and not exists (select 1 from time.leave_expiry_reminders r where r.award_id = l.id)`,
  );
  for (const award of soon) {
    await db.transaction(async (tx) => {
      const claimed = await tx.insert(leaveExpiryReminders).values({ awardId: award.id }).onConflictDoNothing().returning({ awardId: leaveExpiryReminders.awardId });
      if (claimed.length === 0) return;
      const rows = await loadLedger(tx, award.employee_id, award.leave_type_id);
      const left = unusedByPool(rows, today).get(award.id) ?? 0;
      if (left <= 0 || !award.user_id) return; // nothing left to lose: no reminder
      reminded += 1;
      await notify(tx, {
        userId: award.user_id,
        kind: "timeoff.expiring",
        title: `${formatDays(left)} of prize time off expire on ${award.expires_on}`,
        body: "Use them before then.",
        link: "/time-off",
      });
    });
  }

  return { expired, daysWrittenOff, reminded };
}
