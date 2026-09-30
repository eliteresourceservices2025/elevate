import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { queueEmails } from "@/modules/notifications/email-queue";
import { notify } from "@/modules/notifications/service";
import { buildLeaveIcs } from "./ics";
import { canTake, formatDays } from "./ledger";
import { leaveLedger, leaveRequests } from "./schema";
import { holidayCalendarsFor, loadLedger, lockEmployeeLedger } from "./service";

// Server-only helpers for leave requests (not server actions, so they may take a transaction). Callers authorize first.

type Executor = Pick<typeof db, "execute" | "insert" | "select" | "update">;
export type RequestRow = typeof leaveRequests.$inferSelect;

/** Holidays that apply to a person inside a date range: the Philippines plus their clients' calendars (verified or not). */
export async function holidaysInRange(executor: Executor, employeeId: string, start: string, end: string): Promise<{ date: string; name: string; calendar: string }[]> {
  const calendars = await holidayCalendarsFor(executor, employeeId);
  const rows = (await executor.execute(sql`
    select date::text as date, name, calendar from time.holidays
    where archived_at is null and date between ${start}::date and ${end}::date
      and calendar in (${sql.join(calendars.map((c) => sql`${c}`), sql`, `)})
    order by date, calendar`)) as unknown as { date: string; name: string; calendar: string }[];
  return rows;
}

/** Days already waiting for approval for this person and leave type (they are reserved against the balance). */
export async function pendingDays(executor: Executor, employeeId: string, leaveTypeId: string): Promise<number> {
  const [row] = (await executor.execute(sql`
    select coalesce(sum(days), 0)::float8 as n from time.leave_requests
    where employee_id = ${employeeId} and leave_type_id = ${leaveTypeId} and status in ('pending_lead', 'pending_hr')`)) as unknown as { n: number }[];
  return Number(row.n);
}

/** Teammates: people on the same team as this person (never including them). */
export async function peerEmployeeIds(executor: Executor, employeeId: string): Promise<string[]> {
  const rows = (await executor.execute(sql`
    select p.id from core.employees me join core.employees p on p.team_id = me.team_id and p.id <> me.id
    where me.id = ${employeeId} and me.team_id is not null and p.archived_at is null and p.status <> 'separated'`)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export type Approver = { userId: string };

/** Tells the right people a request is waiting on them: the nearest lead with an account, or HR. */
export async function notifyWaiting(
  tx: Executor,
  request: Pick<RequestRow, "id" | "status" | "days" | "startDate" | "endDate">,
  employeeName: string,
  leadUserIds: string[],
  hrIds: string[],
  excludeUserIds: string[],
) {
  const targets = request.status === "pending_lead" ? leadUserIds.slice(0, 1) : hrIds;
  const userIds = targets.filter((id) => !excludeUserIds.includes(id));
  await notify(
    tx,
    userIds.map((userId) => ({
      userId,
      kind: "timeoff.approval_needed",
      title: `${employeeName} asked for ${formatDays(request.days ? Number(request.days) : 0)} off`,
      body: `${request.startDate}${request.endDate !== request.startDate ? ` to ${request.endDate}` : ""}`,
      link: "/time-off?tab=approvals",
    })),
  );
}

/** Queues the calendar invite (or its cancellation) as an email to the person. Counts only in the body; dates are in the file. */
export async function queueInvite(tx: Executor, request: Pick<RequestRow, "id" | "startDate" | "endDate">, userId: string, method: "PUBLISH" | "CANCEL") {
  const ics = buildLeaveIcs({ uid: request.id, summary: "Day off", startDate: request.startDate, endDate: request.endDate, stampIso: new Date().toISOString(), method });
  const cancel = method === "CANCEL";
  await queueEmails(tx, [
    {
      userId,
      kind: "invite",
      subject: cancel ? "Your time off was cancelled" : "Your time off was approved",
      heading: cancel ? "Time off cancelled" : "Time off approved",
      lines: [cancel ? "The calendar entry for your time off has been removed. The file attached cancels it." : "Your request was approved. The attached file adds it to your calendar."],
      link: "/time-off",
      attachment: { fileName: cancel ? "time-off-cancelled.ics" : "time-off.ics", mimeType: "text/calendar", content: ics },
      dedupeKey: `invite-${cancel ? "cancel" : "approved"}:${request.id}`,
    },
  ]);
}

/**
 * Final approval: for a leave type with a balance, writes the usage row (checked against the ledger inside the
 * lock, so two approvals cannot overdraw), then marks the request approved. Throws ActionFailure to roll back.
 */
export async function finalizeApproval(tx: Executor, request: RequestRow, tracksBalance: boolean, actorId: string): Promise<void> {
  if (tracksBalance) {
    await lockEmployeeLedger(tx, request.employeeId);
    const rows = await loadLedger(tx, request.employeeId, request.leaveTypeId);
    const days = Number(request.days);
    if (!canTake(rows, days, request.startDate, request.id)) {
      throw new ActionFailure("There are not enough usable prize days for this request any more. Decline it, or add days first.");
    }
    await tx.insert(leaveLedger).values({
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      entryType: "usage",
      days: String(-days),
      reason: "Leave request",
      effectiveOn: request.startDate,
      requestId: request.id,
      createdBy: actorId,
    });
  }
  await tx.update(leaveRequests).set({ status: "approved", updatedAt: new Date() }).where(sql`${leaveRequests.id} = ${request.id}`);
}
