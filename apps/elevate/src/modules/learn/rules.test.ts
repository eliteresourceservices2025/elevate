import { describe, expect, it } from "vitest";
import { addDays, assignmentNeed, daysBetween, describeDue, isOverdue, isoWeekKey, reminderDue, trackFor } from "./rules";

const TODAY = "2026-10-12";
const base = { today: TODAY, startDate: null as string | null, openAssignment: false, latestCertificateEndsOn: null as string | null, assignedToPhiClient: false };

describe("dates", () => {
  it("adds and measures days", () => {
    expect(addDays("2026-10-12", 30)).toBe("2026-11-11");
    expect(addDays("2026-12-20", 15)).toBe("2027-01-04");
    expect(daysBetween("2026-10-12", "2026-10-19")).toBe(7);
    expect(daysBetween("2026-10-19", "2026-10-12")).toBe(-7);
  });

  it("names the ISO week (a week starts on Monday)", () => {
    expect(isoWeekKey("2026-10-12")).toBe("2026-W42");
    expect(isoWeekKey("2026-10-18")).toBe("2026-W42");
    expect(isoWeekKey("2026-10-19")).toBe("2026-W43");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
  });
});

describe("tracks", () => {
  it("puts people on client work that handles patient information on Full, everyone else on Essentials", () => {
    expect(trackFor(true)).toBe("full");
    expect(trackFor(false)).toBe("essentials");
  });
});

describe("who needs an assignment", () => {
  it("does nothing when one is already open or the certificate is current", () => {
    expect(assignmentNeed({ ...base, openAssignment: true })).toEqual({ assign: false });
    expect(assignmentNeed({ ...base, latestCertificateEndsOn: "2027-06-01" })).toEqual({ assign: false });
    expect(assignmentNeed({ ...base, latestCertificateEndsOn: addDays(TODAY, 61) })).toEqual({ assign: false });
  });

  it("gives a new hire 30 days from their start, on the track their client work needs", () => {
    expect(assignmentNeed({ ...base, startDate: "2026-10-05", assignedToPhiClient: true })).toEqual({ assign: true, reason: "new_hire", track: "full", dueOn: "2026-11-04" });
    expect(assignmentNeed({ ...base, startDate: "2026-10-05" })).toEqual({ assign: true, reason: "new_hire", track: "essentials", dueOn: "2026-11-04" });
    // starts in the future
    expect(assignmentNeed({ ...base, startDate: "2026-10-20" })).toMatchObject({ reason: "new_hire", dueOn: "2026-11-19" });
  });

  it("gives people who started long ago 30 days from today (the rollout grace)", () => {
    expect(assignmentNeed({ ...base, startDate: "2024-03-01", assignedToPhiClient: true })).toEqual({ assign: true, reason: "manual", track: "full", dueOn: "2026-11-11" });
    expect(assignmentNeed({ ...base, startDate: null })).toMatchObject({ reason: "manual", dueOn: "2026-11-11" });
  });

  it("opens a renewal on the Refresher track 60 days before the certificate ends", () => {
    expect(assignmentNeed({ ...base, latestCertificateEndsOn: addDays(TODAY, 60) })).toEqual({ assign: true, reason: "renewal", track: "refresher", dueOn: addDays(TODAY, 60) });
    expect(assignmentNeed({ ...base, latestCertificateEndsOn: addDays(TODAY, 3) })).toMatchObject({ reason: "renewal", dueOn: addDays(TODAY, 3) });
  });

  it("gives an expired certificate's holder 30 days from today", () => {
    expect(assignmentNeed({ ...base, latestCertificateEndsOn: "2026-09-01" })).toEqual({ assign: true, reason: "renewal", track: "refresher", dueOn: "2026-11-11" });
  });
});

describe("reminders", () => {
  const none = new Set<string>();

  it("sends one notice at 30 days, 7 days and the due date, and nothing in between", () => {
    expect(reminderDue("2026-11-30", TODAY, none)).toBeNull(); // 49 days
    expect(reminderDue("2026-11-11", TODAY, none)).toBe("d30");
    expect(reminderDue("2026-10-30", TODAY, none)).toBe("d30");
    expect(reminderDue("2026-10-19", TODAY, none)).toBe("d7");
    expect(reminderDue("2026-10-12", TODAY, none)).toBe("d0");
    expect(reminderDue("2026-10-01", TODAY, none)).toBe("d0");
  });

  it("never repeats a threshold, and never goes back to a gentler one", () => {
    expect(reminderDue("2026-10-19", TODAY, new Set(["d7"]))).toBeNull();
    expect(reminderDue("2026-10-19", TODAY, new Set(["d30"]))).toBe("d7");
    expect(reminderDue("2026-10-30", TODAY, new Set(["d7"]))).toBeNull();
    expect(reminderDue("2026-10-12", TODAY, new Set(["d30", "d7"]))).toBe("d0");
    expect(reminderDue("2026-10-12", TODAY, new Set(["d0"]))).toBeNull();
  });

  it("describes how late something is", () => {
    expect(isOverdue("2026-10-11", TODAY)).toBe(true);
    expect(isOverdue("2026-10-12", TODAY)).toBe(false);
    expect(describeDue("2026-10-09", TODAY)).toBe("3 days overdue");
    expect(describeDue("2026-10-11", TODAY)).toBe("1 day overdue");
    expect(describeDue("2026-10-12", TODAY)).toBe("due today");
    expect(describeDue("2026-10-13", TODAY)).toBe("due in 1 day");
  });
});
