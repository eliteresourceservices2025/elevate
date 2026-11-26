// Pure choices for "change a day": what the quick buttons send, and a one-line total. No database and no clock.

import { formatInTimeZone } from "date-fns-tz";
import { stretchOn, type ScheduleLite } from "./schedule";

export type DayShiftInput = { startTime: string; endTime: string; breakMinutes: number; allottedMinutesPerDay?: number };
export type DayClientInput = { clientId: string; shifts: DayShiftInput[] };

/** The usual shift on a day, as the dialog holds it. */
export type UsualShift = { clientId: string | null; startTime: string; endTime: string; breakMinutes: number; zone: string; allottedMinutes: number | null };

const asLite = (s: UsualShift, date: string): ScheduleLite => ({ effectiveFrom: date, effectiveTo: date, startTime: s.startTime, endTime: s.endTime, weekdays: [], breakMinutes: s.breakMinutes, zone: s.zone });

/** Minutes from start to end of a shift (an end at or before the start is the next day). */
export function shiftLength(startTime: string, endTime: string): number {
  const of = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const length = of(endTime) - of(startTime);
  return length <= 0 ? length + 1440 : length;
}

/** The clients that have a shift that day (null = no client), in the order of their first start. */
export function clientsThatDay(usual: readonly UsualShift[], date: string): (string | null)[] {
  const sorted = [...usual].sort((a, b) => stretchOn(asLite(a, date), date)[0] - stretchOn(asLite(b, date), date)[0]);
  return [...new Set(sorted.map((s) => s.clientId))];
}

/**
 * "The whole day for one client, the others off": that client gets one shift from the day's first start, as long as every usual shift added
 * together, with the breaks added up, shown in that client's own zone.
 */
export function wholeDayFor(usual: readonly UsualShift[], clientId: string | null, date: string): DayClientInput[] {
  if (usual.length === 0) return [];
  const mine = usual.find((s) => s.clientId === clientId) ?? usual[0];
  const firstStart = Math.min(...usual.map((s) => stretchOn(asLite(s, date), date)[0]));
  const total = Math.min(1439, usual.reduce((sum, s) => sum + shiftLength(s.startTime, s.endTime), 0));
  const breakMinutes = Math.min(240, usual.reduce((sum, s) => sum + s.breakMinutes, 0));
  const worked = Math.min(960, Math.max(1, total - breakMinutes));
  const shift: DayShiftInput = { startTime: formatInTimeZone(firstStart, mine.zone, "HH:mm"), endTime: formatInTimeZone(firstStart + total * 60_000, mine.zone, "HH:mm"), breakMinutes, allottedMinutesPerDay: worked };
  return clientsThatDay(usual, date).map((id) => ({ clientId: id ?? "", shifts: id === clientId ? [shift] : [] }));
}

/** "Day off for all clients". */
export const allOff = (usual: readonly UsualShift[], date: string): DayClientInput[] => clientsThatDay(usual, date).map((id) => ({ clientId: id ?? "", shifts: [] }));

/** Worked hours (without breaks) of a set of shifts. */
export const workedMinutes = (shifts: readonly { startTime: string; endTime: string; breakMinutes: number }[]): number =>
  shifts.reduce((sum, s) => sum + Math.max(0, shiftLength(s.startTime, s.endTime) - s.breakMinutes), 0);
