import { describe, expect, it } from "vitest";
import { breakLabel, buildDays, formatClock, formatDuration, ipAllowed, isValidRange, replayClock, roundCoordinate, transition, validCoordinates, workedMs, type ClockEventLite, type ClockType } from "./clock";

const T = (iso: string) => Date.parse(iso);
const ev = (type: ClockType, iso: string): ClockEventLite => ({ type, at: T(iso) });

describe("state machine", () => {
  it("allows only legal moves", () => {
    expect(transition("out", "clock_in")).toBe("working");
    expect(transition("out", "clock_out")).toBeNull();
    expect(transition("out", "break_start")).toBeNull();
    expect(transition("working", "clock_in")).toBeNull(); // no overlapping sessions
    expect(transition("working", "break_start")).toBe("break");
    expect(transition("working", "clock_out")).toBe("out");
    expect(transition("break", "break_end")).toBe("working");
    expect(transition("break", "clock_out")).toBeNull(); // the break must end first
    expect(transition("break", "break_start")).toBeNull();
  });
});

describe("replay", () => {
  it("builds sessions, breaks and the final state", () => {
    const r = replayClock([ev("clock_in", "2026-10-05T09:00:00Z"), ev("break_start", "2026-10-05T12:00:00Z"), ev("break_end", "2026-10-05T12:30:00Z"), ev("clock_out", "2026-10-05T17:00:00Z")]);
    expect(r.state).toBe("out");
    expect(r.invalid).toEqual([]);
    expect(r.sessions).toHaveLength(1);
    expect(workedMs(r.sessions[0], 0) / 60_000).toBe(7.5 * 60); // 8h minus a 30 minute break
  });

  it("orders by time, skips impossible events and reports them", () => {
    const r = replayClock([ev("clock_out", "2026-10-05T17:00:00Z"), ev("clock_in", "2026-10-05T09:00:00Z"), ev("clock_in", "2026-10-05T10:00:00Z")]);
    expect(r.sessions).toHaveLength(1);
    expect(r.invalid).toHaveLength(1);
    expect(r.state).toBe("out");
  });

  it("leaves an open session open and counts it up to a given time", () => {
    const r = replayClock([ev("clock_in", "2026-10-05T09:00:00Z"), ev("break_start", "2026-10-05T11:00:00Z")]);
    expect(r.state).toBe("break");
    expect(r.sessions[0].endAt).toBeNull();
    expect(workedMs(r.sessions[0], T("2026-10-05T13:00:00Z")) / 60_000).toBe(120); // the open break is not work
  });
});

describe("days", () => {
  it("assigns a night shift to the day it started, in the person's zone", () => {
    // Manila (UTC+8): 22:00 on Oct 5 to 06:00 on Oct 6 is one shift that belongs to Oct 5
    const days = buildDays([ev("clock_in", "2026-10-05T14:00:00Z"), ev("clock_out", "2026-10-05T22:00:00Z")], "Asia/Manila");
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2026-10-05", sessions: 1, workedMinutes: 480, open: false });
  });

  it("uses the person's own zone for the day boundary", () => {
    const events = [ev("clock_in", "2026-10-06T03:00:00Z"), ev("clock_out", "2026-10-06T07:00:00Z")];
    expect(buildDays(events, "America/Phoenix")[0].date).toBe("2026-10-05"); // 8 PM the evening before
    expect(buildDays(events, "Asia/Manila")[0].date).toBe("2026-10-06"); // 11 AM
  });

  it("adds up several sessions and breaks on one day, and flags an open one without counting it", () => {
    const days = buildDays(
      [
        ev("clock_in", "2026-10-05T09:00:00Z"), ev("break_start", "2026-10-05T10:00:00Z"), ev("break_end", "2026-10-05T10:15:00Z"), ev("clock_out", "2026-10-05T12:00:00Z"),
        ev("clock_in", "2026-10-05T13:00:00Z"),
      ],
      "UTC",
    );
    expect(days[0]).toMatchObject({ sessions: 2, workedMinutes: 165, breakMinutes: 15, open: true });
    expect(days[0].lastOut).toBe(T("2026-10-05T12:00:00Z"));
  });
});

