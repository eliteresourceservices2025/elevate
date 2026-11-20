import { describe, expect, it } from "vitest";
import { suggestFromDays, type SuggestDay } from "./suggest";

const day = (over: Partial<SuggestDay> = {}): SuggestDay => ({
  date: "2026-03-02",
  state: "approved",
  scheduledMinutes: 480,
  workedMinutes: 480,
  approvedExtraMinutes: 0,
  flags: [],
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  holiday: false,
  ...over,
});

describe("suggestFromDays", () => {
  it("counts only approved days; the rest add to unapprovedDays", () => {
    const r = suggestFromDays([
      day({ flags: ["absent"] }),
      day({ date: "2026-03-03", state: "none", flags: ["absent"], lateMinutes: 30 }),
      day({ date: "2026-03-04", state: "changed", approvedExtraMinutes: 60 }),
    ]);
    expect(r.absenceDayHundredths).toBe(100);
    expect(r.lateMinutes).toBe(0);
    expect(r.extra).toEqual({ regular: 0, holiday: 0, restDay: 0, restDayOver8: 0 });
    expect(r.unapprovedDays).toBe(2);
  });

  it("adds 100 hundredths for an absent day and nothing for a day on leave", () => {
    expect(suggestFromDays([day({ flags: ["absent"] }), day({ date: "2026-03-03", flags: ["absent"] })]).absenceDayHundredths).toBe(200);
    expect(suggestFromDays([day({ flags: ["on_leave"] })]).absenceDayHundredths).toBe(0);
    expect(suggestFromDays([day({ flags: ["absent", "on_leave"] })]).absenceDayHundredths).toBe(0);
  });

  it("adds late and early-leave minutes together", () => {
    expect(suggestFromDays([day({ lateMinutes: 10, earlyLeaveMinutes: 5 }), day({ date: "2026-03-03", lateMinutes: 20 })]).lateMinutes).toBe(35);
  });

  it("counts approved extra minutes only, never unapproved extra", () => {
    const r = suggestFromDays([day({ workedMinutes: 600, approvedExtraMinutes: 45 }), day({ date: "2026-03-03", workedMinutes: 600, approvedExtraMinutes: 0 })]);
    expect(r.extra.regular).toBe(45);
  });

  it("sends a holiday to holiday, an unscheduled day to the rest-day rates split at 480, and the rest to regular", () => {
    const r = suggestFromDays([
      day({ date: "2026-03-02", holiday: true, approvedExtraMinutes: 300 }),
      day({ date: "2026-03-07", scheduledMinutes: null, workedMinutes: 600, approvedExtraMinutes: 600 }),
      day({ date: "2026-03-08", scheduledMinutes: null, workedMinutes: 200, approvedExtraMinutes: 200 }),
      day({ date: "2026-03-03", approvedExtraMinutes: 30 }),
    ]);
    expect(r.extra).toEqual({ regular: 30, holiday: 300, restDay: 680, restDayOver8: 120 });
  });

  it("a holiday wins over a rest day, and a rest day with no approved extra adds nothing", () => {
    const r = suggestFromDays([
      day({ date: "2026-03-02", holiday: true, scheduledMinutes: null, workedMinutes: 400, approvedExtraMinutes: 400 }),
      day({ date: "2026-03-07", scheduledMinutes: null, workedMinutes: 500, approvedExtraMinutes: 0 }),
    ]);
    expect(r.extra).toEqual({ regular: 0, holiday: 400, restDay: 0, restDayOver8: 0 });
  });

  it("returns zeros for no days", () => {
    expect(suggestFromDays([])).toEqual({ absenceDayHundredths: 0, lateMinutes: 0, extra: { regular: 0, holiday: 0, restDay: 0, restDayOver8: 0 }, unapprovedDays: 0 });
  });
});
