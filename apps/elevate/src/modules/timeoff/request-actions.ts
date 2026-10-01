"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isExclusionViolation } from "@/lib/db-errors";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { notify, hrUserIds } from "@/modules/notifications/service";
import { managerChainUserIds, reportName, todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { buildLeaveIcs } from "./ics";
import { balanceOf, canTake, formatDays } from "./ledger";
import { leaveApprovals, leaveLedger, leaveRequests, leaveTypes } from "./schema";
import { finalizeApproval, holidaysInRange, notifyWaiting, peerEmployeeIds, pendingDays, queueInvite } from "./request-service";
import { cancelRequestSchema, decideRequestSchema, previewRequestSchema, requestIdSchema, requestLeaveSchema } from "./request-validators";
import { loadLedger, lockEmployeeLedger } from "./service";
import { workingWeekdaysFor } from "@/modules/attendance/schedule-service";
import { requestDays, workingDaysBetween } from "./workdays";

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;

function refresh() {
  revalidatePath("/time-off");
  revalidatePath("/dashboard");
}

type Person = { id: string; userId: string | null; first: string; last: string; preferred: string | null; status: string };

async function findPerson(where: ReturnType<typeof sql>): Promise<Person | null> {
  const [p] = await db
    .select({ id: employees.id, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, status: employees.status })
    .from(employees)
    .where(and(where, isNull(employees.archivedAt)))
    .limit(1);
  return p ?? null;
}
const nameOf = (p: Pick<Person, "first" | "last" | "preferred">) => reportName({ first: p.first, last: p.last, preferred: p.preferred });

// --- Making a request --------------------------------------------------------------------------

/**
 * A person asks for days off; HR may file one for someone (and for a past date). It starts with the person's
 * lead, or with HR when nobody is above them. Prize days must be available; two live requests may not overlap.
 */
export async function requestLeave(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = requestLeaveSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const today = todayInZone();

    const mine = await findPerson(sql`${employees.userId} = ${actor.id}`);
    const forOther = v.employeeId !== undefined && v.employeeId !== mine?.id;
    let subject: Person | null;
    if (forOther) {
      await authorize(actor, "timeoff.file_for_others");
      subject = await findPerson(sql`${employees.id} = ${v.employeeId}`);
    } else {
      await authorize(actor, "timeoff.request", { ownerUserId: actor.id });
      subject = mine;
      if (!subject) return fail("Your people record is not set up yet. Ask HR.");
    }
    if (!subject || subject.status === "separated") return fail("That person was not found.");

    const [type] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.id, v.leaveTypeId), isNull(leaveTypes.archivedAt))).limit(1);
    if (!type) return fail("Choose a leave type.");

    if (!forOther) {
      if (v.startDate < today) return fail("Requests cannot start in the past. Ask HR to file it for you.");
      if (type.tracksBalance && workingDaysBetween(today, v.startDate) < 1) return fail("Ask at least one working day ahead.");
    }

    const hrIds = await hrUserIds();
    let id: string;
    try {
      id = await db.transaction(async (tx) => {
        const holidays = new Set((await holidaysInRange(tx, subject.id, v.startDate, v.endDate)).map((h) => h.date));
        const days = requestDays(v.startDate, v.endDate, v.halfDay, holidays, await workingWeekdaysFor(tx, subject.id, v.startDate));
        if (days === 0) throw new ActionFailure(v.halfDay ? "A half day needs a single working day." : "There are no working days in that range.");

        const requestId = randomUUID();
        if (type.tracksBalance) {
          await lockEmployeeLedger(tx, subject.id);
          const rows = await loadLedger(tx, subject.id, type.id);
          const reserved = await pendingDays(tx, subject.id, type.id);
          const available = balanceOf(rows) - reserved;
          if (days > available + 1e-9 || !canTake(rows, days, v.startDate, requestId)) {
            throw new ActionFailure(`You have ${formatDays(Math.max(0, available))} available${reserved > 0 ? ` (${formatDays(reserved)} already waiting for approval)` : ""}. Days can only be used after they were awarded and before they expire.`);
          }
        }

        const chain = await managerChainUserIds(tx, subject.id);
        const status = chain.length > 0 ? "pending_lead" : "pending_hr";
        const [row] = await tx
          .insert(leaveRequests)
          .values({ id: requestId, employeeId: subject.id, leaveTypeId: type.id, startDate: v.startDate, endDate: v.endDate, halfDay: v.halfDay, days: String(days), note: v.note ?? null, status, filedBy: actor.id, stepStartedOn: today })
          .returning();
        await notifyWaiting(tx, row, nameOf(subject), chain, hrIds, [subject.userId ?? "", actor.id]);
        if (forOther && subject.userId) {
          await notify(tx, { userId: subject.userId, kind: "timeoff.filed_for_you", title: "HR filed a time off request for you", body: `${v.startDate}${v.endDate !== v.startDate ? ` to ${v.endDate}` : ""}`, link: "/time-off" });
        }
        await writeAudit({ actor, action: "leave.request", targetType: "employee", targetId: subject.id, metadata: { requestId, days, startDate: v.startDate, endDate: v.endDate, leaveType: type.slug, filedForOther: forOther, firstStep: status } }, tx);
        return requestId;
      });
    } catch (error) {
      if (isExclusionViolation(error)) return fail("There is already a request covering some of those days.");
      throw error;
    }

    refresh();
    return { ok: true, data: { id } };
  });
}

