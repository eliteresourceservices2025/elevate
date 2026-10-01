import { describe, expect, it } from "vitest";
import { addDays, describeSchedule, earlyLeaveMinutes, extraMinutes, hasScheduleAround, isValidTime, isoWeekday, lateMinutes, scheduleFor, shiftOn, weekdaysLabel, workingWeekdaysInZone, type ScheduleLite } from "./schedule";

const NY = "America/New_York";
const MANILA = "Asia/Manila";
const PHOENIX = "America/Phoenix";

const nineToFive: ScheduleLite = { effectiveFrom: "2026-01-01", effectiveTo: null, startTime: "09:00", endTime: "17:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: 60, zone: NY };
const nightShift: ScheduleLite = { effectiveFrom: "2026-01-01", effectiveTo: null, startTime: "22:00", endTime: "06:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: 30, zone: PHOENIX };

describe("dates", () => {
  it("numbers weekdays Monday 1 to Sunday 7", () => {
    expect(isoWeekday("2026-10-05")).toBe(1); // a Monday
    expect(isoWeekday("2026-10-11")).toBe(7);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("accepts only HH:mm times", () => {
    for (const ok of ["00:00", "09:30", "23:59"]) expect(isValidTime(ok)).toBe(true);
    for (const bad of ["24:00", "9:30", "09:60", "0930", "", "ab:cd"]) expect(isValidTime(bad)).toBe(false);
  });
});

describe("which schedule applies", () => {
  it("picks the one in force on the date, and the latest when two overlap", () => {
    const old: ScheduleLite = { ...nineToFive, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" };
    const current: ScheduleLite = { ...nineToFive, effectiveFrom: "2026-07-01", startTime: "10:00" };
    expect(scheduleFor([old, current], "2026-03-01")).toBe(old);
    expect(scheduleFor([old, current], "2026-06-30")).toBe(old);
    expect(scheduleFor([old, current], "2026-07-01")).toBe(current);
    expect(scheduleFor([old, current], "2025-12-31")).toBeNull();
  });
});

describe("a shift and the day it belongs to", () => {
  it("is a 9 to 5 New York shift for someone in New York, with the planned break taken out", () => {
    const shift = shiftOn([nineToFive], NY, "2026-10-05")!; // Monday
    expect(shift.scheduledMinutes).toBe(420); // 8 hours minus a 60 minute break
    expect(new Date(shift.startMs).toISOString()).toBe("2026-10-05T13:00:00.000Z"); // 9 AM EDT
    expect(new Date(shift.endMs).toISOString()).toBe("2026-10-05T21:00:00.000Z");
  });

  it("is no shift on a rest day", () => {
    expect(shiftOn([nineToFive], NY, "2026-10-10")).toBeNull(); // Saturday
    expect(shiftOn([nineToFive], NY, "2026-10-11")).toBeNull(); // Sunday
  });

  it("puts a US day shift worked from Manila on the Manila day it starts, with both times shown", () => {
    // 9 AM New York (EDT) is 9 PM in Manila the SAME calendar date; it ends 5 AM Manila the next day.
    const shift = shiftOn([nineToFive], MANILA, "2026-10-05")!;
    expect(new Date(shift.startMs).toISOString()).toBe("2026-10-05T13:00:00.000Z");
    expect(shiftOn([nineToFive], MANILA, "2026-10-06")!.date).toBe("2026-10-06");
    // Friday's shift ends Saturday morning in Manila, but Saturday has no shift of its own
    expect(shiftOn([nineToFive], MANILA, "2026-10-10")).toBeNull();
    expect(shiftOn([nineToFive], MANILA, "2026-10-09")).not.toBeNull();
  });

  it("handles an overnight shift: it belongs to the day it starts and ends the next morning", () => {
    const shift = shiftOn([nightShift], PHOENIX, "2026-10-05")!;
    expect(shift.scheduledMinutes).toBe(450); // 8 hours minus 30
    expect(new Date(shift.endMs).getTime() - new Date(shift.startMs).getTime()).toBe(8 * 3_600_000);
    expect(shiftOn([nightShift], PHOENIX, "2026-10-06")!.date).toBe("2026-10-06");
    expect(shiftOn([nightShift], PHOENIX, "2026-10-10")).toBeNull(); // Friday night's shift belongs to Friday, Saturday has none
  });

  it("keeps the client's local hours across daylight saving, so the Manila hours move by an hour", () => {
    const before = shiftOn([nineToFive], MANILA, "2026-11-02")!; // after the US clocks went back (Nov 1)
    const during = shiftOn([nineToFive], MANILA, "2026-10-05")!;
    expect(new Date(during.startMs).getUTCHours()).toBe(13); // 9 AM EDT
    expect(new Date(before.startMs).getUTCHours()).toBe(14); // 9 AM EST
  });

  it("treats the day as unscheduled only when the person has no schedule at all", () => {
    expect(hasScheduleAround([nineToFive], "2026-10-10")).toBe(true);
    expect(hasScheduleAround([], "2026-10-10")).toBe(false);
    expect(hasScheduleAround([{ ...nineToFive, effectiveFrom: "2027-01-01" }], "2026-10-10")).toBe(false);
  });
});

describe("late, early and extra", () => {
  const shift = shiftOn([nineToFive], NY, "2026-10-05")!;
  const at = (hhmmUtc: string) => Date.parse(`2026-10-05T${hhmmUtc}:00Z`);

  it("counts lateness only past the grace period, from the shift start", () => {
    expect(lateMinutes(at("13:05"), shift, 10)).toBe(0);
    expect(lateMinutes(at("13:10"), shift, 10)).toBe(0); // exactly the grace
    expect(lateMinutes(at("13:11"), shift, 10)).toBe(11);
    expect(lateMinutes(at("12:50"), shift, 10)).toBe(0); // early arrival is fine
  });

  it("counts an early leave only past the grace period", () => {
    expect(earlyLeaveMinutes(at("20:55"), shift, 10)).toBe(0);
    expect(earlyLeaveMinutes(at("20:40"), shift, 10)).toBe(20);
    expect(earlyLeaveMinutes(at("21:30"), shift, 10)).toBe(0);
  });

  it("counts total worked time beyond the scheduled hours, ignoring under 15 minutes, so a shifted day is not extra", () => {
    const base = { shift, hasSchedule: true, holiday: false };
    expect(extraMinutes({ ...base, workedMinutes: 420 })).toBe(0);
    expect(extraMinutes({ ...base, workedMinutes: 433 })).toBe(0); // 13 minutes over
    expect(extraMinutes({ ...base, workedMinutes: 435 })).toBe(15);
    expect(extraMinutes({ ...base, workedMinutes: 540 })).toBe(120);
    expect(extraMinutes({ ...base, workedMinutes: 300 })).toBe(0); // short day is not extra
  });

  it("counts a rest day or holiday in full, and nothing for people with no schedule", () => {
    expect(extraMinutes({ workedMinutes: 240, shift: null, hasSchedule: true, holiday: false })).toBe(240);
    expect(extraMinutes({ workedMinutes: 240, shift, hasSchedule: true, holiday: true })).toBe(240);
    expect(extraMinutes({ workedMinutes: 10, shift: null, hasSchedule: true, holiday: false })).toBe(0);
    expect(extraMinutes({ workedMinutes: 600, shift: null, hasSchedule: false, holiday: false })).toBe(0);
  });
});

describe("showing a schedule", () => {
  it("describes it in the client's zone and in Manila", () => {
    const d = describeSchedule(nineToFive, "2026-10-05");
    expect(d.days).toBe("Mon to Fri");
    expect(d.client).toBe("9:00 AM - 5:00 PM");
    expect(d.manila).toBe("9:00 PM - 5:00 AM");
  });

  it("labels weekdays in plain words", () => {
    expect(weekdaysLabel([1, 2, 3, 4, 5])).toBe("Mon to Fri");
    expect(weekdaysLabel([7, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(weekdaysLabel([2, 3, 4, 5, 6])).toBe("Tue to Sat");
    expect(weekdaysLabel([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(weekdaysLabel([6, 7])).toBe("Sat, Sun");
  });

  it("gives the weekdays a person actually works in their own zone, for counting leave days", () => {
    // 9 AM New York Monday to Friday is Monday to Friday evening in Manila: the same days
    expect([...workingWeekdaysInZone(nineToFive, MANILA)].sort()).toEqual([1, 2, 3, 4, 5]);
    // A shift that starts at 8 PM in Phoenix (Mon to Fri) starts at 11 AM the next day in Manila
    const lateStart: ScheduleLite = { ...nightShift, startTime: "20:00", endTime: "04:00" };
    expect([...workingWeekdaysInZone(lateStart, MANILA)].sort()).toEqual([2, 3, 4, 5, 6]);
  });
});
