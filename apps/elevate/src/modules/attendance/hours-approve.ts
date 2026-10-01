import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { managerChainUserIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { replayClock } from "./clock";
import { CLEAN_FLAGS, approvalKey, attendanceRows, dayState, latestApprovals } from "./hours-service";
import { rebuildAttendanceDays } from "./jobs";
import { addDays } from "./schedule";
import { hoursApprovals } from "./schema";
import { loadRecentEvents, lockEmployeeClock, prefsFor } from "./service";

const DAY_MS = 86_400_000;
export const MAX_APPROVAL_AGE_DAYS = 35;

type Actor = { id: string; roles: readonly string[] } & Record<string, unknown>;

/**
 * Approves one person's week through the last finished day (in their own zone). First rebuilds their days from the clock events
 * so the numbers are current, then stores what was approved (append-only). Days already approved with the same numbers are left
 * alone, so approving twice does nothing new. With \`onlyIfClean\`, a person whose week has any flag beyond the harmless ones is skipped.
 * Throws ActionFailure with a plain message when it cannot.
 */
export async function approvePersonWeek(actor: Actor, employeeId: string, weekStart: string, note: string | undefined, options: { onlyIfClean?: boolean } = {}): Promise<{ approved: number; skipped: "flags" | null }> {
  const [person] = await db.select({ userId: employees.userId }).from(employees).where(and(eq(employees.id, employeeId), sql`${employees.archivedAt} is null`));
  if (!person) throw new ActionFailure("That person was not found.");
  if (person.userId === actor.id) throw new ActionFailure("Someone else must approve your hours.");
  await authorize(actor as never, "hours.approve", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, employeeId) });
  if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) throw new ActionFailure("A week starts on a Monday.");

  const prefs = await prefsFor(db, employeeId);
  const now = new Date();
  const today = formatInZone(now, prefs.zone, "yyyy-MM-dd");
  if (weekStart < addDays(today, -MAX_APPROVAL_AGE_DAYS)) throw new ActionFailure(`Hours can only be approved up to ${MAX_APPROVAL_AGE_DAYS / 7} weeks back. Ask HR.`);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d < today);
  if (dates.length === 0) throw new ActionFailure("Nothing to approve yet: the first day of that week is not over.");

  // A session still open from that week has no end, so its hours are not final.
  const replay = replayClock(await loadRecentEvents(db, employeeId, 300));
  const open = replay.sessions.find((s) => s.endAt === null);
  if (open && formatInZone(open.startAt, prefs.zone, "yyyy-MM-dd") <= dates[dates.length - 1]) {
    throw new ActionFailure("They are still clocked in from that week. They need to clock out (or file a correction) first.");
  }

  await rebuildAttendanceDays(now, Math.ceil((now.getTime() - Date.parse(`${weekStart}T00:00:00Z`)) / DAY_MS) + 1, employeeId);

  return db.transaction(async (tx) => {
    await lockEmployeeClock(tx, employeeId);
    const rows = (await attendanceRows(tx, [employeeId], dates[0], dates[dates.length - 1])).filter((r) => r.sessions > 0 || r.scheduledMinutes !== null);
    if (options.onlyIfClean && rows.some((r) => r.flags.some((f) => !CLEAN_FLAGS.has(f)))) return { approved: 0, skipped: "flags" as const };
    const current = await latestApprovals(tx, [employeeId], dates[0], dates[dates.length - 1]);
    const todo = rows.filter((r) => dayState(r, current.get(approvalKey(r.employeeId, r.date))) !== "approved");
    if (todo.length === 0) return { approved: 0, skipped: null };
    await tx.insert(hoursApprovals).values(
      todo.map((r) => ({ employeeId, date: r.date, scheduledMinutes: r.scheduledMinutes, workedMinutes: r.workedMinutes, breakMinutes: r.breakMinutes, extraMinutes: r.extraMinutes, approvedExtraMinutes: r.approvedExtraMinutes, approvedBy: actor.id, note: note ?? null })),
    );
    await writeAudit({ actor: actor as never, action: "hours.approve", targetType: "employee", targetId: employeeId, after: { weekStart, days: todo.length, workedMinutes: todo.reduce((n, r) => n + r.workedMinutes, 0), extraMinutes: todo.reduce((n, r) => n + r.extraMinutes, 0), approvedExtraMinutes: todo.reduce((n, r) => n + r.approvedExtraMinutes, 0) }, metadata: { note: note ?? null } }, tx);
    if (person.userId) await notify(tx, { userId: person.userId, kind: "hours.approved", title: "Your hours were approved", body: `Week of ${weekStart}: ${todo.length} ${todo.length === 1 ? "day" : "days"}.${note ? ` ${note}` : ""}`, link: "/attendance" });
    return { approved: todo.length, skipped: null };
  });
}
