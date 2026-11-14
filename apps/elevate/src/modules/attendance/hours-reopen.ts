import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { authorize, scopeFor } from "@/lib/authz";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { timeChainUserIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { hasConfirmedRunOver } from "@/modules/payroll/hours-guard";
import { MAX_APPROVAL_AGE_DAYS } from "./hours-approve";
import { latestApprovals } from "./hours-service";
import { mayReopenDay } from "./reopen-rules";
import { addDays } from "./schedule";
import { hoursReopens } from "./schema";
import { lockEmployeeClock, prefsFor } from "./service";

// Taking an approval back. Callers sign the person in first (hours-actions.ts); this authorizes the reach again.

type Actor = { id: string; roles: readonly string[] } & Record<string, unknown>;

/**
 * Takes back the approval of every approved day of one person between two dates (inclusive). Nothing is deleted: each day gets a reopen
 * row (append-only) with the reason, so it shows "Not approved" again, drops out of the export and of payroll's suggestions, and is
 * approved again as a new approval. HR and Super Admin may reopen any approval; a Team Lead only their own, within a week. Never your own
 * hours, never days already in an approved or paid payroll run, and only as far back as hours can be approved (so it can be approved again).
 * All or nothing. Throws ActionFailure with a plain message when it cannot.
 */
export async function reopenHours(actor: Actor, input: { employeeId: string; from: string; to: string; reason: string }): Promise<{ reopened: number }> {
  const [person] = await db.select({ userId: employees.userId }).from(employees).where(and(eq(employees.id, input.employeeId), sql`${employees.archivedAt} is null`));
  if (!person) throw new ActionFailure("That person was not found.");
  if (person.userId === actor.id) throw new ActionFailure("Someone else must reopen your hours.");
  await authorize(actor as never, "hours.reopen", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await timeChainUserIds(db, input.employeeId) });
  const scope = scopeFor(actor as never, "hours.reopen");
  if (scope !== "all" && scope !== "team") throw new ActionFailure("You do not have access to do that.");

  const prefs = await prefsFor(db, input.employeeId);
  const now = new Date();
  const today = formatInZone(now, prefs.zone, "yyyy-MM-dd");
  if (input.from < addDays(today, -MAX_APPROVAL_AGE_DAYS)) throw new ActionFailure(`Hours can only be reopened up to ${MAX_APPROVAL_AGE_DAYS / 7} weeks back, the same as approving them. Ask HR.`);

  return db.transaction(async (tx) => {
    await lockEmployeeClock(tx, input.employeeId);
    const approvals = await latestApprovals(tx, [input.employeeId], input.from, input.to);
    const days = [...approvals.entries()].map(([key, approval]) => ({ date: key.split("|")[1], approval })).sort((a, b) => a.date.localeCompare(b.date));
    if (days.length === 0) throw new ActionFailure("Nothing is approved in that range, so there is nothing to reopen.");
    if (days.some((d) => !mayReopenDay(scope, actor.id, d.approval, now.getTime()))) throw new ActionFailure("You can only reopen hours you approved yourself in the last 7 days. Ask HR.");
    if (await hasConfirmedRunOver(tx, input.employeeId, days[0].date, days[days.length - 1].date)) throw new ActionFailure("Those days are already in an approved or paid payroll run. Correct them in Payroll instead.");

    await tx.insert(hoursReopens).values(days.map((d) => ({ employeeId: input.employeeId, date: d.date, reopenedBy: actor.id, reason: input.reason })));
    await writeAudit({ actor: actor as never, action: "hours.reopen", targetType: "employee", targetId: input.employeeId, after: { from: days[0].date, to: days[days.length - 1].date, days: days.length }, metadata: { reason: input.reason } }, tx);
    if (person.userId) await notify(tx, { userId: person.userId, kind: "hours.reopened", title: "Some of your approved hours were reopened", body: `${days[0].date}${days.length > 1 ? ` to ${days[days.length - 1].date}` : ""}: ${days.length} ${days.length === 1 ? "day" : "days"} need approving again. ${input.reason}`, link: "/attendance" });
    return { reopened: days.length };
  });
}
