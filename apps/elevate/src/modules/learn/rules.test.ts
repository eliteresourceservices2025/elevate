import { describe, expect, it } from "vitest";
import { addDays, addonNeed, assignmentNeed, changedModuleKeys, changedScopes, daysBetween, describeDue, isOverdue, isoWeekKey, reminderDue, trackFor, updateQuestionCount } from "./rules";

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
  it("assigns the complete HIPAA course to everyone", () => {
    expect(trackFor(true)).toBe("full");
    expect(trackFor(false)).toBe("full");
  });
});

describe("who needs an assignment", () => {
  it("does nothing when one is already open or the certificate is current", () => {
    expect(assignmentNeed({ ...base, openAssignment: true })).toEqual({ assign: false });
    expect(assignmentNeed({ ...base, latestCertificateEndsOn: "2027-06-01" })).toEqual({ assign: false });
    expect(assignmentNeed({ ...base, latestCertificateEndsOn: addDays(TODAY, 61) })).toEqual({ assign: false });
  });

  it("gives a new hire 30 days from their start on the Full track", () => {
    expect(assignmentNeed({ ...base, startDate: "2026-10-05", assignedToPhiClient: true })).toEqual({ assign: true, reason: "new_hire", track: "full", dueOn: "2026-11-04" });
    expect(assignmentNeed({ ...base, startDate: "2026-10-05" })).toEqual({ assign: true, reason: "new_hire", track: "full", dueOn: "2026-11-04" });
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

describe("addonNeed", () => {
  const base = { today: "2026-10-12", joinedOn: "2026-10-09", openAssignment: false, latestCertificateEndsOn: null };
  it("is due 30 days after joining the client, on the full track", () => {
    expect(addonNeed(base)).toEqual({ assign: true, reason: "new_hire", track: "full", dueOn: "2026-11-08" });
  });
  it("gives people who joined long ago 30 days from today", () => {
    expect(addonNeed({ ...base, joinedOn: "2025-01-01" })).toMatchObject({ assign: true, reason: "manual", track: "full", dueOn: "2026-11-11" });
  });
  it("renews on the full track (never refresher) and waits while open or current", () => {
    expect(addonNeed({ ...base, latestCertificateEndsOn: "2026-11-01" })).toMatchObject({ assign: true, reason: "renewal", track: "full", dueOn: "2026-11-01" });
    expect(addonNeed({ ...base, latestCertificateEndsOn: "2027-06-01" })).toEqual({ assign: false });
    expect(addonNeed({ ...base, openAssignment: true })).toEqual({ assign: false });
  });
});

describe("update modules", () => {
  const mod = (key: string, text = "same") => ({ key, title: key, screens: [{ blocks: [{ type: "paragraph", text }] }] });

  it("lists only the modules in the track whose content changed, or that are new", () => {
    const before = [mod("a"), mod("b"), mod("c")];
    const after = [mod("a"), mod("b", "reworded"), mod("c"), mod("d")];
    expect(changedModuleKeys(before, after, new Set(["a", "b", "c", "d"]))).toEqual(["b", "d"]);
    // a module outside the person's track is never part of their update
    expect(changedModuleKeys(before, after, new Set(["a", "c", "d"]))).toEqual(["d"]);
    expect(changedModuleKeys(before, before, new Set(["a", "b", "c"]))).toEqual([]);
  });

  it("asks five questions at most and none when the changed modules have none", () => {
    expect(updateQuestionCount(40)).toBe(5);
    expect(updateQuestionCount(3)).toBe(3);
    expect(updateQuestionCount(0)).toBe(0);
  });
});

describe("changedScopes (an update teaches only the new or changed screens)", () => {
  const screen = (id: string, text = "same") => ({ id, text });
  const mod = (key: string, screens: { id: string; text: string }[], extra = {}) => ({ key, screens, ...extra });
  const track = new Set(["a", "b", "c"]);

  it("names the screens that are new or changed, by their place in the new module, and nothing else", () => {
    const before = [mod("a", [screen("s1"), screen("s2"), screen("s3")]), mod("b", [screen("s1")])];
    const after = [mod("a", [screen("s1"), screen("s2", "reworded"), screen("s3"), screen("s4")]), mod("b", [screen("s1")]), mod("c", [screen("n1"), screen("n2")])];
    expect(changedScopes(before, after, track)).toEqual([
      { key: "a", screens: [1, 3] },
      { key: "c", screens: [0, 1] },
    ]);
  });

  it("leaves a module out when only its title, summary or key points changed, and respects the track", () => {
    const before = [mod("a", [screen("s1")], { summary: "old" })];
    const after = [mod("a", [screen("s1")], { summary: "new" }), mod("z", [screen("x")])];
    expect(changedScopes(before, after, track)).toEqual([]);
    expect(changedScopes(before, [mod("a", [screen("s1", "changed")])], new Set(["b"]))).toEqual([]);
  });

  it("treats a moved screen with the same id and content as unchanged", () => {
    const before = [mod("a", [screen("s1"), screen("s2")])];
    const after = [mod("a", [screen("s2"), screen("s1"), screen("s9")])];
    expect(changedScopes(before, after, track)).toEqual([{ key: "a", screens: [2] }]);
  });
});