export type RequestPreview = {
  days: number;
  holidays: { date: string; name: string; calendar: string }[];
  /** Prize-day style types only. */
  balance: { balance: number; reserved: number; available: number } | null;
  /** Teammates with approved time off in the range: names only, never the type. */
  teammatesOff: string[];
};

/** What the form shows while a person picks dates: the days it uses, holidays in the range, their balance and who is off. */
export async function previewRequest(input: unknown): Promise<ActionResult<RequestPreview>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.request", { ownerUserId: actor.id });
    const parsed = previewRequestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const me = await findPerson(sql`${employees.userId} = ${actor.id}`);
    if (!me) return fail("Your people record is not set up yet. Ask HR.");
    const [type] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.id, v.leaveTypeId), isNull(leaveTypes.archivedAt))).limit(1);
    if (!type) return fail("Choose a leave type.");

    const holidays = await holidaysInRange(db, me.id, v.startDate, v.endDate);
    const days = requestDays(v.startDate, v.endDate, v.halfDay, new Set(holidays.map((h) => h.date)), await workingWeekdaysFor(db, me.id, v.startDate));
    let balance: RequestPreview["balance"] = null;
    if (type.tracksBalance) {
      const total = balanceOf(await loadLedger(db, me.id, type.id));
      const reserved = await pendingDays(db, me.id, type.id);
      balance = { balance: total, reserved, available: Math.max(0, total - reserved) };
    }
    const peers = await peerEmployeeIds(db, me.id);
    const off = peers.length
      ? ((await db.execute(sql`
          select distinct e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
          from time.leave_requests r join core.employees e on e.id = r.employee_id
          where r.status = 'approved' and r.employee_id in (${sql.join(peers.map((p) => sql`${p}`), sql`, `)})
            and r.start_date <= ${v.endDate}::date and r.end_date >= ${v.startDate}::date
          order by 2, 1 limit 10`)) as unknown as { first: string; last: string; preferred: string | null }[])
      : [];
    return { ok: true, data: { days, holidays, balance, teammatesOff: off.map((o) => nameOf(o)) } };
  });
}

// --- Deciding ----------------------------------------------------------------------------------

/**
 * Approve or decline a pending request. The person's lead decides first (any lead above them); HR decides last,
 * unless the leave type skips HR. Nobody decides their own request. HR can decline at any step but approves
 * only at its own; a stale lead step is escalated to HR by the daily job.
 */
export async function decideRequest(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = decideRequestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { requestId, decision, note } = parsed.data;
    if (decision === "decline" && !note) return fail("Give a short reason so the person knows why.");
    const today = todayInZone();
    const hrIds = await hrUserIds();

    await db.transaction(async (tx) => {
      const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, requestId)).for("update");
      if (!req) throw new ActionFailure("That request was not found.");
      if (req.status !== "pending_lead" && req.status !== "pending_hr") throw new ActionFailure("That request was already handled.");

      const [person] = await tx
        .select({ id: employees.id, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
        .from(employees)
        .where(eq(employees.id, req.employeeId));
      const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, req.leaveTypeId));
      if (person.userId === actor.id || req.filedBy === actor.id) throw new ActionFailure("Someone else must decide on your own request.");

      const chain = await managerChainUserIds(tx, person.id);
      const inChain = chain.includes(actor.id);
      let level: "lead" | "hr";
      if (req.status === "pending_lead") {
        // Lead step: anyone above the person can decide; HR may only decline.
        await authorize(actor, "timeoff.approve", { ownerUserId: person.userId ?? undefined, managerChainUserIds: chain });
        if (decision === "approve" && !inChain) throw new ActionFailure("This step belongs to the person's lead. If it waits too long it goes to HR.");
        level = inChain ? "lead" : "hr";
      } else {
        await authorize(actor, "timeoff.approve_final");
        level = "hr";
      }

      const now = new Date();
      const employeeName = nameOf(person);
      await tx.insert(leaveApprovals).values({ requestId: req.id, level, decision: decision === "approve" ? "approved" : "declined", decidedBy: actor.id, note: note ?? null });

      if (decision === "decline") {
        await tx.update(leaveRequests).set({ status: "declined", updatedAt: now }).where(eq(leaveRequests.id, req.id));
        if (person.userId) await notify(tx, { userId: person.userId, kind: "timeoff.declined", title: "Your time off request was declined", body: note, link: "/time-off" });
      } else if (level === "lead" && !type.skipHr) {
        await tx.update(leaveRequests).set({ status: "pending_hr", stepStartedOn: today, remindedAt: null, updatedAt: now }).where(eq(leaveRequests.id, req.id));
        await notifyWaiting(tx, { ...req, status: "pending_hr" }, employeeName, chain, hrIds, [person.userId ?? "", req.filedBy, actor.id]);
        if (person.userId) await notify(tx, { userId: person.userId, kind: "timeoff.lead_approved", title: "Your lead approved your time off", body: "It now waits for HR.", link: "/time-off" });
      } else {
        await finalizeApproval(tx, req, type.tracksBalance, actor.id);
        if (person.userId) {
          await notify(tx, { userId: person.userId, kind: "timeoff.approved", title: "Your time off was approved", body: `${req.startDate}${req.endDate !== req.startDate ? ` to ${req.endDate}` : ""}`, link: "/time-off" });
          await queueInvite(tx, req, person.userId, "PUBLISH");
        }
      }
      await writeAudit({ actor, action: `leave.${decision}`, targetType: "employee", targetId: person.id, metadata: { requestId: req.id, level, status: req.status, note: note ?? null } }, tx);
    });

    refresh();
    return { ok: true, data: undefined };
  });
}

