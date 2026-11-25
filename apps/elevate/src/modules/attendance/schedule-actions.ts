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
import { applyDailyCap, reportName, todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { requestAutoStop } from "./auto-stop-limit";
import { addDays, clashingSchedule, dayClash, describeSchedule, isoWeekday, schedulesFor, type ScheduleLite } from "./schedule";
import { assignedToClient } from "./extra-hours-service";
import { dailyHours, scheduleDayChanges, schedules } from "./schema";
import { defaultScheduleZone, loadDayChangesFor, loadSchedules } from "./schedule-service";
import { lockEmployeeClock } from "./service";
import { rebuildAttendanceDays } from "./jobs";
import { assignScheduleSchema, dayChangeSchema, endSchedulesSchema, removeDayChangeSchema, removeScheduleSchema, replaceScheduleSchema, setDayHoursSchema, updateScheduleSchema } from "./validators";

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

const DAY_CHANGE_AHEAD = 120;
const daySnapshot = (s: ScheduleLite) => ({ clientId: s.clientId ?? null, off: s.off ?? false, startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, allottedMinutesPerDay: s.allottedMinutesPerDay ?? null, zone: s.zone });

/**
 * Changes ONE day of a person who has schedules (a client asks for a full day, another says not to work): for each client listed, the shifts they
 * work that day, or none (off). Saving replaces any earlier change of that day. The clock, flags and hours review follow it; pay and invoices
 * still come only from clock events.
 */
export async function setDayChange(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = dayChangeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const today = todayInZone();
    if (v.date < earliestDay() || v.date > addDays(today, DAY_CHANGE_AHEAD)) return fail(`Choose a day from ${MAX_BACKDATE_DAYS} days ago to ${DAY_CHANGE_AHEAD} days ahead.`);
    const weekday = isoWeekday(v.date);

    await db.transaction(async (tx) => {
      const person = await activePerson(tx, v.employeeId);
      await lockEmployeeClock(tx, v.employeeId);
      const base = await loadSchedules(tx, v.employeeId);
      const inForce = schedulesFor(base, v.date);
      if (inForce.length === 0) throw new ActionFailure(`${person.name} has no fixed schedule on ${formatDateOnly(v.date)}. Use hours per day for them instead.`);
      const usual = inForce.filter((x) => x.weekdays.includes(weekday));

      const rowsToAdd: ScheduleLite[] = [];
      for (const c of v.clients) {
        const clientId = c.clientId ?? null;
        const mine = usual.filter((x) => (x.clientId ?? null) === clientId);
        const common = { effectiveFrom: v.date, effectiveTo: v.date, weekdays: [weekday], clientId, dayChange: true };
        if (c.shifts.length === 0) {
          if (mine.length === 0) throw new ActionFailure("There is no shift to turn off for that client on that day.");
          // The off row keeps the times of the shift it turns off, so it falls on the same day in the person's own zone.
          rowsToAdd.push(...mine.map((x) => ({ ...common, startTime: x.startTime, endTime: x.endTime, breakMinutes: 0, zone: x.zone, allottedMinutesPerDay: null, off: true })));
          continue;
        }
        let zone = inForce.find((x) => (x.clientId ?? null) === clientId)?.zone;
        if (clientId) {
          if (!(await assignedToClient(tx, v.employeeId, clientId, v.date))) throw new ActionFailure(`${person.name} is not assigned to that client on ${formatDateOnly(v.date)}.`);
          if (!zone) {
            const [client] = (await tx.execute(sql`select time_zone from core.clients where id = ${clientId}`)) as unknown as { time_zone: string }[];
            zone = client?.time_zone;
          }
        }
        zone ??= inForce[0].zone;
        rowsToAdd.push(...c.shifts.map((x) => ({ ...common, startTime: x.startTime, endTime: x.endTime, breakMinutes: x.breakMinutes, zone, allottedMinutesPerDay: x.allottedMinutesPerDay ?? null, off: false })));
      }

      const earlier = (await loadDayChangesFor(tx, [v.employeeId])).get(v.employeeId) ?? [];
      const replaced = earlier.filter((x) => x.effectiveFrom === v.date);
      const clash = dayClash([...base, ...earlier.filter((x) => x.effectiveFrom !== v.date), ...rowsToAdd], v.date);
      if (clash) throw new ActionFailure(`Those hours overlap ${clash.startTime} to ${clash.endTime} (${clash.zone}). Change the times, or turn that shift off.`);

      if (replaced.length > 0) await tx.update(scheduleDayChanges).set({ removedAt: new Date(), removedBy: actor.id }).where(and(eq(scheduleDayChanges.employeeId, v.employeeId), eq(scheduleDayChanges.date, v.date), isNull(scheduleDayChanges.removedAt)));
      await tx.insert(scheduleDayChanges).values(rowsToAdd.map((x) => ({ employeeId: v.employeeId, date: v.date, clientId: x.clientId ?? null, off: x.off ?? false, startTime: x.startTime, endTime: x.endTime, breakMinutes: x.breakMinutes, allottedMinutesPerDay: x.allottedMinutesPerDay ?? null, zone: x.zone, reason: v.reason, createdBy: actor.id })));
      await writeAudit({ actor, action: "schedule.day_change", targetType: "employee", targetId: v.employeeId, before: replaced.length > 0 ? { date: v.date, shifts: replaced.map(daySnapshot) } : null, after: { date: v.date, shifts: rowsToAdd.map(daySnapshot) }, metadata: { reason: v.reason } }, tx);
      await tell(tx, person.userId, "Your schedule changed for one day", `${formatDateOnly(v.date)} is different from usual. See Schedules for the hours.`);
    });
    await afterChange([v.employeeId], v.date);
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Undoes the change of one day: the usual schedules apply again. */
export async function removeDayChange(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = removeDayChangeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.date < earliestDay()) return fail(`A change more than ${MAX_BACKDATE_DAYS} days old cannot be undone.`);

    await db.transaction(async (tx) => {
      const person = await activePerson(tx, v.employeeId);
      await lockEmployeeClock(tx, v.employeeId);
      const mine = ((await loadDayChangesFor(tx, [v.employeeId])).get(v.employeeId) ?? []).filter((x) => x.effectiveFrom === v.date);
      if (mine.length === 0) throw new ActionFailure("That day has no change to undo.");
      await tx.update(scheduleDayChanges).set({ removedAt: new Date(), removedBy: actor.id }).where(and(eq(scheduleDayChanges.employeeId, v.employeeId), eq(scheduleDayChanges.date, v.date), isNull(scheduleDayChanges.removedAt)));
      await writeAudit({ actor, action: "schedule.day_change_undo", targetType: "employee", targetId: v.employeeId, before: { date: v.date, shifts: mine.map(daySnapshot) }, after: null }, tx);
      await tell(tx, person.userId, "Your usual schedule applies again", `The change for ${formatDateOnly(v.date)} was undone.`);
    });
    await afterChange([v.employeeId], v.date);
    refresh();
    return { ok: true, data: undefined };
  });
}

