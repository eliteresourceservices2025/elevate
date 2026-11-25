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
import { requestAutoStop } from "./auto-stop-limit";
import { addDays, clashingSchedule, describeSchedule, type ScheduleLite } from "./schedule";
import { assignedToClient } from "./extra-hours-service";
import { dailyHours, schedules } from "./schema";
import { defaultScheduleZone, loadSchedules } from "./schedule-service";
import { lockEmployeeClock } from "./service";
import { rebuildAttendanceDays } from "./jobs";
import { assignScheduleSchema, endSchedulesSchema, removeScheduleSchema, replaceScheduleSchema, setDayHoursSchema, updateScheduleSchema } from "./validators";

// HR (and Super Admin) set shifts. Leads and people read them. A person can hold several at once. Ending or replacing one sets its last day, and
// one that never took effect is marked removed: nothing is deleted.

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the request and try again.";
const MAX_BACKDATE_DAYS = 7;
const refresh = () => {
  revalidatePath("/schedules", "layout");
  revalidatePath("/attendance");
  revalidatePath("/time-off");
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = Awaited<ReturnType<typeof requireUser>>;
type Entry = Awaited<ReturnType<typeof loadSchedules>>[number];
type ShiftInput = { startTime: string; endTime: string; weekdays: number[]; breakMinutes: number; clientId?: string; allottedMinutesPerDay?: number };

const earliestDay = () => addDays(todayInZone(), -MAX_BACKDATE_DAYS);

async function activePerson(tx: Tx, employeeId: string) {
  const [person] = await tx
    .select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
  if (!person) throw new ActionFailure("That person was not found.");
  return { ...person, name: reportName({ first: person.first, last: person.last, preferred: person.preferred }) };
}

/** The entry with this id, read again under the person's clock lock so two changes cannot cross. */
async function lockedEntry(tx: Tx, scheduleId: string) {
  const [row] = await tx.select({ employeeId: schedules.employeeId }).from(schedules).where(eq(schedules.id, scheduleId));
  if (!row) throw new ActionFailure("That schedule was not found. Reload the page.");
  await lockEmployeeClock(tx, row.employeeId);
  const all = await loadSchedules(tx, row.employeeId);
  const entry = all.find((s) => s.id === scheduleId);
  if (!entry) throw new ActionFailure("That schedule was removed. Reload the page.");
  return { employeeId: row.employeeId, person: await activePerson(tx, row.employeeId), entry, others: all.filter((s) => s.id !== scheduleId) };
}

/** The new entry for one person: checks the client assignment and that its hours do not cross anything else they hold. */
async function buildEntry(tx: Tx, input: { employeeId: string; name: string; shift: ShiftInput; zone?: string; from: string; to: string | null; others: readonly Entry[] }): Promise<ScheduleLite> {
  const { employeeId, name, shift, from, to } = input;
  const clientId = shift.clientId ?? null;
  let zone = input.zone;
  if (clientId) {
    if (!(await assignedToClient(tx, employeeId, clientId, from))) throw new ActionFailure(`${name} is not assigned to that client on ${formatDateOnly(from)}.`);
    if (!zone) {
      const [c] = (await tx.execute(sql`select time_zone from core.clients where id = ${clientId}`)) as unknown as { time_zone: string }[];
      zone = c?.time_zone;
    }
  }
  zone ??= await defaultScheduleZone(tx, employeeId);
  const candidate: ScheduleLite = { startTime: shift.startTime, endTime: shift.endTime, weekdays: shift.weekdays, breakMinutes: shift.breakMinutes, zone, effectiveFrom: from, effectiveTo: to, clientId, allottedMinutesPerDay: shift.allottedMinutesPerDay ?? null };
  const clash = clashingSchedule(input.others, candidate);
  if (clash) {
    const d = describeSchedule(clash, clash.effectiveFrom);
    throw new ActionFailure(`${name}: ${shift.startTime} to ${shift.endTime} overlaps another schedule (${d.days}, ${d.client}, ${clash.zone}, from ${formatDateOnly(clash.effectiveFrom)}). Change the hours or days, or replace or remove that one first.`);
  }
  return candidate;
}

async function insertEntry(tx: Tx, actor: Actor, employeeId: string, entry: ScheduleLite): Promise<string> {
  const [made] = await tx
    .insert(schedules)
    .values({ employeeId, effectiveFrom: entry.effectiveFrom, effectiveTo: entry.effectiveTo, startTime: entry.startTime, endTime: entry.endTime, weekdays: [...entry.weekdays], breakMinutes: entry.breakMinutes, zone: entry.zone, clientId: entry.clientId ?? null, allottedMinutesPerDay: entry.allottedMinutesPerDay ?? null, createdBy: actor.id, changedAt: new Date() })
    .returning({ id: schedules.id });
  return made.id;
}

/** Stops an entry after `lastDay`, or marks it removed when it had not started by then. */
async function stopEntry(tx: Tx, actor: Actor, entry: Entry, lastDay: string): Promise<"ended" | "removed"> {
  if (lastDay < entry.effectiveFrom) {
    await tx.update(schedules).set({ removedAt: new Date(), removedBy: actor.id, changedAt: new Date() }).where(eq(schedules.id, entry.id));
    return "removed";
  }
  await tx.update(schedules).set({ effectiveTo: lastDay, changedAt: new Date() }).where(eq(schedules.id, entry.id));
  return "ended";
}

const snapshot = (s: ScheduleLite) => ({ effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo, startTime: s.startTime, endTime: s.endTime, weekdays: [...s.weekdays], breakMinutes: s.breakMinutes, zone: s.zone, clientId: s.clientId ?? null, allottedMinutesPerDay: s.allottedMinutesPerDay ?? null });

async function tell(tx: Tx, userId: string | null, title: string, body: string) {
  if (userId) await notify(tx, { userId, kind: "schedule.assigned", title, body, link: "/schedules" });
}

/** How many people are rebuilt at the same time after a bulk change (the database limiter keeps the total in check). */
const REBUILD_PARALLEL = 4;

/**
 * Late, absence and extra-hours flags follow the schedule: rebuild recent days from the clock events, and let a running clock take the new
 * hours. The saved change stands even if this fails; the nightly job and the auto-stop sweep catch up.
 */
async function afterChange(employeeIds: string[], from: string): Promise<void> {
  const today = todayInZone();
  const days = from > today ? 0 : Math.min(14, Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1));
  for (let i = 0; i < employeeIds.length; i += REBUILD_PARALLEL) {
    await Promise.all(
      employeeIds.slice(i, i + REBUILD_PARALLEL).map(async (id) => {
        if (days > 0) await rebuildAttendanceDays(new Date(), days, id).catch(() => undefined);
        await requestAutoStop(id);
      }),
    );
  }
}

