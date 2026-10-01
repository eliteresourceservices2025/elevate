import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, backoffMs, describeFailure, isMismatch, isRetryable, mirrorSteps, parseBreakMode, parseDuration } from "./mirror-rules";
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

  it("reads the break mode and defaults to clock", () => {
    expect(parseBreakMode(undefined)).toBe("clock");
    expect(parseBreakMode("native")).toBe("native");
    expect(parseBreakMode("off")).toBe("off");
    expect(parseBreakMode("anything else")).toBe("clock");
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
