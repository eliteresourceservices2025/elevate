import { describe, expect, it } from "vitest";
import { applySchema, interviewSchema, moveSchema, rejectSchema, scorecardSchema } from "./validators";
import { averageRating, canMove, isApplyable, retentionMonths } from "./constants";
import { buildInterviewIcs, interviewMail, receivedMail, rejectionMail } from "./mail";

const ID = "11111111-1111-4111-8111-111111111111";

describe("canMove", () => {
  it("lets open stages move around, including backwards", () => {
    expect(canMove("applied", "screening")).toEqual({ ok: true });
    expect(canMove("offer", "interview")).toEqual({ ok: true });
  });
  it("refuses a move to the same stage and any move out of hired", () => {
    expect(canMove("applied", "applied").ok).toBe(false);
    expect(canMove("hired", "offer").ok).toBe(false);
  });
  it("makes you reopen a rejected application before hiring it", () => {
    expect(canMove("rejected", "hired").ok).toBe(false);
    expect(canMove("rejected", "screening")).toEqual({ ok: true });
  });
});

describe("helpers", () => {
  it("only open, unarchived jobs take applications", () => {
    expect(isApplyable("open", false)).toBe(true);
    expect(isApplyable("draft", false)).toBe(false);
    expect(isApplyable("closed", false)).toBe(false);
    expect(isApplyable("open", true)).toBe(false);
  });
  it("averages ratings", () => {
    expect(averageRating({ communication: 5, skills: 4, reliability: 4, culture: 3 })).toBe(4);
    expect(averageRating({})).toBeNull();
  });
  it("picks the retention period by how the application ended", () => {
    const s = { rejectedMonths: 12, withdrawnMonths: 6 };
    expect(retentionMonths("rejected", s)).toBe(12);
    expect(retentionMonths("withdrawn", s)).toBe(6);
    expect(retentionMonths(null, s)).toBeNull();
  });
});

describe("applySchema", () => {
  const good = { openingId: ID, fullName: "Ana Reyes", email: "  ANA@Example.com ", consent: true, website: "" };
  it("accepts a normal application and normalizes the email", () => {
    const r = applySchema.safeParse(good);
    expect(r.success && r.data.email).toBe("ana@example.com");
  });
  it("requires consent, a valid email and an empty honeypot", () => {
    expect(applySchema.safeParse({ ...good, consent: false }).success).toBe(false);
    expect(applySchema.safeParse({ ...good, email: "nope" }).success).toBe(false);
    expect(applySchema.safeParse({ ...good, website: "http://spam" }).success).toBe(false);
  });
});

describe("other validators", () => {
  it("rejection needs a reason; moving cannot go to rejected", () => {
    expect(rejectSchema.safeParse({ applicationId: ID, reason: "" }).success).toBe(false);
    expect(rejectSchema.safeParse({ applicationId: ID, reason: "No fit" }).success).toBe(true);
    expect(moveSchema.safeParse({ applicationId: ID, to: "rejected" }).success).toBe(false);
  });
  it("an interview needs a future time, interviewers and a place", () => {
    const base = { applicationId: ID, minutes: 30, location: "Meet link", interviewerUserIds: [ID] };
    expect(interviewSchema.safeParse({ ...base, startsAt: new Date(Date.now() + 3_600_000).toISOString() }).success).toBe(true);
    expect(interviewSchema.safeParse({ ...base, startsAt: new Date(Date.now() - 86_400_000).toISOString() }).success).toBe(false);
    expect(interviewSchema.safeParse({ ...base, interviewerUserIds: [], startsAt: new Date(Date.now() + 3_600_000).toISOString() }).success).toBe(false);
  });
  it("a scorecard needs every rating from 1 to 5, a recommendation and a reason", () => {
    const base = { interviewId: ID, ratings: { communication: 4, skills: 3, reliability: 5, culture: 4 }, recommendation: "yes", comments: "Clear and calm." };
    expect(scorecardSchema.safeParse(base).success).toBe(true);
    expect(scorecardSchema.safeParse({ ...base, ratings: { ...base.ratings, skills: 6 } }).success).toBe(false);
    expect(scorecardSchema.safeParse({ ...base, ratings: { communication: 4 } }).success).toBe(false);
    expect(scorecardSchema.safeParse({ ...base, recommendation: "maybe" }).success).toBe(false);
  });
});

describe("emails and invites", () => {
  it("applicant emails say nothing about how they were assessed", () => {
    for (const m of [receivedMail({ fullName: "Ana Reyes", jobTitle: "VA" }), rejectionMail({ fullName: "Ana Reyes", jobTitle: "VA" })]) {
      expect(m.text).toContain("Hi Ana");
      expect(m.text).not.toMatch(/score|rating|reason|note/i);
    }
  });
  it("escapes html in titles", () => {
    expect(receivedMail({ fullName: "A", jobTitle: "<b>x</b>" }).html).not.toContain("<b>x</b>");
  });
  it("builds a UTC calendar invite and a matching cancellation", () => {
    const startsAt = new Date("2026-11-03T14:00:00Z");
    const ics = buildInterviewIcs({ uid: "abc", summary: "Interview: VA, senior", startsAt, minutes: 45, location: "https://meet.example.com/x" }, new Date("2026-10-01T00:00:00Z"));
    expect(ics).toContain("DTSTART:20261103T140000Z");
    expect(ics).toContain("DTEND:20261103T144500Z");
    expect(ics).toContain("SUMMARY:Interview: VA\\, senior");
    expect(ics).toContain("METHOD:REQUEST");
    const cancel = buildInterviewIcs({ uid: "abc", summary: "x", startsAt, minutes: 45, location: "y", method: "CANCEL" });
    expect(cancel).toContain("METHOD:CANCEL");
    expect(cancel).toContain("UID:abc@elevate");
    expect(cancel).toContain("STATUS:CANCELLED");
    expect(interviewMail({ fullName: "Ana", jobTitle: "VA", when: "Tue", location: "Meet" }).text).toContain("calendar invite is attached");
  });
});