/**
 * Gives one or many people one or more shift patterns from a date. "add" keeps everything they have; "replace_all" ends everything else the day
 * before. All or nothing: one problem person or shift stops the whole batch with a message naming them.
 */
export async function assignSchedule(input: unknown): Promise<ActionResult<{ assigned: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = assignScheduleSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.effectiveFrom < earliestDay()) return fail(`A schedule cannot start more than ${MAX_BACKDATE_DAYS} days ago.`);
    const ids = [...new Set(v.employeeIds)];
    const dayBefore = addDays(v.effectiveFrom, -1);

    await db.transaction(async (tx) => {
      for (const employeeId of ids) {
        const person = await activePerson(tx, employeeId);
        await lockEmployeeClock(tx, employeeId);
        let held = await loadSchedules(tx, employeeId);
        const stopped: ReturnType<typeof snapshot>[] = [];
        if (v.mode === "replace_all") {
          for (const s of held.filter((s) => s.effectiveTo === null || s.effectiveTo >= v.effectiveFrom)) {
            await stopEntry(tx, actor, s, dayBefore);
            stopped.push(snapshot(s));
          }
          held = await loadSchedules(tx, employeeId);
        }
        const added: ReturnType<typeof snapshot>[] = [];
        const lines: string[] = [];
        for (const shift of v.shifts) {
          const entry = await buildEntry(tx, { employeeId, name: person.name, shift, zone: v.zone, from: v.effectiveFrom, to: null, others: held });
          const id = await insertEntry(tx, actor, employeeId, entry);
          held = [...held, { ...entry, id }];
          added.push(snapshot(entry));
          const d = describeSchedule(entry, v.effectiveFrom);
          lines.push(`${d.days}, ${d.client} (${entry.zone}), which is ${d.manila} in Manila`);
        }
        await writeAudit({ actor, action: "schedule.assign", targetType: "employee", targetId: employeeId, before: stopped.length > 0 ? { schedules: stopped } : null, after: { schedules: added }, metadata: { mode: v.mode, bulk: ids.length } }, tx);
        await tell(tx, person.userId, "Your schedule was set", `${lines.join("; ")}. From ${formatDateOnly(v.effectiveFrom)}.`);
      }
    });
    await afterChange(ids, v.effectiveFrom);
    refresh();
    return { ok: true, data: { assigned: ids.length } };
  });
}

