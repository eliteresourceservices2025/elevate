"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatDateOnly } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { reportName, todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { addDays, describeSchedule } from "./schedule";
import { schedules } from "./schema";
import { defaultScheduleZone, loadSchedules } from "./schedule-service";
import { lockEmployeeClock } from "./service";
import { rebuildAttendanceDays } from "./jobs";
import { assignScheduleSchema, correctScheduleSchema, endScheduleSchema } from "./validators";

// HR (and Super Admin) set shifts. Leads and people read them. Every change is a dated row; the past is never edited.

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the request and try again.";
const MAX_BACKDATE_DAYS = 7;
const refresh = () => {
  revalidatePath("/schedules");
  revalidatePath("/attendance");
  revalidatePath("/time-off");
};

/**
 * Gives one or many people the same shift pattern from a date. A schedule they already have is closed the day before.
 * All or nothing: one problem person stops the whole batch with a message naming them.
 */
export async function assignSchedule(input: unknown): Promise<ActionResult<{ assigned: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = assignScheduleSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.effectiveFrom < addDays(todayInZone(), -MAX_BACKDATE_DAYS)) return fail(`A schedule cannot start more than ${MAX_BACKDATE_DAYS} days ago.`);

    await db.transaction(async (tx) => {
      for (const employeeId of new Set(v.employeeIds)) {
        const [person] = await tx
          .select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
          .from(employees)
          .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
        if (!person) throw new ActionFailure("One of those people was not found.");
        const name = reportName({ first: person.first, last: person.last, preferred: person.preferred });

        await lockEmployeeClock(tx, employeeId);
        const existing = await loadSchedules(tx, employeeId);
        const later = existing.find((s) => s.effectiveFrom >= v.effectiveFrom);
        if (later) throw new ActionFailure(`${name} already has a schedule starting ${formatDateOnly(later.effectiveFrom)}. Choose a date after it.`);
        const open = existing.find((s) => s.effectiveTo === null || s.effectiveTo >= v.effectiveFrom);
        if (open) await tx.update(schedules).set({ effectiveTo: addDays(v.effectiveFrom, -1) }).where(eq(schedules.id, open.id));

        const zone = v.zone ?? (await defaultScheduleZone(tx, employeeId));
        const row = { employeeId, effectiveFrom: v.effectiveFrom, effectiveTo: null, startTime: v.startTime, endTime: v.endTime, weekdays: v.weekdays, breakMinutes: v.breakMinutes, zone, createdBy: actor.id };
        await tx.insert(schedules).values(row);
        await writeAudit(
          { actor, action: "schedule.assign", targetType: "employee", targetId: employeeId, before: open ? { effectiveFrom: open.effectiveFrom, startTime: open.startTime, endTime: open.endTime, weekdays: open.weekdays, zone: open.zone } : null, after: { effectiveFrom: v.effectiveFrom, startTime: v.startTime, endTime: v.endTime, weekdays: v.weekdays, breakMinutes: v.breakMinutes, zone } },
          tx,
        );
        if (person.userId) {
          const d = describeSchedule({ ...row, effectiveTo: null }, v.effectiveFrom);
          await notify(tx, { userId: person.userId, kind: "schedule.assigned", title: "Your schedule was set", body: `${d.days}, ${d.client} (${zone}), which is ${d.manila} in Manila. From ${formatDateOnly(v.effectiveFrom)}.`, link: "/schedules" });
        }
      }
    });
    refresh();
    return { ok: true, data: { assigned: new Set(v.employeeIds).size } };
  });
}

/**
 * Fixes a mistake in a person's RECENT schedules: every schedule that starts within the last 7 days (or later) gets the corrected
 * shift, keeping its own dates. Neighbouring corrected entries that now read the same are joined into one. Older schedules are never
 * rewritten (assign a new one from a date instead). A reason is required and the before/after is audited.
 */
