import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { managerChainUserIds, reportName } from "@/modules/org/service";
import { holidaysInRange, notifyWaiting } from "./request-service";
import { leaveApprovals, leaveRequests } from "./schema";
import { workingDaysBetween } from "./workdays";

// Background work (no signed-in person). src/inngest wraps it in a scheduled function.

export const REMIND_AFTER_WORKING_DAYS = 2;
export const ESCALATE_AFTER_WORKING_DAYS = 4;

export type RequestReminderRun = { reminded: number; escalated: number };

/**
 * Daily. A request that has waited 2 working days at its current step gets one reminder to whoever it waits on.
 * A request still waiting on the person's lead after 4 working days moves to HR (once). Each step happens once.
 */
export async function runLeaveRequestReminders(today: string): Promise<RequestReminderRun> {
  const pending = (await db.execute(sql`
    select r.id, r.employee_id, r.status, r.step_started_on::text as step_started_on, r.reminded_at, r.escalated_at,
           e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.leave_requests r join core.employees e on e.id = r.employee_id
    where r.status in ('pending_lead', 'pending_hr')`)) as unknown as {
    id: string; employee_id: string; status: "pending_lead" | "pending_hr"; step_started_on: string; reminded_at: Date | null; escalated_at: Date | null;
    user_id: string | null; first: string; last: string; preferred: string | null;
  }[];
  if (pending.length === 0) return { reminded: 0, escalated: 0 };

  const hrIds = await hrUserIds();
  let reminded = 0;
  let escalated = 0;

  for (const p of pending) {
    const holidays = new Set((await holidaysInRange(db, p.employee_id, p.step_started_on, today)).map((h) => h.date));
    const waited = workingDaysBetween(p.step_started_on, today, holidays);
    const name = reportName({ first: p.first, last: p.last, preferred: p.preferred });

    await db.transaction(async (tx) => {
      const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, p.id)).for("update");
      if (!req || req.status !== p.status) return; // decided in the meantime

      const chain = await managerChainUserIds(tx, p.employee_id);
      const exclude = [p.user_id ?? "", req.filedBy];

      if (req.status === "pending_lead" && waited >= ESCALATE_AFTER_WORKING_DAYS && !req.escalatedAt) {
        await tx.update(leaveRequests).set({ status: "pending_hr", stepStartedOn: today, remindedAt: null, escalatedAt: new Date(), updatedAt: new Date() }).where(eq(leaveRequests.id, req.id));
        await tx.insert(leaveApprovals).values({ requestId: req.id, level: "lead", decision: "escalated", decidedBy: null, note: "No answer from the lead in time" });
        await notifyWaiting(tx, { ...req, status: "pending_hr" }, name, chain, hrIds, exclude);
        await notify(
          tx,
          chain.slice(0, 1).map((userId) => ({ userId, kind: "timeoff.escalated", title: `${name}'s time off request went to HR`, body: "It waited too long for your answer.", link: "/time-off?tab=approvals" })),
        );
        await writeAudit({ actor: null, action: "leave.escalate", targetType: "employee", targetId: p.employee_id, metadata: { requestId: req.id, waitedWorkingDays: waited } }, tx);
        escalated += 1;
        return;
      }

      if (waited >= REMIND_AFTER_WORKING_DAYS && !req.remindedAt) {
        await tx.update(leaveRequests).set({ remindedAt: new Date(), updatedAt: new Date() }).where(eq(leaveRequests.id, req.id));
        await notifyWaiting(tx, req, name, chain, hrIds, exclude);
        reminded += 1;
      }
    });
  }
  return { reminded, escalated };
}