// --- Cancelling --------------------------------------------------------------------------------

/**
 * Cancels a request. A person cancels their own while it is pending, or once approved as long as it has not
 * started; HR can cancel anything, including leave already taken. Cancelling approved leave writes a reversal row.
 */
export async function cancelRequest(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = cancelRequestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const today = todayInZone();

    await db.transaction(async (tx) => {
      const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, parsed.data.requestId)).for("update");
      if (!req) throw new ActionFailure("That request was not found.");
      const [person] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, req.employeeId));
      await authorize(actor, "timeoff.cancel", { ownerUserId: person.userId ?? undefined });
      if (req.status === "declined" || req.status === "cancelled") throw new ActionFailure("That request is already closed.");

      const isHr = can(actor, "timeoff.cancel", {}); // only HR holds this for everyone; a person holds it for their own
      if (req.status === "approved" && req.startDate <= today && !isHr) throw new ActionFailure("That leave has started. Ask HR to cancel it.");

      const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, req.leaveTypeId));
      if (req.status === "approved" && type.tracksBalance) {
        await lockEmployeeLedger(tx, req.employeeId);
        const [{ n }] = (await tx.execute(sql`select count(*)::int as n from time.leave_ledger where request_id = ${req.id} and entry_type = 'reversal'`)) as unknown as { n: number }[];
        if (n === 0) {
          await tx.insert(leaveLedger).values({
            employeeId: req.employeeId,
            leaveTypeId: req.leaveTypeId,
            entryType: "reversal",
            days: req.days,
            reason: "Request cancelled",
            // Dated no earlier than the usage it undoes, so the ledger replays them in the right order.
            effectiveOn: req.startDate > today ? req.startDate : today,
            requestId: req.id,
            createdBy: actor.id,
          });
        }
      }
      await tx
        .update(leaveRequests)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.id, cancelReason: parsed.data.reason ?? null, updatedAt: new Date() })
        .where(eq(leaveRequests.id, req.id));
      if (req.status === "approved" && person.userId) await queueInvite(tx, req, person.userId, "CANCEL");
      if (person.userId && person.userId !== actor.id) {
        await notify(tx, { userId: person.userId, kind: "timeoff.cancelled", title: "Your time off request was cancelled", body: parsed.data.reason, link: "/time-off" });
      }
      await writeAudit({ actor, action: "leave.cancel", targetType: "employee", targetId: req.employeeId, metadata: { requestId: req.id, wasStatus: req.status, reason: parsed.data.reason ?? null } }, tx);
    });

    refresh();
    return { ok: true, data: undefined };
  });
}

// --- Calendar invite ---------------------------------------------------------------------------

/** The .ics file for an approved request: the person's own, their downline's (lead), or anyone's (HR). */
export async function getLeaveInvite(input: unknown): Promise<ActionResult<{ fileName: string; content: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = requestIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const [req] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, parsed.data.requestId)).limit(1);
    if (!req) return fail("That request was not found.");
    const [person] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, req.employeeId));
    await authorize(actor, "timeoff.view_requests", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, req.employeeId) });
    if (req.status !== "approved") return fail("Only approved time off has a calendar file.");
    const content = buildLeaveIcs({ uid: req.id, summary: "Day off", startDate: req.startDate, endDate: req.endDate, stampIso: new Date().toISOString() });
    return { ok: true, data: { fileName: "time-off.ics", content } };
  });
}