export async function correctSchedule(input: unknown): Promise<ActionResult<{ corrected: number; joined: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = correctScheduleSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const today = todayInZone();
    const cutoff = addDays(today, -MAX_BACKDATE_DAYS);
    let corrected = 0;
    let joined = 0;
    let from = "";

    await db.transaction(async (tx) => {
      const [person] = await tx
        .select({ userId: employees.userId })
        .from(employees)
        .where(and(eq(employees.id, v.employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
      if (!person) throw new ActionFailure("That person was not found.");
      await lockEmployeeClock(tx, v.employeeId);

      const recent = (await loadSchedules(tx, v.employeeId)).filter((s) => s.effectiveFrom >= cutoff);
      if (recent.length === 0) throw new ActionFailure(`They have no schedule that started in the last ${MAX_BACKDATE_DAYS} days. Set a new schedule from a date instead.`);
      from = recent[0].effectiveFrom;

      const before = recent.map((s) => ({ effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo, startTime: s.startTime, endTime: s.endTime, weekdays: s.weekdays, breakMinutes: s.breakMinutes, zone: s.zone }));
      const next = recent.map((s) => ({ ...s, startTime: v.startTime, endTime: v.endTime, weekdays: [...v.weekdays], breakMinutes: v.breakMinutes, zone: v.zone ?? s.zone }));

      // Join neighbours that now read the same and touch (one ends the day before the next starts): the later one is removed first,
      // then the earlier one is stretched, so the no-overlap rule is never broken.
      const kept: typeof next = [];
      for (const s of next) {
        const prev = kept[kept.length - 1];
        if (prev && prev.effectiveTo !== null && addDays(prev.effectiveTo, 1) === s.effectiveFrom && prev.zone === s.zone) {
          await tx.delete(schedules).where(eq(schedules.id, s.id));
          await tx.update(schedules).set({ effectiveTo: s.effectiveTo }).where(eq(schedules.id, prev.id));
          prev.effectiveTo = s.effectiveTo;
          joined += 1;
        } else kept.push(s);
      }
      for (const s of kept) {
        await tx.update(schedules).set({ startTime: s.startTime, endTime: s.endTime, weekdays: s.weekdays, breakMinutes: s.breakMinutes, zone: s.zone }).where(eq(schedules.id, s.id));
      }
      corrected = kept.length;

      await writeAudit(
        { actor, action: "schedule.correct", targetType: "employee", targetId: v.employeeId, before: { schedules: before },
          after: { schedules: kept.map((s) => ({ effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo, startTime: s.startTime, endTime: s.endTime, weekdays: s.weekdays, breakMinutes: s.breakMinutes, zone: s.zone })) },
          metadata: { reason: v.reason, joined } },
        tx,
      );
      if (person.userId) {
        await notify(tx, { userId: person.userId, kind: "schedule.assigned", title: "Your schedule was corrected", body: "HR corrected your recent schedule. See Schedules for the details.", link: "/schedules" });
      }
    });

    // Late, absence and extra-hours flags follow the corrected shift: rebuild from the clock events (never from the correction).
    try {
      const days = Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
      await rebuildAttendanceDays(new Date(), Math.min(days, 14), v.employeeId);
    } catch {
      // the nightly job rebuilds it anyway
    }
    refresh();
    return { ok: true, data: { corrected, joined } };
  });
}

/** Ends a person's current schedule on a date (they then have none, so no late or absence flags). */
export async function endSchedule(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = endScheduleSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, endDate } = parsed.data;
    if (endDate < addDays(todayInZone(), -MAX_BACKDATE_DAYS)) return fail(`A schedule cannot end more than ${MAX_BACKDATE_DAYS} days ago.`);
    await db.transaction(async (tx) => {
      const [person] = await tx
        .select({ userId: employees.userId })
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
      if (!person) throw new ActionFailure("That person was not found.");
      await lockEmployeeClock(tx, employeeId);
      const open = (await loadSchedules(tx, employeeId)).find((s) => s.effectiveTo === null || s.effectiveTo >= endDate);
      if (!open) throw new ActionFailure("They have no schedule to end.");
      if (endDate < open.effectiveFrom) throw new ActionFailure("The end date is before the schedule started.");
      await tx.update(schedules).set({ effectiveTo: endDate }).where(eq(schedules.id, open.id));
      await writeAudit({ actor, action: "schedule.end", targetType: "employee", targetId: employeeId, before: { effectiveTo: open.effectiveTo }, after: { effectiveTo: endDate } }, tx);
      if (person.userId) {
        await notify(tx, {
          userId: person.userId,
          kind: "schedule.assigned",
          title: "Your schedule ended",
          body: `Your schedule ends after ${formatDateOnly(endDate)}. ELEVATE will no longer use it for attendance flags after that date.`,
          link: "/schedules",
        });
      }
    });
    try {
      const days = Math.max(1, Math.round((Date.parse(`${todayInZone()}T00:00:00Z`) - Date.parse(`${endDate}T00:00:00Z`)) / 86_400_000) + 1);
      await rebuildAttendanceDays(new Date(), Math.min(days, 14), employeeId);
    } catch {
      // The nightly job rebuilds attendance if an immediate refresh is unavailable.
    }
    refresh();
    return { ok: true, data: undefined };
  });
}
