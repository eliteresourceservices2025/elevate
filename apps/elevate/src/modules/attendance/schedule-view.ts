// Pure shaping of a person's schedules for the screens: the entry lines, the week and the Mon-to-Sun chips. No database and no clock.

import { addDays, describeSchedule, isoWeekday, weekOf, type ScheduleLite } from "./schedule";

export type ScheduleEntry = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  from: string;
  to: string | null;
  days: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  breakMinutes: number;
  zone: string;
  allottedMinutes: number | null;
  /** The shift in the schedule's zone and in Manila. */
  clientRange: string;
  manilaRange: string;
  status: "current" | "upcoming" | "past";
  /** Started recently enough (or not yet) to be fixed in place. */
  canEdit: boolean;
};

export type WeekViewDay = { date: string; weekday: number; shifts: { entryId: string; clientName: string | null; startLabel: string; clientRange: string; manilaRange: string }[] };
export type DayChip = { weekday: number; shifts: { entryId: string; clientName: string | null; startLabel: string }[] };

type Entry = ScheduleLite & { id: string };

export const MAX_EDIT_BACK_DAYS = 7;

export function toEntry(s: Entry, today: string, names: ReadonlyMap<string, string>): ScheduleEntry {
  // Describe the shift on a day it really applies (today, or when it starts), so daylight saving shows the right Manila hours.
  const d = describeSchedule(s, s.effectiveFrom > today ? s.effectiveFrom : s.effectiveTo !== null && s.effectiveTo < today ? s.effectiveFrom : today);
  return {
    id: s.id,
    clientId: s.clientId ?? null,
    clientName: s.clientId ? (names.get(s.clientId) ?? null) : null,
    from: s.effectiveFrom,
    to: s.effectiveTo,
    days: d.days,
    startTime: s.startTime,
    endTime: s.endTime,
    weekdays: [...s.weekdays],
    breakMinutes: s.breakMinutes,
    zone: s.zone,
    allottedMinutes: s.allottedMinutesPerDay ?? null,
    clientRange: d.client,
    manilaRange: d.manila,
    status: s.effectiveFrom > today ? "upcoming" : s.effectiveTo !== null && s.effectiveTo < today ? "past" : "current",
    canEdit: s.effectiveFrom >= addDays(today, -MAX_EDIT_BACK_DAYS),
  };
}

export function weekView(schedules: readonly Entry[], weekStart: string, names: ReadonlyMap<string, string>): WeekViewDay[] {
  return weekOf(schedules, weekStart).map((day) => ({
    date: day.date,
    weekday: day.weekday,
    shifts: day.shifts.map((x) => ({ entryId: x.schedule.id, clientName: x.schedule.clientId ? (names.get(x.schedule.clientId) ?? null) : null, startLabel: x.startLabel, clientRange: x.clientRange, manilaRange: x.secondaryRange })),
  }));
}

/** Monday to Sunday as it will run: each weekday is taken from its next date, today included. */
export function weekChips(schedules: readonly Entry[], today: string, names: ReadonlyMap<string, string>): DayChip[] {
  return weekView(schedules, today, names)
    .map((d) => ({ weekday: d.weekday, shifts: d.shifts.map((s) => ({ entryId: s.entryId, clientName: s.clientName, startLabel: s.startLabel })) }))
    .sort((a, b) => a.weekday - b.weekday);
}

/** The first day after today on which something starts or stops, or null. */
export function nextChange(schedules: readonly ScheduleLite[], today: string): string | null {
  const days = schedules.flatMap((s) => [s.effectiveFrom, ...(s.effectiveTo === null ? [] : [addDays(s.effectiveTo, 1)])]).filter((d) => d > today);
  return days.sort()[0] ?? null;
}
