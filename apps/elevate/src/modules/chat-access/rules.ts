import { fromZonedTime } from "date-fns-tz";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { PENDING_LAPSES_DAYS } from "./constants";

// The pure rules of access requests (no server-only import), so they are tested without a database.

/** What a request is right now, worked out from its status and times. */
export type AccessState = "pending" | "lapsed" | "approved" | "expired" | "denied" | "cancelled";
export function accessStateOf(r: { status: string; requestedAt: Date; accessExpiresAt: Date | null }, now = new Date()): AccessState {
  if (r.status === "approved") return r.accessExpiresAt && r.accessExpiresAt.getTime() > now.getTime() ? "approved" : "expired";
  if (r.status === "pending") return now.getTime() - r.requestedAt.getTime() > PENDING_LAPSES_DAYS * 86_400_000 ? "lapsed" : "pending";
  return r.status as AccessState;
}

/** The moment a calendar day starts in the company's zone (Phoenix has no daylight saving, so it is a fixed offset). */
export const startOfDay = (ymd: string): Date => fromZonedTime(`${ymd} 00:00:00`, DEFAULT_TIMEZONE);
export const addDays = (ymd: string, n: number): string => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10);

