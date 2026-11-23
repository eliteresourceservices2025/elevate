import { scopeFor, type ActionName, type AuthzUser } from "@/lib/authz";
import type { Scope } from "@/lib/roles";

/**
 * Notices are saved per person, so a notice sent while someone held a role would stay after the role is taken away. Each rule below
 * needs the permission that goes with that notice TODAY; without it the notice is hidden (and comes back if the role does).
 *
 * Only kinds sent to the people who DECIDE or HANDLE something are listed. A kind that can also go to the person a request is about
 * (for example "extrahours.reminder") must never be listed, or a contractor would lose notices meant for them.
 * `kind` is one exact kind; `prefix` is a whole family ("recruiting."). `scopes` defaults to any scope.
 */
export type KindRule = ({ kind: string; prefix?: never } | { prefix: string; kind?: never }) & { action: ActionName; scopes?: Scope[] };

const DECIDER: Scope[] = ["all", "team"];

export const KIND_RULES: KindRule[] = [
  { prefix: "recruiting.", action: "recruiting.view" },
  { kind: "timeoff.approval_needed", action: "timeoff.approve", scopes: DECIDER },
  { kind: "timeoff.escalated", action: "timeoff.approve", scopes: DECIDER },
  { kind: "attendance.correction_needed", action: "attendance.approve_correction", scopes: DECIDER },
  { kind: "extrahours.requested", action: "extra_hours.decide", scopes: DECIDER },
  { kind: "extrahours.weekly", action: "extra_hours.decide", scopes: DECIDER },
  { kind: "hours.approval_reminder", action: "hours.approve", scopes: DECIDER },
  { kind: "hours.approval_summary", action: "hours.approve", scopes: DECIDER },
  { kind: "attendance.missed_clockout_lead", action: "attendance.view", scopes: DECIDER },
  { kind: "attendance.quiet_lead", action: "attendance.view", scopes: DECIDER },
  { kind: "review.ready_to_calibrate", action: "reviews.calibrate" },
  { kind: "learn.overdue_team", action: "learn.view_status", scopes: DECIDER },
];

/** The rules this person no longer meets: their notices are hidden. */
export function hiddenKindRules(user: AuthzUser): KindRule[] {
  return KIND_RULES.filter((rule) => {
    const scope = scopeFor(user, rule.action);
    return scope === null || (rule.scopes !== undefined && !rule.scopes.includes(scope));
  });
}

/** Kept for callers that only need the families. */
export function hiddenKindPrefixes(user: AuthzUser): string[] {
  return hiddenKindRules(user).flatMap((r) => (r.prefix ? [r.prefix] : []));
}
