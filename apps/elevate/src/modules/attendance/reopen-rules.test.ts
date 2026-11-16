import { describe, expect, it } from "vitest";
import { LEAD_REOPEN_WINDOW_MS, mayReopenDay } from "./reopen-rules";

const now = Date.parse("2026-11-16T12:00:00Z");
const approval = (by: string, ageMs: number) => ({ approvedBy: by, approvedAt: new Date(now - ageMs) });

describe("who may reopen an approved day", () => {
  it("lets HR and Super Admin reopen any approval, however old", () => {
    expect(mayReopenDay("all", "hr", approval("someone-else", 30 * 86_400_000), now)).toBe(true);
  });

  it("lets a lead reopen only their own approval", () => {
    expect(mayReopenDay("team", "lead", approval("lead", 1000), now)).toBe(true);
    expect(mayReopenDay("team", "lead", approval("hr", 1000), now)).toBe(false);
  });

  it("lets a lead reopen only within a week of approving", () => {
    expect(mayReopenDay("team", "lead", approval("lead", LEAD_REOPEN_WINDOW_MS), now)).toBe(true);
    expect(mayReopenDay("team", "lead", approval("lead", LEAD_REOPEN_WINDOW_MS + 1), now)).toBe(false);
  });
});
