"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize, can } from "@/lib/authz";
import type { RoleSlug } from "@/lib/roles";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isExclusionViolation } from "@/lib/db-errors";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { reportName, timeChainUserIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { absenceDateProblem, checkMakeupWindow, shortfallMinutes } from "./makeup";
import { expectedMinutesByDay } from "./makeup-service";
import { loadSchedules } from "./schedule-service";
import { makeupRequests } from "./schema";
import { personForUser, prefsFor } from "./service";
import { cancelMakeupSchema, decideMakeupSchema, makeupRequestSchema } from "./validators";

// Make-up hours: the person asks BEFORE working the time, naming the missed day; a lead (or HR) approves. Nobody decides their own.
// Time worked inside an approved window is straight time, never extra hours (the clock lets them work it, and hours review counts it apart).

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;
const OVERLAP = "Part of that time is already asked for as make-up hours.";
const refresh = () => {
  revalidatePath("/make-up-hours");
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
};
const fmt = (ms: number, zone: string) => formatInZone(ms, zone, "EEE MMM d, h:mm a");

async function nameOf(tx: Pick<typeof db, "select">, employeeId: string): Promise<{ name: string; userId: string | null }> {
  const [e] = await tx.select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees).where(eq(employees.id, employeeId));
  return { name: e ? reportName({ first: e.first, last: e.last, preferred: e.preferred }) : "Someone", userId: e?.userId ?? null };
}

/** The first person above them who can decide make-up hours (a lead, HR or Super Admin), or HR when there is none (an executive or recruiter above them cannot decide). */
async function reviewerIds(tx: Pick<typeof db, "execute" | "select">, employeeId: string, actorId: string): Promise<string[]> {
  const chain = await timeChainUserIds(tx as never, employeeId);
  const roleRows = chain.length === 0 ? [] : ((await tx.execute(sql`select user_id, role_slug from core.user_roles where user_id in (${sql.join(chain.map((id) => sql`${id}`), sql`, `)})`)) as unknown as { user_id: string; role_slug: RoleSlug }[]);
  const deciders = chain.filter((id) => can({ id, roles: roleRows.filter((r) => r.user_id === id).map((r) => r.role_slug) }, "makeup.decide", { managerChainUserIds: chain }));
  const ids = deciders.length > 0 ? deciders.slice(0, 1) : await hrUserIds();
  return ids.filter((id) => id !== actorId);
}

