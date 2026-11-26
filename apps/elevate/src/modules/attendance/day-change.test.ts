import { fromZonedTime } from "date-fns-tz";
import { describe, expect, it } from "vitest";
import { allOff, wholeDayFor, workedMinutes, type UsualShift } from "./day-change";
import { stopLimit } from "./day-limits";
import { expectedMinutesOn } from "./makeup";
import { dayClash, hasScheduleAround, offClientsOn, schedulesFor, shiftOn, shiftsOn, type ScheduleLite } from "./schedule";

const PHX = "America/Phoenix";
const DATE = "2030-03-04"; // a Monday
const ms = (time: string) => fromZonedTime(`${DATE}T${time}:00`, PHX).getTime();
const base: ScheduleLite = { effectiveFrom: "2030-01-01", effectiveTo: null, startTime: "09:00", endTime: "13:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: 0, zone: PHX, clientId: "A", allottedMinutesPerDay: 240 };
const b: ScheduleLite = { ...base, startTime: "13:00", endTime: "17:00", clientId: "B" };
const change = (o: Partial<ScheduleLite>): ScheduleLite => ({ ...base, effectiveFrom: DATE, effectiveTo: DATE, weekdays: [1], dayChange: true, ...o });

// Client A asks for the full day, client B says not to work.
const fullA = change({ startTime: "09:00", endTime: "17:00", allottedMinutesPerDay: 480 });
const offB = change({ clientId: "B", startTime: "13:00", endTime: "17:00", off: true });
const effective = [base, b, fullA, offB];

describe("a one-day change", () => {
  it("replaces that client's shifts on that day only", () => {
    expect(shiftsOn(effective, PHX, DATE).map((s) => [s.schedule.clientId, s.scheduledMinutes])).toEqual([["A", 480]]);
    expect(shiftsOn(effective, PHX, "2030-03-05").map((s) => s.schedule.clientId)).toEqual(["A", "B"]);
    expect(shiftOn(effective, PHX, DATE)!.scheduledMinutes).toBe(480);
  });

  it("knows who is turned off that day, and refuses work for them even inside the other shift", () => {
    expect([...offClientsOn(effective, PHX, DATE)]).toEqual(["B"]);
    const input = { nowMs: ms("14:00"), hasSchedule: true, shifts: shiftsOn(effective, PHX, DATE), offClientIds: offClientsOn(effective, PHX, DATE), workedMsByClient: new Map<string | null, number>(), workedMsToday: 0, dailyCapMinutes: null, companyDefaultCapMinutes: 480, approvedWindows: [] };
    expect(stopLimit({ ...input, clientId: "B" })).toMatchObject({ limitMs: ms("14:00"), overrunMs: Infinity });
    expect(stopLimit({ ...input, clientId: "A" })).toMatchObject({ limitMs: ms("17:00"), overrunMs: 0 });
    // An approved window still lets them work.
    expect(stopLimit({ ...input, clientId: "B", approvedWindows: [{ startMs: ms("13:00"), endMs: ms("15:00") }] }).limitMs).toBe(ms("15:00"));
  });

  it("makes a rest day when everything is off", () => {
    const off = [base, b, change({ off: true }), offB];
    expect(shiftOn(off, PHX, DATE)).toBeNull();
    expect(hasScheduleAround(off, DATE)).toBe(true);
    expect(schedulesFor(off, DATE).every((s) => s.off)).toBe(true);
  });

  it("is checked against the shifts that stay", () => {
    expect(dayClash([base, b, fullA], DATE)).toBe(b);
    expect(dayClash(effective, DATE)).toBeNull();
  });
});

describe("the quick choices", () => {
  const usual: UsualShift[] = [
    { clientId: "A", startTime: "09:00", endTime: "13:00", breakMinutes: 0, zone: PHX, allottedMinutes: 240 },
    { clientId: "B", startTime: "13:00", endTime: "17:00", breakMinutes: 30, zone: PHX, allottedMinutes: 240 },
  ];

  it("gives the whole day to one client", () => {
    expect(wholeDayFor(usual, "A", DATE)).toEqual([
      { clientId: "A", shifts: [{ startTime: "09:00", endTime: "17:00", breakMinutes: 30, allottedMinutesPerDay: 450 }] },
      { clientId: "B", shifts: [] },
    ]);
    expect(workedMinutes(wholeDayFor(usual, "A", DATE)[0].shifts)).toBe(450);
  });

  it("writes the times in that client's own zone", () => {
    const inNewYork: UsualShift = { ...usual[1], zone: "America/New_York", startTime: "15:00", endTime: "19:00" }; // 13:00 in Phoenix in March (before daylight saving)
    expect(wholeDayFor([usual[0], inNewYork], "B", DATE)[1].shifts[0]).toMatchObject({ startTime: "11:00", endTime: "19:00" });
  });

  it("turns everything off", () => {
    expect(allOff(usual, DATE)).toEqual([{ clientId: "A", shifts: [] }, { clientId: "B", shifts: [] }]);
  });
});

describe("a day off for someone with no fixed schedule", () => {
  const input = { nowMs: ms("10:00"), hasSchedule: false, shifts: [], clientId: null, workedMsByClient: new Map<string | null, number>(), workedMsToday: 0, dailyCapMinutes: 0, companyDefaultCapMinutes: 480, approvedWindows: [] };

  it("blocks the clock unless a window is approved, and expects nothing", () => {
    expect(stopLimit(input)).toMatchObject({ limitMs: ms("10:00"), overrunMs: Infinity });
    expect(stopLimit({ ...input, approvedWindows: [{ startMs: ms("09:00"), endMs: ms("11:00") }] }).limitMs).toBe(ms("11:00"));
    expect(expectedMinutesOn({ scheduledMinutes: null, hasSchedule: false, isoWeekday: 1, capMinutes: 0 })).toBeNull();
  });
});
