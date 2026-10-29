import { describe, expect, it } from "vitest";
import { decideMismatch } from "./mismatch-policy";

describe("Jibble mismatch policy", () => {
  it("notifies the person and lead when ELEVATE is working and Jibble is out", () => {
    expect(decideMismatch({ elevate: "working", jibble: "out", breakMode: "native", outCause: "unknown" })).toBe("notify_person_and_lead");
  });
  it("creates a correction only for a confirmed Jibble-only start and stops Jibble only for a confirmed ELEVATE clock-out", () => {
    const base = { elevate: "out", jibble: "in", breakMode: "native" } as const;
    expect(decideMismatch({ ...base, outCause: "confirmed_jibble_clock_in" })).toBe("draft_correction");
    expect(decideMismatch({ ...base, outCause: "confirmed_elevate_clock_out" })).toBe("stop_jibble");
    expect(decideMismatch({ ...base, outCause: "unknown" })).toBe("review");
  });
  it("does not infer a mismatch from an unknown Jibble state", () => {
    expect(decideMismatch({ elevate: "out", jibble: null, breakMode: "native", outCause: "confirmed_elevate_clock_out" })).toBe("unknown");
  });
  it("respects configured break modes and sends ambiguous break mismatches for review", () => {
    expect(decideMismatch({ elevate: "break", jibble: "in", breakMode: "off", outCause: "unknown" })).toBe("aligned");
    expect(decideMismatch({ elevate: "break", jibble: "out", breakMode: "clock", outCause: "unknown" })).toBe("aligned");
    expect(decideMismatch({ elevate: "break", jibble: "break", breakMode: "native", outCause: "unknown" })).toBe("aligned");
    expect(decideMismatch({ elevate: "break", jibble: "in", breakMode: "native", outCause: "unknown" })).toBe("review");
  });
});