describe("network ranges", () => {
  it("validates ranges", () => {
    expect(["1.2.3.4", "10.0.0.0/8", "192.168.1.0/24", "1.2.3.4/32"].every(isValidRange)).toBe(true);
    expect(["", "1.2.3", "1.2.3.256", "1.2.3.4/33", "1.2.3.4/x", "a.b.c.d", "1.2.3.4/8/9"].some(isValidRange)).toBe(false);
  });

  it("matches addresses against ranges", () => {
    expect(ipAllowed("203.0.113.9", [])).toBe(true); // no ranges: no restriction
    expect(ipAllowed("203.0.113.9", ["203.0.113.0/24"])).toBe(true);
    expect(ipAllowed("203.0.114.9", ["203.0.113.0/24"])).toBe(false);
    expect(ipAllowed("198.51.100.7", ["203.0.113.0/24", "198.51.100.7"])).toBe(true);
    expect(ipAllowed("::ffff:203.0.113.9", ["203.0.113.0/24"])).toBe(true);
    expect(ipAllowed("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipAllowed("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
    expect(ipAllowed("1.2.3.4", ["0.0.0.0/0"])).toBe(true);
  });

  it("treats an unknown or IPv6 address as outside when there are ranges", () => {
    expect(ipAllowed(null, ["203.0.113.0/24"])).toBe(false);
    expect(ipAllowed("unknown", ["203.0.113.0/24"])).toBe(false);
    expect(ipAllowed("2001:db8::1", ["203.0.113.0/24"])).toBe(false);
  });
});

describe("location and formatting", () => {
  it("rounds to about a kilometre", () => {
    expect(roundCoordinate(14.599512)).toBe(14.6);
    expect(roundCoordinate(120.984222)).toBe(120.98);
    expect(roundCoordinate(-33.8688)).toBe(-33.87);
  });
  it("validates coordinates", () => {
    expect(validCoordinates(14.6, 120.98)).toBe(true);
    expect(validCoordinates(91, 0)).toBe(false);
    expect(validCoordinates(0, 181)).toBe(false);
    expect(validCoordinates(NaN, 0)).toBe(false);
  });
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
    expect(formatDuration(8 * 3_600_000 + 5 * 60_000)).toBe("8h 05m");
  });
});

describe("a session that is still open", () => {
  const events = [ev("clock_in", "2026-10-05T09:00:00Z"), ev("break_start", "2026-10-05T11:00:00Z"), ev("break_end", "2026-10-05T11:30:00Z")];

  it("is left out of the totals by default (the nightly rebuild)", () => {
    const [day] = buildDays(events, "UTC");
    expect(day).toMatchObject({ open: true, workedMinutes: 0, breakMinutes: 0 });
  });

  it("counts up to now when asked (the person's own live view), minus breaks", () => {
    const [day] = buildDays(events, "UTC", T("2026-10-05T13:00:00Z"));
    expect(day).toMatchObject({ open: true, workedMinutes: 210, breakMinutes: 30 }); // 4h minus a 30 minute break
  });

  it("counts an open break up to now as break time, not work", () => {
    const [day] = buildDays([ev("clock_in", "2026-10-05T09:00:00Z"), ev("break_start", "2026-10-05T10:00:00Z")], "UTC", T("2026-10-05T10:20:00Z"));
    expect(day).toMatchObject({ workedMinutes: 60, breakMinutes: 20 });
  });
});

describe("formatClock", () => {
  it("shows seconds so a running clock visibly moves", () => {
    expect(formatClock(0)).toBe("0:00:00");
    expect(formatClock(42_000)).toBe("0:00:42");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("0:00:00");
  });
});

