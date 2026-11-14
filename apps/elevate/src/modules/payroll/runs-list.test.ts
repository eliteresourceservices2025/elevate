import { describe, expect, it } from "vitest";
import { cutoffNote, daysBetween, nextCutoff, nextStepOf, parseView, periodSubtitle, shortRange, stepOf, type RunFacts, type ViewerRights } from "./runs-list";

const none: ViewerRights = { prepare: false, approve: false, markPaid: false, release: false };
const run = (over: Partial<RunFacts>): RunFacts => ({ status: "draft", isTest: false, peopleCount: 14, paidCount: 9, released: false, ...over });

describe("stepOf", () => {
  it("maps a status to its step, and a cancelled run to none", () => {
    expect(["draft", "in_review", "approved", "paid", "cancelled"].map((s) => stepOf(s as never))).toEqual([1, 2, 3, 4, 0]);
  });
});

describe("nextStepOf", () => {
  it("names what each level does next", () => {
    expect(nextStepOf(run({ status: "draft" }), { ...none, prepare: true })).toEqual({ label: "Continue", mine: true });
    expect(nextStepOf(run({ status: "draft" }), none)).toBeNull();
    expect(nextStepOf(run({ status: "in_review" }), { ...none, approve: true })).toEqual({ label: "Approve", mine: true });
    expect(nextStepOf(run({ status: "in_review" }), { ...none, prepare: true })).toEqual({ label: "Waiting for approval", mine: false });
    expect(nextStepOf(run({ status: "approved" }), { ...none, markPaid: true })).toEqual({ label: "Mark payments (9 of 14)", mine: true });
    expect(nextStepOf(run({ status: "approved" }), none)).toEqual({ label: "9 of 14 paid", mine: false });
  });

  it("handles a paid run: release, released, a test run and a cancelled run", () => {
    expect(nextStepOf(run({ status: "paid" }), { ...none, release: true })).toEqual({ label: "Release statements", mine: true });
    expect(nextStepOf(run({ status: "paid", released: true }), { ...none, release: true })).toEqual({ label: "Statements released", mine: false });
    expect(nextStepOf(run({ status: "paid" }), none)).toEqual({ label: "Statements not released yet", mine: false });
    expect(nextStepOf(run({ status: "paid", isTest: true }), { ...none, release: true })).toBeNull();
    expect(nextStepOf(run({ status: "cancelled" }), { prepare: true, approve: true, markPaid: true, release: true })).toBeNull();
  });
});

describe("periodSubtitle", () => {
  it("names the month and which cutoff, and calls anything else a custom period", () => {
    expect(periodSubtitle("2026-10-01", "2026-10-15")).toBe("October, first cutoff");
    expect(periodSubtitle("2026-10-16", "2026-10-31")).toBe("October, second cutoff");
    expect(periodSubtitle("2026-02-16", "2026-02-28")).toBe("February, second cutoff");
    expect(periodSubtitle("2026-10-03", "2026-10-20")).toBe("Custom period");
    expect(periodSubtitle("2026-10-16", "2026-10-30")).toBe("Custom period");
  });
});

describe("nextCutoff and cutoffNote", () => {
  const recent = [
    { start: "2026-11-16", end: "2026-11-30" },
    { start: "2026-11-01", end: "2026-11-15" },
    { start: "2026-10-16", end: "2026-10-31" },
  ];
  it("picks the oldest recent cutoff that has no real run", () => {
    expect(nextCutoff(recent, new Set(["2026-10-16"]), "2026-11-13")).toEqual({ start: "2026-11-01", end: "2026-11-15", daysLeft: 2 });
    expect(nextCutoff(recent, new Set(["2026-10-16", "2026-11-01"]), "2026-11-13")).toEqual({ start: "2026-11-16", end: "2026-11-30", daysLeft: 17 });
    expect(nextCutoff(recent, new Set(recent.map((p) => p.start)), "2026-11-13")).toBeNull();
  });
  it("words the days left", () => {
    expect([3, 1, 0, -1, -4].map(cutoffNote)).toEqual(["The cutoff ends in 3 days", "The cutoff ends tomorrow", "The cutoff ends today", "The cutoff ended 1 day ago", "The cutoff ended 4 days ago"]);
    expect(daysBetween("2026-11-13", "2026-11-15")).toBe(2);
  });
});

describe("parseView", () => {
  it("accepts only the known views", () => {
    expect([parseView("action"), parseView("test"), parseView("all"), parseView("nope"), parseView(undefined)]).toEqual(["action", "test", "all", "all", "all"]);
  });
});

describe("shortRange", () => {
  it("writes a period in short form", () => {
    expect(shortRange("2026-11-16", "2026-11-30")).toBe("Nov 16 to 30");
    expect(shortRange("2026-10-28", "2026-11-03")).toBe("Oct 28 to Nov 3");
  });
});
