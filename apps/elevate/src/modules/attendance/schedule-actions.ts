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
import { addDays, describeSchedule, hoursOverlap } from "./schedule";
import { assignedToClient } from "./extra-hours-service";
import { schedules } from "./schema";
import { defaultScheduleZone, loadSchedules } from "./schedule-service";
import { lockEmployeeClock } from "./service";
import { rebuildAttendanceDays } from "./jobs";
import { assignScheduleSchema, correctScheduleSchema, endScheduleSchema, endSchedulesSchema } from "./validators";

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
        const clientId = v.clientId ?? null;
        if (clientId && !(await assignedToClient(tx, employeeId, clientId, v.effectiveFrom))) throw new ActionFailure(`${name} is not assigned to that client on ${formatDateOnly(v.effectiveFrom)}.`);
        const all = await loadSchedules(tx, employeeId);
        // A person holds one schedule per client at a time (the general schedule counts as its own): only that one is replaced.
        const existing = all.filter((s) => (s.clientId ?? null) === clientId);
        const later = existing.find((s) => s.effectiveFrom >= v.effectiveFrom);
        if (later) throw new ActionFailure(`${name} already has a schedule starting ${formatDateOnly(later.effectiveFrom)}. Choose a date after it.`);
        const open = existing.find((s) => s.effectiveTo === null || s.effectiveTo >= v.effectiveFrom);
        const zone = v.zone ?? (await defaultScheduleZone(tx, employeeId));
        const mine = { startTime: v.startTime, endTime: v.endTime, weekdays: v.weekdays, zone, effectiveFrom: v.effectiveFrom, effectiveTo: null, breakMinutes: v.breakMinutes };
        const clash = all.find((s) => (s.clientId ?? null) !== clientId && (s.effectiveTo === null || s.effectiveTo >= v.effectiveFrom) && hoursOverlap(s, mine));
        if (clash) throw new ActionFailure(`${name} already works ${clash.startTime} to ${clash.endTime} on some of those days for another schedule, so these hours overlap. Change the hours, or end that schedule first.`);
        if (open) await tx.update(schedules).set({ effectiveTo: addDays(v.effectiveFrom, -1) }).where(eq(schedules.id, open.id));

        const row = { employeeId, effectiveFrom: v.effectiveFrom, effectiveTo: null, startTime: v.startTime, endTime: v.endTime, weekdays: v.weekdays, breakMinutes: v.breakMinutes, zone, clientId, allottedMinutesPerDay: v.allottedMinutesPerDay ?? null, createdBy: actor.id };
        await tx.insert(schedules).values(row);
        await writeAudit(
          { actor, action: "schedule.assign", targetType: "employee", targetId: employeeId, before: open ? { effectiveFrom: open.effectiveFrom, startTime: open.startTime, endTime: open.endTime, weekdays: open.weekdays, zone: open.zone } : null, after: { effectiveFrom: v.effectiveFrom, startTime: v.startTime, endTime: v.endTime, weekdays: v.weekdays, breakMinutes: v.breakMinutes, zone, clientId, allottedMinutesPerDay: v.allottedMinutesPerDay ?? null } },
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

      const recent = (await loadSchedules(tx, v.employeeId)).filter((s) => s.effectiveFrom >= cutoff && (s.clientId ?? null) === (v.clientId ?? null));
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

/** How many people are rebuilt at the same time after a bulk change (the database limiter keeps the total in check). */
const REBUILD_PARALLEL = 4;

/**
 * Ends the current schedule of one or many people on the same date (inclusive: they are still scheduled that day). People with no
 * schedule in force that day are skipped and counted. All or nothing for real problems: someone who was not found, or whose next
 * schedule only starts after the end date. Nothing is deleted; the history stays. Their days are then rebuilt, so late, absence and
 * extra-hours flags after that date go away.
 */
export async function endSchedules(input: unknown): Promise<ActionResult<{ ended: number; skipped: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = endSchedulesSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { endDate } = parsed.data;
    const ids = [...new Set(parsed.data.employeeIds)];
    if (endDate < addDays(todayInZone(), -MAX_BACKDATE_DAYS)) return fail(`A schedule cannot end more than ${MAX_BACKDATE_DAYS} days ago.`);

    const endedIds: string[] = [];
    await db.transaction(async (tx) => {
      for (const employeeId of ids) {
        const [person] = await tx
          .select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
          .from(employees)
          .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
        if (!person) throw new ActionFailure("One of those people was not found.");
        const name = reportName({ first: person.first, last: person.last, preferred: person.preferred });

        await lockEmployeeClock(tx, employeeId);
        const existing = await loadSchedules(tx, employeeId);
        const wanted = (s: (typeof existing)[number]) => !parsed.data.clientId || s.clientId === parsed.data.clientId;
        const inForceAll = existing.filter((s) => wanted(s) && s.effectiveFrom <= endDate && (s.effectiveTo === null || s.effectiveTo >= endDate));
        const later = existing.find((s) => wanted(s) && s.effectiveFrom > endDate);
        if (later) throw new ActionFailure(`${name} has a schedule that starts ${formatDateOnly(later.effectiveFrom)}, after that date. Choose a later end date.`);
        const toEnd = inForceAll.filter((s) => s.effectiveTo !== endDate); // one that already ends that day needs nothing
        if (toEnd.length === 0) continue;

        for (const inForce of toEnd) {
          await tx.update(schedules).set({ effectiveTo: endDate }).where(eq(schedules.id, inForce.id));
          await writeAudit({ actor, action: "schedule.end", targetType: "employee", targetId: employeeId, before: { effectiveTo: inForce.effectiveTo }, after: { effectiveTo: endDate }, metadata: { bulk: ids.length, clientId: inForce.clientId ?? null } }, tx);
        }
        if (person.userId) {
          await notify(tx, {
            userId: person.userId,
            kind: "schedule.assigned",
            title: "Your schedule ended",
            body: `Your schedule ends after ${formatDateOnly(endDate)}. ELEVATE will no longer use it for attendance flags after that date.`,
            link: "/schedules",
          });
        }
        endedIds.push(employeeId);
      }
    });

    // The saved change stands even if a refresh fails: the nightly job rebuilds recent days again.
    const days = Math.min(14, Math.max(1, Math.round((Date.parse(`${todayInZone()}T00:00:00Z`) - Date.parse(`${endDate}T00:00:00Z`)) / 86_400_000) + 1));
    for (let i = 0; i < endedIds.length; i += REBUILD_PARALLEL) {
      await Promise.all(endedIds.slice(i, i + REBUILD_PARALLEL).map((id) => rebuildAttendanceDays(new Date(), days, id).catch(() => undefined)));
    }
    refresh();
    return { ok: true, data: { ended: endedIds.length, skipped: ids.length - endedIds.length } };
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
