import { describe, expect, it } from "vitest";
import { clockStatusChanged } from "./clock-status-change";

const base = { state: "working", sessionStartMs: 1000, breakStartMs: null, currentClientId: "c1", currentProjectId: null, needsSelfie: false } as const;

describe("did the clock change on another device?", () => {
  it("is false for the same state", () => {
    expect(clockStatusChanged(base, { ...base })).toBe(false);
  });
  it("sees a clock-in, a break, a clock-out and a switch of client or project", () => {
    expect(clockStatusChanged({ ...base, state: "out", sessionStartMs: null, currentClientId: null }, base)).toBe(true);
    expect(clockStatusChanged(base, { ...base, state: "break", breakStartMs: 2000 })).toBe(true);
    expect(clockStatusChanged(base, { ...base, state: "out", sessionStartMs: null, currentClientId: null })).toBe(true);
    expect(clockStatusChanged(base, { ...base, currentClientId: "c2" })).toBe(true);
    expect(clockStatusChanged(base, { ...base, currentProjectId: "p1" })).toBe(true);
  });
  it("sees a new session (clocked out and in again between two checks)", () => {
    expect(clockStatusChanged(base, { ...base, sessionStartMs: 9000 })).toBe(true);
  });
  it("treats a missing status (no person record) as unchanged", () => {
    expect(clockStatusChanged(null, null)).toBe(false);
    expect(clockStatusChanged(null, base)).toBe(true);
  });
});
