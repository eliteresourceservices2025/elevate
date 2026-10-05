import { formatInZone } from "@/lib/time";
import type { CorrectionItem } from "@/modules/attendance/queries";
import type { ExtraItem } from "@/modules/attendance/extra-hours-queries";
import type { RequestItem } from "@/modules/timeoff/request-queries";

export type QueueKind = "time_off" | "correction" | "extra_hours";

/** One request waiting for the signed-in person. */
export type QueueItem = {
  key: string;
  kind: QueueKind;
  id: string;
  who: string;
  /** What is being asked, in one short line. */
  what: string;
  createdAt: string;
  /** Where the full request is, with its evidence and notes. */
  href: string;
  /** Approve can be done right here. False when there is evidence or detail the reviewer should look at first. */
  inlineApprove: boolean;
};

export const KIND_LABEL: Record<QueueKind, string> = { time_off: "Time off", correction: "Time correction", extra_hours: "Extra hours" };

const day = (ymd: string) => formatInZone(new Date(`${ymd}T12:00:00Z`), "UTC", "MMM d");

export function timeOffItem(r: RequestItem): QueueItem {
  const range = r.startDate === r.endDate ? day(r.startDate) : `${day(r.startDate)} to ${day(r.endDate)}`;
  return {
    key: `time_off:${r.id}`,
    kind: "time_off",
    id: r.id,
    who: r.employeeName,
    what: `${r.leaveTypeName}, ${range} (${r.days} ${r.days === 1 ? "day" : "days"})`,
    createdAt: r.createdAt,
    href: "/time-off?tab=approvals",
    // A day off carries no evidence: the reviewer sees everything in the line above.
    inlineApprove: true,
  };
}

const CORRECTION_KIND: Record<string, string> = { forgot: "forgot to clock", connection_problem: "connection problem", device_problem: "device problem", other: "other reason" };

export function correctionItem(c: CorrectionItem): QueueItem {
  return {
    key: `correction:${c.id}`,
    kind: "correction",
    id: c.id,
    who: c.employeeName,
    what: `Fix the clock: ${CORRECTION_KIND[c.kind] ?? "other reason"}`,
    createdAt: c.createdAt,
    href: "/attendance?tab=corrections",
    // A claim with screenshots, or one HR alone decides, is read on its page first.
    inlineApprove: c.evidence.length === 0 && !c.hrOnly,
  };
}

export function extraHoursItem(x: ExtraItem): QueueItem {
  const hours = Math.round((x.minutes / 60) * 10) / 10;
  return {
    key: `extra_hours:${x.id}`,
    kind: "extra_hours",
    id: x.id,
    who: x.employeeName,
    what: `${hours} ${hours === 1 ? "hour" : "hours"} for ${x.clientName}`,
    createdAt: x.createdAt,
    href: "/extra-hours",
    inlineApprove: x.evidence.length === 0,
  };
}

/** Oldest first, so the longest wait is on top. */
export const byWaiting = (a: QueueItem, b: QueueItem) => a.createdAt.localeCompare(b.createdAt);
