import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { breakAllowanceLeft, dailyBreakAllowance, stopLimit, type StopLimitInput } from "./day-limits";
import { shiftsOn, type ScheduleLite, type Shift } from "./schedule";
import type { Break } from "./clock";

const PHX = "America/Phoenix";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DATE = "2030-03-04"; // a Monday
const ms = (time: string, date = DATE) => fromZonedTime(`${date}T${time}:00`, PHX).getTime();

const base: ScheduleLite = { effectiveFrom: "2030-01-01", effectiveTo: null, startTime: "09:00", endTime: "13:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: 0, zone: PHX, clientId: "A", allottedMinutesPerDay: 240 };
const clientA: ScheduleLite = base;
const clientB: ScheduleLite = { ...base, startTime: "14:00", endTime: "18:00", clientId: "B", allottedMinutesPerDay: 200 };

describe("shiftsOn", () => {
  it("returns every shift that starts on the day, earliest first, each with its own break taken out", () => {
    const withBreak: ScheduleLite = { ...clientB, breakMinutes: 30 };
    const shifts = shiftsOn([withBreak, clientA], PHX, DATE);
    expect(shifts.map((s) => s.schedule.clientId)).toEqual(["A", "B"]);
    expect(shifts.map((s) => s.scheduledMinutes)).toEqual([240, 210]);
  });

  it("returns nothing on a rest day", () => {
    expect(shiftsOn([clientA, clientB], PHX, "2030-03-09")).toEqual([]);
  });

  it("uses only the latest schedule of one client when two overlap by date", () => {
    const old: ScheduleLite = { ...clientA, effectiveFrom: "2030-01-01", effectiveTo: "2030-03-31", endTime: "12:00" };
    const current: ScheduleLite = { ...clientA, effectiveFrom: "2030-03-01" };
    expect(shiftsOn([old, current], PHX, DATE)).toHaveLength(1);
    expect(shiftsOn([old, current], PHX, DATE)[0].schedule).toBe(current);
  });
});

describe("breakAllowanceLeft", () => {
  const brk = (from: string, to: string | null, planned: number | null = null): Break => ({ startAt: ms(from), endAt: to ? ms(to) : null, plannedMinutes: planned });

  it("is the whole allowance when no break was taken", () => {
    expect(breakAllowanceLeft({ allowanceMinutes: 60, breaks: [], nowMs: ms("10:00") })).toBe(60);
  });

  it("counts the time actually taken, so a break that ran over leaves less", () => {
    const breaks = [brk("10:00", "10:15", 15), brk("12:00", "12:40", 30)];
    expect(breakAllowanceLeft({ allowanceMinutes: 60, breaks, nowMs: ms("13:00") })).toBe(5);
  });

  it("gives back what a short break did not use", () => {
    expect(breakAllowanceLeft({ allowanceMinutes: 60, breaks: [brk("10:00", "10:10", 30)], nowMs: ms("11:00") })).toBe(50);
  });

  it("counts an open break up to now and never goes below zero", () => {
    expect(breakAllowanceLeft({ allowanceMinutes: 30, breaks: [brk("10:00", null, 30)], nowMs: ms("11:00") })).toBe(0);
  });
});

describe("stopLimit", () => {
  const shifts = shiftsOn([clientA, clientB], PHX, DATE) as Shift[];
  const input = (over: Partial<StopLimitInput> = {}): StopLimitInput => ({
    nowMs: ms("09:00"),
    hasSchedule: true,
    shifts,
    clientId: "A",
    workedMsByClient: new Map(),
    workedMsToday: 0,
    dailyCapMinutes: null,
    companyDefaultCapMinutes: 480,
    approvedWindows: [],
    ...over,
  });

  it("stops at the end of the client's shift", () => {
    expect(stopLimit(input())).toEqual({ limitMs: ms("13:00"), reason: "shift_end", overrunMs: 0 });
  });

  it("stops when the client's allotted minutes are used up, if that comes first", () => {
    const worked = new Map([["A", 200 * MIN]]);
    const r = stopLimit(input({ nowMs: ms("11:00"), workedMsByClient: worked, workedMsToday: 200 * MIN }));
    expect(r).toEqual({ limitMs: ms("11:40"), reason: "client_allotment", overrunMs: 0 });
  });

  it("uses the other client's shift and allotment after a switch", () => {
    const r = stopLimit(input({ nowMs: ms("14:00"), clientId: "B", workedMsByClient: new Map([["B", 0]]) }));
    expect(r).toEqual({ limitMs: ms("17:20"), reason: "client_allotment", overrunMs: 0 });
  });

  it("with no schedule, stops at the person's own daily cap", () => {
    const r = stopLimit(input({ hasSchedule: false, shifts: [], clientId: null, nowMs: ms("09:00") + 100 * MIN, workedMsToday: 100 * MIN, dailyCapMinutes: 240 }));
    expect(r).toEqual({ limitMs: ms("09:00") + 100 * MIN + 140 * MIN, reason: "daily_cap", overrunMs: 0 });
  });

  it("with no schedule and no personal cap, uses the company default", () => {
    const r = stopLimit(input({ hasSchedule: false, shifts: [], clientId: null, nowMs: ms("09:00"), workedMsToday: 0 }));
    expect(r).toEqual({ limitMs: ms("09:00") + 8 * HOUR, reason: "daily_cap", overrunMs: 0 });
  });

  it("a personal cap beats the company default", () => {
    const r = stopLimit(input({ hasSchedule: false, shifts: [], clientId: null, nowMs: ms("09:00"), dailyCapMinutes: 300 }));
    expect(r.limitMs).toBe(ms("09:00") + 5 * HOUR);
  });

  it("an approved extra-hours window that starts at the limit moves the limit to its end", () => {
    const r = stopLimit(input({ approvedWindows: [{ startMs: ms("13:00"), endMs: ms("15:00") }] }));
    expect(r).toEqual({ limitMs: ms("15:00"), reason: "approved_extra_end", overrunMs: 0 });
  });

  it("an approved window that does not touch the limit changes nothing", () => {
    const r = stopLimit(input({ approvedWindows: [{ startMs: ms("19:00"), endMs: ms("20:00") }] }));
    expect(r.limitMs).toBe(ms("13:00"));
  });

  it("a shift that crosses midnight stops at its own end the next morning", () => {
    const night: ScheduleLite = { ...clientA, startTime: "22:00", endTime: "06:00", allottedMinutesPerDay: null };
    const nightShifts = shiftsOn([night], PHX, DATE);
    const r = stopLimit(input({ shifts: nightShifts, nowMs: ms("22:00") }));
    expect(r.limitMs).toBe(ms("06:00", "2030-03-05"));
  });

  it("on a rest day of someone with a schedule the limit is already now unless extra hours were approved", () => {
    expect(stopLimit(input({ shifts: [], nowMs: ms("10:00") })).limitMs).toBe(ms("10:00"));
    const lifted = stopLimit(input({ shifts: [], nowMs: ms("10:00"), approvedWindows: [{ startMs: ms("09:30"), endMs: ms("12:00") }] }));
    expect(lifted).toEqual({ limitMs: ms("12:00"), reason: "approved_extra_end", overrunMs: 0 });
  });

  it("after the shift has ended the limit is now, so the person is stopped, not left running", () => {
    const r = stopLimit(input({ nowMs: ms("13:30") }));
    expect(r.limitMs).toBe(ms("13:30"));
  });
});

describe("dailyBreakAllowance", () => {
  it("adds up the break time of today's shifts", () => {
    const shifts = shiftsOn([{ ...clientA, breakMinutes: 15 }, { ...clientB, breakMinutes: 30 }], PHX, DATE);
    expect(dailyBreakAllowance({ shifts, defaultBreakMinutes: 60 })).toBe(45);
  });

  it("falls back to the company default when the shifts have no break time or there is no shift", () => {
    expect(dailyBreakAllowance({ shifts: shiftsOn([clientA], PHX, DATE), defaultBreakMinutes: 60 })).toBe(60);
    expect(dailyBreakAllowance({ shifts: [], defaultBreakMinutes: 45 })).toBe(45);
  });
});

describe("shiftOn with several schedules", () => {
  it("merges a day's shifts into one: first start, last end, scheduled minutes added up", async () => {
    const { shiftOn } = await import("./schedule");
    const s = shiftOn([{ ...clientA, breakMinutes: 15 }, { ...clientB, breakMinutes: 30 }], PHX, DATE)!;
    expect(s.startMs).toBe(ms("09:00"));
    expect(s.endMs).toBe(ms("18:00"));
    expect(s.scheduledMinutes).toBe(225 + 210);
    expect(s.schedule.breakMinutes).toBe(45);
  });

  it("is the single shift itself when there is one", async () => {
    const { shiftOn } = await import("./schedule");
    expect(shiftOn([clientA], PHX, DATE)!.scheduledMinutes).toBe(240);
  });

  it("knows when two schedules' hours overlap", async () => {
    const { hoursOverlap } = await import("./schedule");
    expect(hoursOverlap(clientA, clientB)).toBe(false);
    expect(hoursOverlap(clientA, { ...clientB, startTime: "12:00" })).toBe(true);
    expect(hoursOverlap(clientA, { ...clientB, startTime: "12:00", weekdays: [6, 7] })).toBe(false);
    expect(hoursOverlap({ ...clientA, startTime: "22:00", endTime: "06:00" }, { ...clientB, startTime: "05:00", endTime: "07:00" })).toBe(true);
  });
});

describe("stopLimit overrun (how long past the limit the person already is)", () => {
  const shifts = shiftsOn([clientA], PHX, DATE) as Shift[];
  const base = { hasSchedule: true, shifts, clientId: "A" as string | null, workedMsByClient: new Map<string | null, number>(), workedMsToday: 0, dailyCapMinutes: null, companyDefaultCapMinutes: 480, approvedWindows: [] };

  it("is the time past the cap when the cap was already used up", () => {
    const r = stopLimit({ ...base, hasSchedule: false, shifts: [], clientId: null, nowMs: ms("12:00"), workedMsToday: 300 * MIN, dailyCapMinutes: 240 });
    expect(r).toMatchObject({ limitMs: ms("12:00"), reason: "daily_cap", overrunMs: 60 * MIN });
  });

  it("is the time past the client's allotment", () => {
    const r = stopLimit({ ...base, nowMs: ms("12:00"), workedMsByClient: new Map([["A", 250 * MIN]]), workedMsToday: 250 * MIN });
    expect(r).toMatchObject({ reason: "client_allotment", overrunMs: 10 * MIN });
  });

  it("is the time since the shift ended", () => {
    const r = stopLimit({ ...base, nowMs: ms("13:45") });
    expect(r).toMatchObject({ limitMs: ms("13:45"), reason: "shift_end", overrunMs: 45 * MIN });
  });

  it("is unlimited on a rest day, so the stop is stamped at the session's own start", () => {
    expect(stopLimit({ ...base, shifts: [], nowMs: ms("10:00") }).overrunMs).toBe(Infinity);
  });
});

describe("stopLimit with a window that already ended", () => {
  it("stops at the end of an approved window that covered the moment the cap was reached", () => {
    const r = stopLimit({
      nowMs: ms("12:00"),
      hasSchedule: false,
      shifts: [],
      clientId: null,
      workedMsByClient: new Map(),
      workedMsToday: 6 * HOUR,
      dailyCapMinutes: 240,
      companyDefaultCapMinutes: 480,
      approvedWindows: [{ startMs: ms("08:00"), endMs: ms("11:10") }],
    });
    // 6 hours worked by 12:00 means the 4 hour cap was reached at 10:00, inside the window that ends at 11:10
    expect(r).toEqual({ limitMs: ms("12:00"), reason: "approved_extra_end", overrunMs: 50 * MIN });
  });
});

describe("stopLimit with a window that opens after the limit", () => {
  it("keeps a person working while a window is open now, even though it began after the cap was reached", () => {
    const r = stopLimit({
      nowMs: ms("12:00"),
      hasSchedule: false,
      shifts: [],
      clientId: null,
      workedMsByClient: new Map(),
      workedMsToday: 6 * HOUR,
      dailyCapMinutes: 240,
      companyDefaultCapMinutes: 480,
      approvedWindows: [{ startMs: ms("11:30"), endMs: ms("13:00") }],
    });
    expect(r).toEqual({ limitMs: ms("13:00"), reason: "approved_extra_end", overrunMs: 0 });
  });
});

describe("stopLimit stamps the end of a window that was worked (final review)", () => {
  const none = { hasSchedule: true, shifts: [] as Shift[], clientId: null as string | null, workedMsByClient: new Map<string | null, number>(), workedMsToday: 0, dailyCapMinutes: null, companyDefaultCapMinutes: 480 };

  it("on a rest day, a window that has just ended is where the time stops, not the start of the session", () => {
    const r = stopLimit({ ...none, nowMs: ms("13:00") + 30 * MIN, approvedWindows: [{ startMs: ms("09:00"), endMs: ms("13:00") }] });
    expect(r).toMatchObject({ limitMs: ms("13:30"), overrunMs: 30 * MIN });
  });

  it("a window after the shift (with a gap before it) stops at the window's end", () => {
    const r = stopLimit({ ...none, shifts: shiftsOn([clientA], PHX, DATE) as Shift[], clientId: "A", nowMs: ms("14:20"), approvedWindows: [{ startMs: ms("13:30"), endMs: ms("14:00") }] });
    expect(r).toMatchObject({ limitMs: ms("14:20"), overrunMs: 20 * MIN });
  });

  it("with no schedule and the cap already used, a window worked afterwards stops at its end", () => {
    const r = stopLimit({ ...none, hasSchedule: false, nowMs: ms("20:30"), workedMsToday: 10 * HOUR, dailyCapMinutes: 480, approvedWindows: [{ startMs: ms("18:00"), endMs: ms("20:00") }] });
    expect(r).toMatchObject({ limitMs: ms("20:30"), overrunMs: 30 * MIN });
  });

  it("a window that ended before the limit was reached changes nothing", () => {
    const r = stopLimit({ ...none, hasSchedule: false, nowMs: ms("12:00"), workedMsToday: 6 * HOUR, dailyCapMinutes: 240, approvedWindows: [{ startMs: ms("05:00"), endMs: ms("06:00") }] });
    expect(r.overrunMs).toBe(120 * MIN);
  });
});

describe("shiftsForWork: a shift that began the day before (final review)", () => {
  const MANILA = "Asia/Manila";
  const phoenix: ScheduleLite = { effectiveFrom: "2030-01-01", effectiveTo: null, startTime: "08:00", endTime: "17:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: 0, zone: PHX };
  const manilaMs = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, MANILA).getTime();

  it("includes last night's shift when someone works after midnight in their own zone", async () => {
    const { shiftsForWork } = await import("./schedule");
    // Phoenix 08:00-17:00 Monday is Manila Monday 23:00 to Tuesday 08:00 (2030-03-04 is a Monday).
    const w = shiftsForWork([phoenix], MANILA, manilaMs("2030-03-05", "04:00"));
    expect(w.day).toBe("2030-03-05");
    expect(w.shifts.map((s) => s.startMs)).toContain(manilaMs("2030-03-04", "23:00"));
    expect(w.startMs).toBe(manilaMs("2030-03-04", "23:00"));
  });

  it("on Friday night, a Saturday arrival is still inside Friday's shift, not on a rest day", async () => {
    const { shiftsForWork } = await import("./schedule");
    const w = shiftsForWork([phoenix], MANILA, manilaMs("2030-03-09", "04:00")); // Saturday 04:00 Manila
    expect(w.shifts).toHaveLength(1);
    expect(w.shifts[0].startMs).toBe(manilaMs("2030-03-08", "23:00"));
  });

  it("is just the day's own shifts, starting at midnight, when no earlier shift is still running", async () => {
    const { shiftsForWork } = await import("./schedule");
    const w = shiftsForWork([phoenix], MANILA, manilaMs("2030-03-05", "12:00"));
    expect(w.shifts.map((s) => s.startMs)).toEqual([manilaMs("2030-03-05", "23:00")]);
    expect(w.startMs).toBe(manilaMs("2030-03-05", "00:00"));
  });
});

describe("hoursOverlap across zones (final review)", () => {
  it("sees two schedules in different zones that cover the same real hours", async () => {
    const { hoursOverlap } = await import("./schedule");
    const a: ScheduleLite = { ...clientA, startTime: "08:00", endTime: "12:00", zone: PHX };
    // Manila 23:00 to 03:00 is Phoenix 08:00 to 12:00 the same real time.
    const b: ScheduleLite = { ...clientB, startTime: "23:00", endTime: "03:00", zone: "Asia/Manila" };
    expect(hoursOverlap(a, b)).toBe(true);
    expect(hoursOverlap(a, { ...b, startTime: "04:00", endTime: "08:00" })).toBe(false);
  });
});
