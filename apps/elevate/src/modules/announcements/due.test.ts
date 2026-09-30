import { describe, expect, it } from "vitest";
import { daysUntil, describeDue, dueState, reminderDue } from "./due";

describe("due dates", () => {
  it("counts days across month ends", () => {
    expect(daysUntil("2026-11-02", "2026-10-30")).toBe(3);
    expect(daysUntil("2026-10-30", "2026-10-30")).toBe(0);
    expect(daysUntil("2026-10-28", "2026-10-30")).toBe(-2);
  });

  it("classifies the state", () => {
    expect(dueState(null, "2026-10-01")).toBe("none");
    expect(dueState("2026-10-20", "2026-10-01")).toBe("upcoming");
    expect(dueState("2026-10-04", "2026-10-01")).toBe("soon");
    expect(dueState("2026-10-01", "2026-10-01")).toBe("today");
    expect(dueState("2026-09-30", "2026-10-01")).toBe("overdue");
  });

  it("reminds 3 days before, on the day, and weekly while overdue", () => {
    const due = "2026-10-10";
    const days = ["2026-10-06", "2026-10-07", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-16", "2026-10-17", "2026-10-24"];
    expect(days.filter((d) => reminderDue(due, d))).toEqual(["2026-10-07", "2026-10-10", "2026-10-17", "2026-10-24"]);
  });

  it("describes the state in plain words", () => {
    expect(describeDue(null, "2026-10-01")).toBe("No due date");
    expect(describeDue("2026-10-02", "2026-10-01")).toBe("Due tomorrow");
    expect(describeDue("2026-10-05", "2026-10-01")).toBe("Due in 4 days");
    expect(describeDue("2026-10-01", "2026-10-01")).toBe("Due today");
    expect(describeDue("2026-09-30", "2026-10-01")).toBe("1 day overdue");
    expect(describeDue("2026-09-20", "2026-10-01")).toBe("11 days overdue");
  });
});
