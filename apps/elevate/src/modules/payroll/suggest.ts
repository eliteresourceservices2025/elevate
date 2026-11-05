import type { ExtraKey } from "./calculate";

// Suggested amounts from approved hours. Pure: the caller loads the days. Only days whose numbers are exactly what a lead approved
// count; everything else only adds to `unapprovedDays`. Suggestions never change pay until a Preparer confirms them.

export type SuggestDayState = "approved" | "changed" | "none";

export type SuggestDay = {
  date: string;
  state: SuggestDayState;
  scheduledMinutes: number | null;
  workedMinutes: number;
  approvedExtraMinutes: number;
  flags: string[];
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** A verified holiday on the person's calendar. */
  holiday: boolean;
};

export type Suggestion = {
  absenceDayHundredths: number;
  lateMinutes: number;
  extra: Record<Exclude<ExtraKey, "holidayPay">, number>;
  unapprovedDays: number;
};

/** Work on a rest day up to this many minutes is paid at the rest-day rate, the rest at the past-8-hours rate. */
export const REST_DAY_FIRST_MINUTES = 480;

export function suggestFromDays(days: SuggestDay[]): Suggestion {
  const out: Suggestion = { absenceDayHundredths: 0, lateMinutes: 0, extra: { regular: 0, holiday: 0, restDay: 0, restDayOver8: 0 }, unapprovedDays: 0 };
  for (const d of days) {
    if (d.state !== "approved") {
      out.unapprovedDays += 1;
      continue;
    }
    if (d.flags.includes("absent") && !d.flags.includes("on_leave")) out.absenceDayHundredths += 100;
    out.lateMinutes += d.lateMinutes + d.earlyLeaveMinutes;

    const extra = Math.max(0, d.approvedExtraMinutes);
    if (extra === 0) continue;
    if (d.holiday) out.extra.holiday += extra;
    // Policy (open owner question, do not change without an answer): the approved extra minutes of a rest day fill the lower
    // rest-day rate first, up to 480, and only what is beyond that goes to the past-8-hours rate. A partial approval of a long
    // rest day therefore never reaches the higher rate.
    else if (d.scheduledMinutes === null) {
      out.extra.restDay += Math.min(extra, REST_DAY_FIRST_MINUTES);
      out.extra.restDayOver8 += Math.max(0, extra - REST_DAY_FIRST_MINUTES);
    } else out.extra.regular += extra;
  }
  return out;
}
