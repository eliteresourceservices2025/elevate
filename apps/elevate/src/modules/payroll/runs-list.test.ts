import { describe, expect, it } from "vitest";
import { cutoffNote, daysBetween, nextCutoff, nextStepOf, parseView, periodSubtitle, runActions, runWhy, shortRange, stepOf, type RunFacts, type ViewerRights } from "./runs-list";

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
    expect([parseView("action"), parseView("test"), parseView("archived"), parseView("all"), parseView("nope"), parseView(undefined)]).toEqual(["action", "test", "archived", "all", "all", "all"]);
  });
});

describe("shortRange", () => {
  it("writes a period in short form", () => {
    expect(shortRange("2026-11-16", "2026-11-30")).toBe("Nov 16 to 30");
    expect(shortRange("2026-10-28", "2026-11-03")).toBe("Oct 28 to Nov 3");
  });
});

describe("runActions and runWhy", () => {
  const f = (over: Partial<Parameters<typeof runActions>[0]>) => ({ status: "draft" as const, isTest: false, archived: false, blockedByInvoice: false, ...over });

  it("lets a test run or a cancelled run be archived, and an archived one be restored or deleted", () => {
    expect(runActions(f({ isTest: true })).actions).toEqual(["archive"]);
    expect(runActions(f({ status: "cancelled" })).actions).toEqual(["archive"]);
    expect(runActions(f({ isTest: true, archived: true, status: "paid" })).actions).toEqual(["restore", "delete"]);
    expect(runActions(f({ status: "cancelled", archived: true })).actions).toEqual(["restore", "delete"]);
  });

  it("never offers anything on a real run that is not cancelled", () => {
    for (const status of ["draft", "in_review", "approved", "paid"] as const) {
      const r = runActions(f({ status }));
      expect(r.actions).toEqual([]);
      expect(r.whyNot).toMatch(/real run is never archived or deleted/);
    }
  });

  it("holds back the delete while an invoice on the run is real or not archived, and says so", () => {
    const r = runActions(f({ isTest: true, archived: true, blockedByInvoice: true }));
    expect(r.actions).toEqual(["restore"]);
    expect(r.whyNot).toMatch(/invoice/);
    expect(runWhy(f({ isTest: true, archived: true, blockedByInvoice: true })).delete).toMatch(/invoice/);
  });

  it("names a reason for every action that does not fit", () => {
    expect(runWhy(f({ isTest: true }))).toMatchObject({ delete: expect.stringMatching(/Archive this run first/), restore: "It is not archived." });
    expect(runWhy(f({ isTest: true, archived: true }))).toEqual({ archive: "It is already archived." });
  });
});
