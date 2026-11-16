import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The dialogs call useRouter; outside a running app there is no router, so give them a stand-in.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
// The server actions are only imported here, never called.
vi.mock("../hours-actions", () => ({ markTestDay: vi.fn(), reopenApprovedHours: vi.fn() }));

const { DayList, WeekSignal } = await import("./hours-day-detail");
import type { ReviewDay, ReviewRow } from "../hours-queries";

const day = (over: Partial<ReviewDay>): ReviewDay => ({
  date: "2026-11-11",
  weekday: "Wed",
  scheduledMinutes: null,
  hasSchedule: false,
  clients: [],
  workedMinutes: 480,
  breakMinutes: 30,
  extraMinutes: 0,
  approvedExtraMinutes: 0,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  flags: [],
  firstIn: Date.UTC(2026, 10, 11, 16, 0),
  lastOut: Date.UTC(2026, 10, 12, 0, 30),
  state: "none",
  canReopen: false,
  finished: true,
  ...over,
});

const row = (days: ReviewDay[]): ReviewRow => ({
  employeeId: "00000000-0000-4000-8000-000000000001",
  name: "Test Person",
  team: null,
  zone: "America/Phoenix",
  days,
  scheduledMinutes: 0,
  workedMinutes: 0,
  extraMinutes: 0,
  approvedExtraMinutes: 0,
  lateDays: 0,
  absentDays: 0,
  flags: [...new Set(days.flatMap((d) => d.flags))],
  state: "none",
  canApprove: true,
  canReopen: false,
});

const label = (f: string) => f;
const html = (r: ReviewRow, over: { canMarkTest?: boolean; previewMode?: boolean } = {}) =>
  renderToStaticMarkup(createElement(DayList, { row: r, canMarkTest: over.canMarkTest ?? false, previewMode: over.previewMode ?? false, label }));

describe("the daily detail of hours review", () => {
  it("shows one status per day, not a chip for every flag", () => {
    const out = html(row([day({ flags: ["long_session", "no_screenshots", "jibble_mismatch", "late"] })]));
    expect(out).toContain("Fix needed");
    expect(out).not.toContain(">no_screenshots<");
    expect(out).not.toContain(">jibble_mismatch<");
  });

  it("says Check with a count for flags that need a look, and OK for a clean day", () => {
    expect(html(row([day({ flags: ["late", "overbreak"] })]))).toContain("Check · 2");
    expect(html(row([day({ flags: ["late"] })]))).toContain(">Check<");
    const clean = html(row([day({ flags: [] })]));
    expect(clean).toContain(">OK<");
    expect(clean).not.toContain("Fix needed");
  });

  it("reads a day with no schedule as No schedule, and a rest day as Rest day", () => {
    expect(html(row([day({ hasSchedule: false })]))).toContain("No schedule");
    expect(html(row([day({ hasSchedule: true })]))).toContain("Rest day");
    expect(html(row([day({ scheduledMinutes: 480, hasSchedule: true })]))).toContain("Scheduled 8h 00m");
  });

  it("says whether extra time is approved", () => {
    expect(html(row([day({ extraMinutes: 120, approvedExtraMinutes: 120 })]))).toContain("approved");
    expect(html(row([day({ extraMinutes: 120, approvedExtraMinutes: 0 })]))).toContain("not approved");
    expect(html(row([day({ extraMinutes: 120, approvedExtraMinutes: 60 })]))).toContain("1h 00m approved");
  });

  it("shows the approval state next to the status, and says Changed after approval once", () => {
    expect(html(row([day({ state: "approved" })]))).toContain("Approved");
    expect(html(row([day({ state: "none", finished: false })]))).toContain("Day not over");
    const changed = html(row([day({ state: "changed" })]));
    expect(changed.match(/Changed after approval/g)).toHaveLength(1);
  });

  it("offers the actions menu only to people who have an action, and not in the sample preview", () => {
    expect(html(row([day({})]))).not.toContain("Actions for");
    expect(html(row([day({})]), { canMarkTest: true })).toContain("Actions for");
    expect(html(row([day({ flags: ["long_session"] })]))).toContain("Actions for"); // Fix clock-out
    expect(html(row([day({ canReopen: true })]))).toContain("Actions for");
    expect(html(row([day({ canReopen: true })]), { previewMode: true })).not.toContain("Actions for");
  });
});

describe("the week's review status", () => {
  const signal = (r: ReviewRow) => renderToStaticMarkup(createElement(WeekSignal, { row: r }));

  it("counts the days to fix, then the days to check, otherwise Ready", () => {
    expect(signal(row([day({ flags: ["long_session"] }), day({ date: "2026-11-12", flags: ["late"] })]))).toContain("1 day to fix");
    expect(signal(row([day({ flags: ["late"] }), day({ date: "2026-11-12", flags: ["overbreak"] })]))).toContain("2 days to check");
    expect(signal(row([day({ flags: ["corrected"] })]))).toContain("Ready");
  });
});
