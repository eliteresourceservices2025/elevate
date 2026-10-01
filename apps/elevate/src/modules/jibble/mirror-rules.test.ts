import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, backoffMs, describeFailure, isMismatch, isRetryable, mirrorSteps, parseBreakMode, parseDuration, pickBreak, repairAction, targetState } from "./mirror-rules";
import { configFromEnv } from "./http-client";

const ev = (id: string, type: "clock_in" | "break_start" | "break_end" | "clock_out") => ({ id, type });

describe("which calls go to Jibble", () => {
  it("sends clock-in and clock-out as In and Out", () => {
    expect(mirrorSteps([ev("a", "clock_in")], "clock")).toEqual([{ eventId: "a", action: "In" }]);
    expect(mirrorSteps([ev("b", "clock_out")], "clock")).toEqual([{ eventId: "b", action: "Out" }]);
  });

  it("stops screenshots on a break by clocking out and back in (clock mode)", () => {
    expect(mirrorSteps([ev("s", "break_start")], "clock")).toEqual([{ eventId: "s", action: "Out" }]);
    expect(mirrorSteps([ev("e", "break_end")], "clock")).toEqual([{ eventId: "e", action: "In" }]);
  });

  it("uses Jibble's own break entries in native mode and ignores breaks when off", () => {
    expect(mirrorSteps([ev("s", "break_start")], "native")).toEqual([{ eventId: "s", action: "StartBreak" }]);
    expect(mirrorSteps([ev("e", "break_end")], "native")).toEqual([{ eventId: "e", action: "EndBreak" }]);
    expect(mirrorSteps([ev("s", "break_start"), ev("e", "break_end")], "off")).toEqual([]);
    expect(mirrorSteps([ev("a", "clock_in"), ev("o", "clock_out")], "off").map((s) => s.action)).toEqual(["In", "Out"]);
  });

  it("sends only the Out when a clock-out ends a break too, in clock mode (already out since the break began)", () => {
    expect(mirrorSteps([ev("e", "break_end"), ev("o", "clock_out")], "clock")).toEqual([{ eventId: "o", action: "Out" }]);
    expect(mirrorSteps([ev("e", "break_end"), ev("o", "clock_out")], "native").map((s) => s.action)).toEqual(["EndBreak", "Out"]);
  });

  it("reads the break mode and defaults to Jibble's own breaks", () => {
    expect(parseBreakMode(undefined)).toBe("native");
    expect(parseBreakMode("native")).toBe("native");
    expect(parseBreakMode("clock")).toBe("clock");
    expect(parseBreakMode("off")).toBe("off");
    expect(parseBreakMode("anything else")).toBe("native");
  });
});

describe("matching an ELEVATE break to a Jibble break type", () => {
  const b = (name: string, durationMinutes: number | null) => ({ id: name, name, durationMinutes });
  const all = [b("15 minutes", 15), b("30 minutes", 30), b("1 hour", 60), b("Open", null)];

  it("takes the break of exactly the chosen length, and the flexible one for no limit", () => {
    expect(pickBreak(all, 15)?.name).toBe("15 minutes");
    expect(pickBreak(all, 30)?.name).toBe("30 minutes");
    expect(pickBreak(all, 60)?.name).toBe("1 hour");
    expect(pickBreak(all, null)?.name).toBe("Open");
  });

  it("falls back to a flexible break, then the shortest fixed break that is long enough, then the longest", () => {
    expect(pickBreak([b("20 minutes", 20), b("Flexible", null)], 15)?.name).toBe("Flexible"); // fits any length
    expect(pickBreak([b("20 minutes", 20), b("1 hour", 60)], 15)?.name).toBe("20 minutes");
    expect(pickBreak([b("15 minutes", 15), b("Flexible", null)], 60)?.name).toBe("Flexible");
    expect(pickBreak([b("15 minutes", 15), b("30 minutes", 30)], 60)?.name).toBe("30 minutes");
    expect(pickBreak([b("15 minutes", 15), b("30 minutes", 30)], null)?.name).toBe("30 minutes"); // no flexible one: the longest
  });

  it("prefers an unpaid break, since ELEVATE's breaks are deducted", () => {
    const paid = { id: "p", name: "Paid 15", durationMinutes: 15, paid: true };
    const unpaid = { id: "u", name: "Unpaid hour", durationMinutes: 60, paid: false };
    expect(pickBreak([paid, unpaid], 15)?.name).toBe("Unpaid hour");
    expect(pickBreak([paid], 15)?.name).toBe("Paid 15"); // only a paid one exists: better than nothing
  });

  it("works with the breaks of the Elite organization: a 1 hour break and a flexible one", () => {
    const hour = { id: "h", name: "1 Hour Break", durationMinutes: 60, paid: false };
    const staggered = { id: "s", name: "1 Hour Break (Staggered)", durationMinutes: null, paid: false };
    expect(pickBreak([hour, staggered], 15)?.name).toBe("1 Hour Break (Staggered)");
    expect(pickBreak([hour, staggered], 30)?.name).toBe("1 Hour Break (Staggered)");
    expect(pickBreak([hour, staggered], 60)?.name).toBe("1 Hour Break");
    expect(pickBreak([hour, staggered], null)?.name).toBe("1 Hour Break (Staggered)");
  });

  it("returns nothing when Jibble has no break types", () => {
    expect(pickBreak([], 15)).toBeNull();
    expect(pickBreak([], null)).toBeNull();
  });
});