/** Replaces ONE schedule from a date; the person's other schedules stay as they are. */
export async function replaceSchedule(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = replaceScheduleSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.effectiveFrom < earliestDay()) return fail(`A schedule cannot start more than ${MAX_BACKDATE_DAYS} days ago.`);

    const employeeId = await db.transaction(async (tx) => {
      const { employeeId, person, entry, others } = await lockedEntry(tx, v.scheduleId);
      if (entry.effectiveTo !== null && entry.effectiveTo < v.effectiveFrom) throw new ActionFailure("That schedule has already ended by then. Add a new one instead.");
      // A date on or before the entry's start drops it entirely; only a recent or upcoming entry may be dropped.
      if (v.effectiveFrom <= entry.effectiveFrom && entry.effectiveFrom < earliestDay()) throw new ActionFailure("Choose a date after the schedule started.");
      await stopEntry(tx, actor, entry, addDays(v.effectiveFrom, -1));
      const next = await buildEntry(tx, { employeeId, name: person.name, shift: v, zone: v.zone, from: v.effectiveFrom, to: entry.effectiveTo, others });
      await insertEntry(tx, actor, employeeId, next);
      await writeAudit({ actor, action: "schedule.replace", targetType: "employee", targetId: employeeId, before: snapshot(entry), after: snapshot(next) }, tx);
      const d = describeSchedule(next, v.effectiveFrom);
      await tell(tx, person.userId, "Your schedule changed", `${d.days}, ${d.client} (${next.zone}), which is ${d.manila} in Manila. From ${formatDateOnly(v.effectiveFrom)}.`);
      return employeeId;
    });
    await afterChange([employeeId], v.effectiveFrom);
    refresh();
    return { ok: true, data: undefined };
  });
}

/**
 * Fixes a mistake in ONE schedule that started in the last 7 days or has not started yet. Older ones are never rewritten (replace them from a
 * date instead). A reason is required and the before and after are audited.
 */
export async function updateSchedule(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = updateScheduleSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;

    const changed = await db.transaction(async (tx) => {
      const { employeeId, person, entry, others } = await lockedEntry(tx, v.scheduleId);
      if (entry.effectiveFrom < earliestDay()) throw new ActionFailure(`This schedule started more than ${MAX_BACKDATE_DAYS} days ago. Replace it from a date instead.`);
      const next = await buildEntry(tx, { employeeId, name: person.name, shift: v, zone: v.zone ?? entry.zone, from: entry.effectiveFrom, to: entry.effectiveTo, others });
      await tx
        .update(schedules)
        .set({ startTime: next.startTime, endTime: next.endTime, weekdays: [...next.weekdays], breakMinutes: next.breakMinutes, zone: next.zone, clientId: next.clientId ?? null, allottedMinutesPerDay: next.allottedMinutesPerDay ?? null, changedAt: new Date() })
        .where(eq(schedules.id, entry.id));
      await writeAudit({ actor, action: "schedule.correct", targetType: "employee", targetId: employeeId, before: snapshot(entry), after: snapshot(next), metadata: { reason: v.reason } }, tx);
      await tell(tx, person.userId, "Your schedule was corrected", "HR corrected one of your schedules. See Schedules for the details.");
      return { employeeId, from: entry.effectiveFrom };
    });
    await afterChange([changed.employeeId], changed.from);
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Removes ONE schedule: it stops after the last day, or is dropped when it had not started by then. The others stay. */
export async function removeSchedule(input: unknown): Promise<ActionResult<{ outcome: "ended" | "removed" }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = removeScheduleSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { scheduleId, lastDay } = parsed.data;
    if (lastDay < earliestDay()) return fail(`A schedule cannot end more than ${MAX_BACKDATE_DAYS} days ago.`);

    const done = await db.transaction(async (tx) => {
      const { employeeId, person, entry } = await lockedEntry(tx, scheduleId);
      if (entry.effectiveTo !== null && entry.effectiveTo <= lastDay) throw new ActionFailure(`That schedule already ends on ${formatDateOnly(entry.effectiveTo)}.`);
      const outcome = await stopEntry(tx, actor, entry, lastDay);
      await writeAudit({ actor, action: outcome === "removed" ? "schedule.remove" : "schedule.end", targetType: "employee", targetId: employeeId, before: snapshot(entry), after: outcome === "removed" ? null : { effectiveTo: lastDay } }, tx);
      const d = describeSchedule(entry, entry.effectiveFrom);
      const what = `${d.days}, ${d.client} (${entry.zone})`;
      await tell(tx, person.userId, outcome === "removed" ? "A schedule was removed" : "A schedule ended", outcome === "removed" ? `${what} will not apply.` : `${what} ends after ${formatDateOnly(lastDay)}.`);
      return { employeeId, outcome, from: outcome === "removed" ? entry.effectiveFrom : lastDay };
    });
    await afterChange([done.employeeId], done.from);
    refresh();
    return { ok: true, data: { outcome: done.outcome } };
  });
}

