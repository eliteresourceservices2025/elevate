import type { Lens } from "./lens";

export type Severity = "urgent" | "warn" | "info";

/** One line in "Needs attention": what is wrong, in plain words, and where to fix it. Counts only: no names, no private details. */
export type AttentionItem = {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  href: string;
  /** Views this belongs in. */
  lenses: Lens[];
};

const ORDER: Record<Severity, number> = { urgent: 0, warn: 1, info: 2 };

/** Most urgent first; ties keep the order they were found in. Only items that belong in the view, at most `limit`. */
export function rankAttention(items: AttentionItem[], lens: Lens, limit = 8): AttentionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.lenses.includes(lens))
    .sort((a, b) => ORDER[a.item.severity] - ORDER[b.item.severity] || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A request counts as "waiting a long time" after this many whole days. */
export const STALE_DAYS = 2;

/** Whole days between an ISO instant and now. */
export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/** Severity for a pile of waiting requests: the oldest one decides. */
export function waitingSeverity(oldestDays: number, count: number): Severity {
  if (oldestDays >= 5 || count >= 10) return "urgent";
  if (oldestDays >= STALE_DAYS) return "warn";
  return "info";
}