describe("retries", () => {
  it("backs off for about an hour in six tries", () => {
    expect(MAX_ATTEMPTS).toBe(6);
    const total = [1, 2, 3, 4, 5, 6].reduce((sum, n) => sum + backoffMs(n), 0);
    expect(total).toBeGreaterThanOrEqual(60 * 60_000);
    expect(total).toBeLessThanOrEqual(75 * 60_000);
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(99)).toBe(30 * 60_000);
  });

  it("retries network trouble, rate limits and server errors, but not a refusal", () => {
    for (const status of [null, 408, 429, 500, 503]) expect(isRetryable(status)).toBe(true);
    for (const status of [400, 401, 403, 404, 422]) expect(isRetryable(status)).toBe(false);
  });

  it("stores only a short code and status, never a body", () => {
    expect(describeFailure(401, "token rejected")).toBe("http 401: token rejected");
    expect(describeFailure(null, "timeout")).toBe("network: timeout");
    expect(describeFailure(500, "Bearer abc.def <script> ana@example.com")).not.toMatch(/[<>@]/);
    expect(describeFailure(500, "x".repeat(500)).length).toBeLessThan(100);
  });
});

describe("Jibble durations and the nightly comparison", () => {
  it("reads ISO 8601 and clock-style durations as minutes", () => {
    expect(parseDuration("PT7H30M")).toBe(450);
    expect(parseDuration("PT45M")).toBe(45);
    expect(parseDuration("P1DT2H")).toBe(1560);
    expect(parseDuration("PT1H30M30S")).toBe(90.5);
    expect(parseDuration("07:30:00")).toBe(450);
    expect(parseDuration("1.02:00:00")).toBe(1560);
    expect(parseDuration("08:15")).toBe(495);
    expect(parseDuration("PT0S")).toBe(0);
  });

  it("returns null for things that are not durations", () => {
    for (const bad of [null, undefined, "", "P", "PT", "soon", "7 hours", "1:2:3:4", "PT5X"]) expect(parseDuration(bad)).toBeNull();
  });

  it("flags only totals that differ by more than the tolerance", () => {
    expect(isMismatch(480, 470, 15)).toBe(false);
    expect(isMismatch(480, 465, 15)).toBe(false); // exactly 15 is fine
    expect(isMismatch(480, 464, 15)).toBe(true);
    expect(isMismatch(0, 120, 15)).toBe(true); // worked in Jibble, never clocked in ELEVATE
    expect(isMismatch(120, 0, 15)).toBe(true);
  });
});

describe("configuration", () => {
  it("is not configured without a token, and accepts a personal access token or a client id and secret", () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ JIBBLE_CLIENT_ID: "id" })).toBeNull();
    expect(configFromEnv({ JIBBLE_ACCESS_TOKEN: "  " })).toBeNull();
    expect(configFromEnv({ JIBBLE_ACCESS_TOKEN: "t" })?.accessToken).toBe("t");
    expect(configFromEnv({ JIBBLE_CLIENT_ID: "id", JIBBLE_CLIENT_SECRET: "s" })).toMatchObject({ clientId: "id", clientSecret: "s" });
  });

  it("uses Jibble's production hosts unless told otherwise, without trailing slashes", () => {
    const c = configFromEnv({ JIBBLE_ACCESS_TOKEN: "t", JIBBLE_WORKSPACE_URL: "https://example.test/" });
    expect(c?.workspaceUrl).toBe("https://example.test");
    expect(c?.timeTrackingUrl).toBe("https://time-tracking.prod.jibble.io");
    expect(c?.timeAttendanceUrl).toBe("https://time-attendance.prod.jibble.io");
  });
});

describe("putting Jibble back in step with ELEVATE", () => {
  it("knows where each call leaves a person", () => {
    expect(targetState("In")).toBe("in");
    expect(targetState("EndBreak")).toBe("in");
    expect(targetState("Out")).toBe("out");
    expect(targetState("StartBreak")).toBe("break");
  });

  it("does nothing when they already agree", () => {
    expect(repairAction("working", "in", "native")).toBeNull();
    expect(repairAction("out", "out", "native")).toBeNull();
    expect(repairAction("break", "break", "native")).toBeNull();
    expect(repairAction("break", "out", "clock")).toBeNull(); // clock mode: a break is "out"
    expect(repairAction("break", "in", "off")).toBeNull(); // breaks are not mirrored
  });

  it("clocks Jibble in when ELEVATE says working, and out when ELEVATE says clocked out", () => {
    expect(repairAction("working", "out", "native")).toBe("In");
    expect(repairAction("working", "break", "native")).toBe("EndBreak");
    expect(repairAction("out", "in", "native")).toBe("Out");
    expect(repairAction("out", "break", "clock")).toBe("Out");
  });

  it("follows the break mode when ELEVATE says on a break", () => {
    expect(repairAction("break", "in", "native")).toBe("StartBreak");
    expect(repairAction("break", "out", "native")).toBe("In"); // clock in first; the next run starts the break
    expect(repairAction("break", "in", "clock")).toBe("Out");
    expect(repairAction("break", "out", "off")).toBe("In");
    expect(repairAction("break", "break", "off")).toBe("EndBreak");
  });
});