const DAY_HOURS_BACK = 31;
const DAY_HOURS_AHEAD = 120;

/**
 * HR sets the hours of specific days (and optionally the usual hours per day) for people with no fixed schedule: the clock stops after that many
 * hours that day, 0 blocks clock-in, null goes back to the usual hours. People who have a fixed schedule on those days are skipped and named, since
 * these numbers would do nothing for them. All or nothing otherwise. `preview` returns the counts without writing. The audit says how many days,
 * never the hours.
 */
export async function setDayHours(input: unknown): Promise<ActionResult<{ changed: number; replaced: number; skipped: string[] }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "schedules.manage");
    const parsed = setDayHoursSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { days, usualMinutes, preview } = parsed.data;
    if (usualMinutes !== undefined) await authorize(actor, "org.manage_reporting");
    const ids = [...new Set(parsed.data.employeeIds)];
    const today = todayInZone();
    if (days.some((d) => d.date < addDays(today, -DAY_HOURS_BACK) || d.date > addDays(today, DAY_HOURS_AHEAD))) return fail(`Choose days from the last ${DAY_HOURS_BACK} days to the next ${DAY_HOURS_AHEAD} days.`);

    let changed = 0;
    let replaced = 0;
    const skipped: string[] = [];
    const touchedIds: string[] = [];
    await db.transaction(async (tx) => {
      for (const employeeId of ids) {
        const person = await activePerson(tx, employeeId);
        await lockEmployeeClock(tx, employeeId);
        const fixed = await loadSchedules(tx, employeeId);
        const dates = days.length > 0 ? days.map((d) => d.date) : [today];
        if (dates.some((date) => schedulesFor(fixed, date).length > 0)) {
          skipped.push(person.name);
          continue;
        }
        let touched = 0;
        for (const d of days) {
          const [row] = await tx.select({ minutes: dailyHours.minutes }).from(dailyHours).where(and(eq(dailyHours.employeeId, employeeId), eq(dailyHours.date, d.date)));
          if (row ? row.minutes === d.minutes : d.minutes === null) continue;
          touched += 1;
          if (row) replaced += 1;
          if (preview) continue;
          if (d.minutes === null) await tx.delete(dailyHours).where(and(eq(dailyHours.employeeId, employeeId), eq(dailyHours.date, d.date)));
          else if (!row) await tx.insert(dailyHours).values({ employeeId, date: d.date, minutes: d.minutes, setBy: actor.id });
          else await tx.update(dailyHours).set({ minutes: d.minutes, setBy: actor.id, setAt: new Date() }).where(and(eq(dailyHours.employeeId, employeeId), eq(dailyHours.date, d.date)));
        }
        const usualChanged = !preview && usualMinutes !== undefined && (await applyDailyCap(tx, actor, employeeId, usualMinutes, ids.length));
        changed += touched;
        if (preview || (touched === 0 && !usualChanged)) continue;
        touchedIds.push(employeeId);
        if (touched > 0) await writeAudit({ actor, action: "schedule.day_hours", targetType: "employee", targetId: employeeId, metadata: { days: touched, bulk: ids.length } }, tx);
        await tell(tx, person.userId, "Your hours per day changed", "See Schedules for your hours.");
      }
    });
    if (touchedIds.length > 0) {
      await afterChange(touchedIds, today);
      refresh();
    }
    return { ok: true, data: { changed, replaced, skipped } };
  });
}
