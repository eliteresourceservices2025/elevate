import { describe, expect, it } from "vitest";
import { addDays, addMonths, checkAnswers, dueMilestones, milestoneDate, stageOf, suggestedOverall, visibility, type Question, type ReviewState } from "./constants";
import { launchCycleSchema, reviewTemplateSchema, submitReviewSchema } from "./validators";

const none: ReviewState = { selfSubmittedAt: null, leadSubmittedAt: null, calibratedAt: null, sharedAt: null, acknowledgedAt: null };
const at = new Date("2026-01-01T00:00:00Z");

describe("stageOf", () => {
  it("moves forward as each step is done", () => {
    expect(stageOf(none)).toBe("awaiting_self");
    expect(stageOf({ ...none, selfSubmittedAt: at })).toBe("awaiting_lead");
    expect(stageOf({ ...none, selfSubmittedAt: at, leadSubmittedAt: at })).toBe("awaiting_hr");
    expect(stageOf({ ...none, selfSubmittedAt: at, leadSubmittedAt: at, calibratedAt: at })).toBe("ready_to_share");
    expect(stageOf({ ...none, selfSubmittedAt: at, leadSubmittedAt: at, calibratedAt: at, sharedAt: at })).toBe("shared");
    expect(stageOf({ ...none, selfSubmittedAt: at, leadSubmittedAt: at, calibratedAt: at, sharedAt: at, acknowledgedAt: at })).toBe("acknowledged");
  });
  it("lets the lead go ahead without a self review", () => {
    expect(stageOf({ ...none, leadSubmittedAt: at })).toBe("awaiting_hr");
  });
});

describe("months and milestones", () => {
  it("adds months and clamps to the end of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("computes the month 3 and month 5 dates", () => {
    expect(milestoneDate("2026-05-10", 3)).toBe("2026-08-10");
    expect(milestoneDate("2026-05-10", 5)).toBe("2026-10-10");
  });
  it("opens a milestone on its date, not before, and not for ancient history", () => {
    expect(dueMilestones("2026-05-10", "2026-08-09", [])).toEqual([]);
    expect(dueMilestones("2026-05-10", "2026-08-10", [])).toEqual([3]);
    expect(dueMilestones("2026-05-10", "2026-08-25", [])).toEqual([3]); // a job outage is made up
    expect(dueMilestones("2026-05-10", "2026-10-10", [3])).toEqual([5]);
    expect(dueMilestones("2025-01-10", "2026-10-10", [])).toEqual([]); // never back-filled
  });
  it("does not open one that was opened already", () => {
    expect(dueMilestones("2026-05-10", "2026-08-10", [3])).toEqual([]);
  });
  it("adds days", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
  });
});

describe("visibility", () => {
  const lead = { ...none, selfSubmittedAt: at, leadSubmittedAt: at, calibratedAt: at };
  it("shows HR everything", () => {
    expect(visibility("hr", none)).toEqual({ self: true, lead: true, calibration: true, originalLeadRating: true });
  });
  it("shows the person only their own self review until the review is shared", () => {
    expect(visibility("person", lead)).toMatchObject({ self: true, lead: false, calibration: false });
    expect(visibility("person", { ...lead, sharedAt: at })).toMatchObject({ self: true, lead: true, calibration: true, originalLeadRating: false });
  });
  it("hides the self review from the lead until their own is in", () => {
    expect(visibility("lead", { ...none, selfSubmittedAt: at }).self).toBe(false);
    expect(visibility("lead", lead).self).toBe(true);
  });
  it("hides the calibration from the lead until it is shared", () => {
    expect(visibility("lead", lead).calibration).toBe(false);
    expect(visibility("lead", { ...lead, sharedAt: at }).calibration).toBe(true);
  });
});

describe("answers", () => {
  const qs: Question[] = [
    { id: "11111111-1111-4111-8111-111111111111", section: "A", prompt: "Quality", type: "rating", required: true },
    { id: "22222222-2222-4222-8222-222222222222", section: "A", prompt: "Reliability", type: "rating", required: false },
    { id: "33333333-3333-4333-8333-333333333333", section: "B", prompt: "Anything else?", type: "text", required: true },
  ];
  const [q1, q2, q3] = qs.map((q) => q.id);
  it("requires the required questions", () => {
    expect(checkAnswers(qs, {})).toMatch(/Quality/);
    expect(checkAnswers(qs, { [q1]: { rating: 4 } })).toMatch(/Anything else/);
    expect(checkAnswers(qs, { [q1]: { rating: 4 }, [q3]: { text: "  " } })).toMatch(/Anything else/);
    expect(checkAnswers(qs, { [q1]: { rating: 4 }, [q3]: { text: "Fine" } })).toBeNull();
  });
  it("refuses out-of-range ratings and unknown questions", () => {
    expect(checkAnswers(qs, { [q1]: { rating: 6 }, [q3]: { text: "x" } })).toMatch(/1 to 5/);
    expect(checkAnswers(qs, { [q1]: { rating: 3 }, [q3]: { text: "x" }, "99999999-9999-4999-8999-999999999999": { rating: 3 } })).toMatch(/does not match/);
  });
  it("suggests the average rating, rounded", () => {
    expect(suggestedOverall(qs, { [q1]: { rating: 4 }, [q2]: { rating: 3 } })).toBe(4); // 3.5 rounds up
    expect(suggestedOverall(qs, { [q1]: { rating: 2 } })).toBe(2);
    expect(suggestedOverall(qs, {})).toBeNull();
  });
});

describe("validators", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("keeps cycle dates in order", () => {
    const base = { name: "Q3 2026", type: "quarterly", templateId: id, scope: { kind: "everyone" } };
    expect(launchCycleSchema.safeParse({ ...base, selfDueOn: "2026-10-10", leadDueOn: "2026-10-12", calibrateDueOn: "2026-10-15" }).success).toBe(true);
    expect(launchCycleSchema.safeParse({ ...base, selfDueOn: "2026-10-10", leadDueOn: "2026-10-05", calibrateDueOn: "2026-10-15" }).success).toBe(false);
    expect(launchCycleSchema.safeParse({ ...base, selfDueOn: "2026-10-10", leadDueOn: "2026-10-12", calibrateDueOn: "2026-10-11" }).success).toBe(false);
  });
  it("needs people or teams when the scope is narrowed", () => {
    const base = { name: "Q3 2026", type: "annual", templateId: id, selfDueOn: "2026-10-10", leadDueOn: "2026-10-12", calibrateDueOn: "2026-10-15" };
    expect(launchCycleSchema.safeParse({ ...base, scope: { kind: "teams", teamIds: [] } }).success).toBe(false);
    expect(launchCycleSchema.safeParse({ ...base, scope: { kind: "people", employeeIds: [id] } }).success).toBe(true);
  });
  it("needs a template to have questions", () => {
    expect(reviewTemplateSchema.safeParse({ name: "Tmpl", questions: [] }).success).toBe(false);
    expect(reviewTemplateSchema.safeParse({ name: "Tmpl", questions: [{ section: "A", prompt: "Quality?", type: "rating", required: true }] }).success).toBe(true);
  });
  it("only accepts ratings from 1 to 5", () => {
    expect(submitReviewSchema.safeParse({ reviewId: id, overallRating: 6 }).success).toBe(false);
    expect(submitReviewSchema.safeParse({ reviewId: id, overallRating: "" }).success).toBe(true);
  });
});