/**
 * Ends every current schedule of one or many people on the same date (inclusive: they are still scheduled that day). People with nothing to end
 * are skipped and counted. A schedule that only starts later stops the batch unless HR asks to remove those too. Nothing is deleted.
 */
export async function endSchedules(input: unknown): Promise<ActionResult<{ ended: number; skipped: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = endSchedulesSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { endDate, includeUpcoming, clientId } = parsed.data;
    const ids = [...new Set(parsed.data.employeeIds)];
    if (endDate < earliestDay()) return fail(`A schedule cannot end more than ${MAX_BACKDATE_DAYS} days ago.`);

    const endedIds: string[] = [];
    await db.transaction(async (tx) => {
      for (const employeeId of ids) {
        const person = await activePerson(tx, employeeId);
        await lockEmployeeClock(tx, employeeId);
        const mine = (await loadSchedules(tx, employeeId)).filter((s) => !clientId || s.clientId === clientId);
        const later = mine.filter((s) => s.effectiveFrom > endDate);
        if (later.length > 0 && !includeUpcoming) throw new ActionFailure(`${person.name} has a schedule that starts ${formatDateOnly(later[0].effectiveFrom)}, after that date. Choose a later end date, or tick to remove upcoming schedules too.`);
        // One that already ends by that day needs nothing.
        const open = mine.filter((s) => s.effectiveFrom <= endDate && (s.effectiveTo === null || s.effectiveTo > endDate));
        const targets = [...open, ...later];
        if (targets.length === 0) continue;
        for (const s of targets) {
          const outcome = await stopEntry(tx, actor, s, endDate);
          await writeAudit({ actor, action: outcome === "removed" ? "schedule.remove" : "schedule.end", targetType: "employee", targetId: employeeId, before: snapshot(s), after: outcome === "removed" ? null : { effectiveTo: endDate }, metadata: { bulk: ids.length } }, tx);
        }
        await tell(tx, person.userId, "Your schedule ended", `Your schedule ends after ${formatDateOnly(endDate)}. ELEVATE will no longer use it for attendance flags after that date.`);
        endedIds.push(employeeId);
      }
    });
    await afterChange(endedIds, endDate);
    refresh();
    return { ok: true, data: { ended: endedIds.length, skipped: ids.length - endedIds.length } };
  });
}

const DAY_HOURS_BACK = 31;
const DAY_HOURS_AHEAD = 120;

/**
 * HR sets the hours of specific days for people with no fixed schedule (a contractor who works 4 hours today and other hours tomorrow): the clock
 * stops after that many hours that day, the extra hours prompt follows it and make-up hours count it. A day with minutes null goes back to their
 * usual hours per day. All or nothing: someone not found stops the whole change. One audit row per person says how many days, never the hours.
 */
export async function setDayHours(input: unknown): Promise<ActionResult<{ changed: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = setDayHoursSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { days } = parsed.data;
    const ids = [...new Set(parsed.data.employeeIds)];
    const today = todayInZone();
    if (days.some((d) => d.date < addDays(today, -DAY_HOURS_BACK) || d.date > addDays(today, DAY_HOURS_AHEAD))) return fail(`Choose days from the last ${DAY_HOURS_BACK} days to the next ${DAY_HOURS_AHEAD} days.`);

    let changed = 0;
    await db.transaction(async (tx) => {
      for (const employeeId of ids) {
        const [person] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
        if (!person) throw new ActionFailure("One of those people was not found.");
        let touched = 0;
        for (const d of days) {
          const [row] = await tx.select({ minutes: dailyHours.minutes }).from(dailyHours).where(and(eq(dailyHours.employeeId, employeeId), eq(dailyHours.date, d.date)));
          if (d.minutes === null) {
            if (!row) continue;
            await tx.delete(dailyHours).where(and(eq(dailyHours.employeeId, employeeId), eq(dailyHours.date, d.date)));
          } else if (!row) {
            await tx.insert(dailyHours).values({ employeeId, date: d.date, minutes: d.minutes, setBy: actor.id });
          } else if (row.minutes !== d.minutes) {
            await tx.update(dailyHours).set({ minutes: d.minutes, setBy: actor.id, setAt: new Date() }).where(and(eq(dailyHours.employeeId, employeeId), eq(dailyHours.date, d.date)));
          } else continue;
          touched += 1;
        }
        if (touched > 0) await writeAudit({ actor, action: "schedule.day_hours", targetType: "employee", targetId: employeeId, metadata: { days: touched, bulk: ids.length } }, tx);
        changed += touched;
      }
    });
    refresh();
    return { ok: true, data: { changed } };
  });
}
