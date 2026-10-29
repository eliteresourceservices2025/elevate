import "server-only";

import { can, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { listIssueQueue } from "@/modules/attendance/issue-queries";
import { getTeamReview } from "@/modules/attendance/hours-queries";
import { countOpenIncidents } from "@/modules/incidents/queries";
import { countOpenSupportRequests } from "@/modules/support/queries";
import { getApprovalQueue } from "./feed-queries";

/**
 * Small, permission-scoped counts for navigation. Counts represent work this
 * person can act on, never every record in the organisation. Safe Voice is
 * deliberately excluded: a live count could reveal sensitive report timing.
 */
export type NavWorkCounts = Partial<Record<"/approvals" | "/time-off" | "/attendance" | "/extra-hours" | "/hours-review" | "/incidents" | "/support", number>>;

export async function getNavWorkCounts(): Promise<NavWorkCounts> {
  const user = await requireUser();
  const canReviewHours = ["all", "team"].includes(String(scopeFor(user, "hours.approve")));
  const canHandleIssues = ["all", "team"].includes(String(scopeFor(user, "attendance.handle_issue")));

  const [approvals, hours, issues, support, incidents] = await Promise.all([
    getApprovalQueue(),
    canReviewHours ? getTeamReview().then((review) => review.pending) : Promise.resolve(0),
    canHandleIssues ? listIssueQueue().then((queue) => queue.items.filter((item) => item.canHandle).length) : Promise.resolve(0),
    can(user, "support.manage") ? countOpenSupportRequests() : Promise.resolve(0),
    can(user, "incidents.handle") ? countOpenIncidents() : Promise.resolve(0),
  ]);

  const count = (kind: "time_off" | "correction" | "extra_hours") => approvals.filter((item) => item.kind === kind).length;
  return {
    "/approvals": (approvals.length + hours) || undefined,
    "/time-off": count("time_off") || undefined,
    "/attendance": (count("correction") + issues) || undefined,
    "/extra-hours": count("extra_hours") || undefined,
    "/hours-review": hours || undefined,
    "/incidents": incidents || undefined,
    "/support": support || undefined,
  };
}
