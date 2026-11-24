// A message thread on a report or request (owner request 2026-11-25). No server-only imports: the screens use these too.
export const REPORT_TYPES = ["tech_issue", "correction", "support", "extra_hours", "makeup", "time_off"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const MESSAGE_MAX = 1000;

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  tech_issue: "technical issue",
  correction: "time correction",
  support: "support request",
  extra_hours: "extra hours request",
  makeup: "make-up hours request",
  time_off: "time off request",
};

/** Where the report lives, for a notification link: the person's own view, or the handler's queue. */
export function reportLink(type: ReportType, id: string, forHandler: boolean): string {
  switch (type) {
    case "tech_issue":
      return `/attendance?tab=issues${forHandler ? "" : "&view=mine"}&id=${id}`;
    case "correction":
      return forHandler ? `/attendance?tab=corrections&id=${id}` : `/attendance?id=${id}`;
    case "support":
      return forHandler ? `/support?id=${id}` : `/support?tab=mine&id=${id}`;
    case "extra_hours":
      return "/extra-hours";
    case "makeup":
      return "/make-up-hours";
    case "time_off":
      return "/time-off?tab=requests";
  }
}