describe("sessions stay separate", () => {
  it("lists every clock-in to clock-out on a day instead of merging them away", () => {
    const [day] = buildDays(
      [
        ev("clock_in", "2026-10-05T09:00:00Z"), ev("break_start", "2026-10-05T10:00:00Z"), ev("break_end", "2026-10-05T10:15:00Z"), ev("clock_out", "2026-10-05T12:00:00Z"),
        ev("clock_in", "2026-10-05T13:00:00Z"), ev("clock_out", "2026-10-05T15:00:00Z"),
      ],
      "UTC",
    );
    expect(day.sessions).toBe(2);
    expect(day.sessionList).toHaveLength(2);
    expect(day.sessionList.map((s) => [s.workedMinutes, s.breakMinutes])).toEqual([[165, 15], [120, 0]]);
    expect(day.sessionList[0].breaks).toEqual([{ startAt: T("2026-10-05T10:00:00Z"), endAt: T("2026-10-05T10:15:00Z"), minutes: 15, plannedMinutes: null, overMinutes: 0 }]);
    expect(day.workedMinutes).toBe(285);
  });
});

describe("timed breaks and overbreaks", () => {
  const timed = (planned: number | null, endIso: string | null): ClockEventLite[] => [
    ev("clock_in", "2026-10-05T09:00:00Z"),
    { ...ev("break_start", "2026-10-05T10:00:00Z"), plannedBreakMinutes: planned },
    ...(endIso ? [ev("break_end", endIso), ev("clock_out", "2026-10-05T12:00:00Z")] : []),
  ];

  it("is not an overbreak when the break ends on time or within the one-minute grace", () => {
    expect(buildDays(timed(15, "2026-10-05T10:15:00Z"), "UTC")[0].overbreakMinutes).toBe(0);
    expect(buildDays(timed(15, "2026-10-05T10:16:00Z"), "UTC")[0].overbreakMinutes).toBe(0); // exactly the grace
  });

  it("counts the whole excess once it is past the grace", () => {
    const [day] = buildDays(timed(30, "2026-10-05T10:45:00Z"), "UTC");
    expect(day.overbreakMinutes).toBe(15);
    expect(day.sessionList[0].breaks[0]).toMatchObject({ minutes: 45, plannedMinutes: 30, overMinutes: 15 });
    expect(day.workedMinutes).toBe(135); // the 3 hour session minus a 45 minute break
  });

  it("never counts an open-ended break as an overbreak", () => {
    expect(buildDays(timed(null, "2026-10-05T11:30:00Z"), "UTC")[0].overbreakMinutes).toBe(0);
  });

  it("counts a break that is still running against the time it has so far", () => {
    const [day] = buildDays(timed(15, null), "UTC", T("2026-10-05T10:25:00Z"));
    expect(day.overbreakMinutes).toBe(10);
    expect(day.open).toBe(true);
  });

  it("names the choices", () => {
    expect(breakLabel(15)).toBe("15 minutes");
    expect(breakLabel(60)).toBe("1 hour");
    expect(breakLabel(null)).toBe("No time limit");
  });
});

describe("an overbreak on a session that is still open", () => {
  it("counts a break that has already ended, but not one still running (unless it is the live view)", () => {
    const events: ClockEventLite[] = [
      ev("clock_in", "2026-10-05T09:00:00Z"),
      { ...ev("break_start", "2026-10-05T10:00:00Z"), plannedBreakMinutes: 15 },
      ev("break_end", "2026-10-05T10:45:00Z"),
    ];
    const [nightly] = buildDays(events, "UTC"); // the nightly rebuild: the session is unfinished
    expect(nightly).toMatchObject({ open: true, workedMinutes: 0, overbreakMinutes: 30 });
    const running = buildDays([...events.slice(0, 2)], "UTC")[0];
    expect(running.overbreakMinutes).toBe(0); // a break still running is not settled
  });
});