/** Asks to make up missed time. The missed day must have passed, have had scheduled hours that were not all worked, and the window must not have started. */
export async function requestMakeup(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "makeup.request", { ownerUserId: actor.id });
    const parsed = makeupRequestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const person = await personForUser(db, actor.id);
    const prefs = await prefsFor(db, person.id);
    const nowMs = Date.now();
    const startMs = Date.parse(v.windowStart);
    const endMs = Date.parse(v.windowEnd);

    const dayProblem = absenceDateProblem(v.absenceDate, formatInZone(nowMs, prefs.zone, "yyyy-MM-dd"));
    if (dayProblem) return fail(dayProblem);

    // What the day expected of the person (their shift, or their daily hours with no schedule; nothing on a weekend without a schedule, a holiday or approved leave), and what was worked.
    const schedules = await loadSchedules(db, person.id);
    const scheduled = (await expectedMinutesByDay(db, person.id, prefs.zone, v.absenceDate, v.absenceDate, schedules)).get(v.absenceDate) ?? null;
    if (scheduled === null) return fail("You had no working hours that day, so there is nothing to make up.");
    const [day] = (await db.execute(sql`select worked_minutes from time.attendance_days where employee_id = ${person.id} and date = ${v.absenceDate}::date`)) as unknown as { worked_minutes: number }[];
    const missed = shortfallMinutes(scheduled, Number(day?.worked_minutes ?? 0));
    if (missed < 15) return fail("You were not short on hours that day.");

    const [{ already }] = (await db.execute(sql`
      select coalesce(sum(minutes), 0)::int as already from time.makeup_requests
      where employee_id = ${person.id} and absence_date = ${v.absenceDate}::date and status in ('pending', 'approved')`)) as unknown as { already: number }[];
    const problem = checkMakeupWindow({ startMs, endMs, nowMs, missedMinutes: missed, alreadyMinutes: Number(already) });
    if (problem) return fail(problem);
    const minutes = Math.round((endMs - startMs) / 60_000);

    try {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(makeupRequests)
          .values({ employeeId: person.id, absenceDate: v.absenceDate, missedMinutes: Math.min(missed, 960), windowStart: new Date(startMs), windowEnd: new Date(endMs), minutes, reason: v.reason })
          .returning({ id: makeupRequests.id });
        const me = await nameOf(tx, person.id);
        const targets = await reviewerIds(tx, person.id, actor.id);
        await notify(tx, targets.map((userId) => ({ userId, kind: "makeup.requested", title: `${me.name} asked to make up hours`, body: `${fmt(startMs, prefs.zone)} to ${formatInZone(endMs, prefs.zone, "h:mm a")}, for ${v.absenceDate}.`, link: "/make-up-hours" })));
        await writeAudit({ actor, action: "makeup.request", targetType: "employee", targetId: person.id, metadata: { requestId: row.id, minutes, absenceDate: v.absenceDate } }, tx);
      });
    } catch (error) {
      if (isExclusionViolation(error)) return fail(OVERLAP);
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

/** The person's lead (or HR) approves or declines. Nobody decides their own request. */
export async function decideMakeup(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = decideMakeupSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.decision === "decline" && !v.note) return fail("Give a short reason so the person knows why.");
    try {
      await db.transaction(async (tx) => {
        const [r] = await tx.select().from(makeupRequests).where(eq(makeupRequests.id, v.requestId)).for("update");
        if (!r) throw new ActionFailure("That request was not found.");
        const person = await nameOf(tx, r.employeeId);
        if (person.userId === actor.id) throw new ActionFailure("Someone else must decide on your own request.");
        await authorize(actor, "makeup.decide", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await timeChainUserIds(tx as never, r.employeeId) });
        if (r.status !== "pending") throw new ActionFailure("That request was already handled.");
        if (v.decision === "approve" && r.windowEnd.getTime() <= Date.now()) throw new ActionFailure("That time has already passed. Ask the person to send a new request.");
        const prefs = await prefsFor(tx as never, r.employeeId);
        await tx
          .update(makeupRequests)
          .set({ status: v.decision === "approve" ? "approved" : "declined", decidedBy: actor.id, decidedAt: new Date(), decisionNote: v.note ?? null })
          .where(eq(makeupRequests.id, r.id));
        if (person.userId) {
          await notify(tx, {
            userId: person.userId,
            kind: v.decision === "approve" ? "makeup.approved" : "makeup.declined",
            title: v.decision === "approve" ? "Your make-up hours were approved" : "Your make-up hours were declined",
            body: v.decision === "approve" ? `${fmt(r.windowStart.getTime(), prefs.zone)} to ${formatInZone(r.windowEnd.getTime(), prefs.zone, "h:mm a")}.${v.note ? ` ${v.note}` : ""}` : v.note,
            link: "/make-up-hours",
          });
        }
        await writeAudit({ actor, action: `makeup.${v.decision}`, targetType: "employee", targetId: r.employeeId, metadata: { requestId: r.id, minutes: r.minutes } }, tx);
      });
    } catch (error) {
      if (isExclusionViolation(error)) return fail(OVERLAP);
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Withdraws a request: the person while it waits (or when approved and not started yet); their lead or HR can also cancel an approved window that has not started. */
export async function cancelMakeup(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = cancelMakeupSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(makeupRequests).where(eq(makeupRequests.id, parsed.data.requestId)).for("update");
      if (!r) throw new ActionFailure("That request was not found.");
      const person = await nameOf(tx, r.employeeId);
      if (person.userId === actor.id) await authorize(actor, "makeup.request", { ownerUserId: actor.id });
      else await authorize(actor, "makeup.decide", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await timeChainUserIds(tx as never, r.employeeId) });
      const waiting = r.status === "pending";
      if (!waiting && !(r.status === "approved" && r.windowStart.getTime() > Date.now())) throw new ActionFailure("That request can no longer be cancelled.");
      await tx.update(makeupRequests).set({ status: "cancelled", decidedAt: new Date(), decidedBy: actor.id }).where(eq(makeupRequests.id, r.id));
      if (person.userId && person.userId !== actor.id) await notify(tx, { userId: person.userId, kind: "makeup.cancelled", title: "Your make-up hours were cancelled", link: "/make-up-hours" });
      await writeAudit({ actor, action: "makeup.cancel", targetType: "employee", targetId: r.employeeId, metadata: { requestId: r.id, was: r.status } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
