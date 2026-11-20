// Pure helpers for the manager tiles (no database, no "server-only", so tests can import them).

/** `worked` as a whole percent of `scheduled`: 0 when nothing is scheduled (never NaN or Infinity), capped at 100. */
export function percentOf(worked: number, scheduled: number): number {
  if (!(scheduled > 0) || !(worked > 0)) return 0;
  return Math.min(100, Math.round((worked / scheduled) * 100));
}

/** How many days carry each flag, skipping the `ignore` flags, most first then by label. A flag with no label is shown as it is. */
export function flagCounts(rows: readonly { flags: readonly string[] }[], labels: ReadonlyMap<string, string>, ignore: ReadonlySet<string>): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const f of r.flags) if (!ignore.has(f)) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()]
    .map(([flag, count]) => ({ label: labels.get(flag) ?? flag, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export type HrKpi = { id: string; label: string; value: number | null; hint?: string; href: string };
export type HrKpiInputs = { active: number | null; onboarding: number | null; offboarding: number | null; changeRequests: number | null; docsExpiring: number | null; trainingOverdue: number | null };

/** The six HR number tiles, always in this order. A source that was refused arrives as null and stays a tile (shown as a dash). */
export function shapeHrKpis(i: HrKpiInputs): HrKpi[] {
  return [
    { id: "active", label: "Active", value: i.active, hint: "people", href: "/people" },
    { id: "onboarding", label: "Onboarding", value: i.onboarding, hint: "in progress", href: "/onboarding" },
    { id: "offboarding", label: "Offboarding", value: i.offboarding, hint: "open cases", href: "/offboarding" },
    { id: "change-requests", label: "Change requests", value: i.changeRequests, hint: "waiting", href: "/people/requests" },
    { id: "docs-expiring", label: "Docs expiring", value: i.docsExpiring, hint: "next 30 days", href: "/documents" },
    { id: "training-overdue", label: "Training overdue", value: i.trainingOverdue, href: "/training" },
  ];
}

/** People with a current certificate as a whole percent of people assigned: null when nobody is assigned (no 0/0), never above 100. */
export function trainingPercent(current: number, assigned: number): number | null {
  if (!(assigned > 0)) return null;
  return Math.min(100, Math.max(0, Math.round((current / assigned) * 100)));
}

/** Groups of fewer than `min` people are removed, so a team of 1 to 4 never shows a count. */
export function dropSmall<T extends { count: number }>(groups: readonly T[], min: number): T[] {
  return groups.filter((g) => g.count >= min);
}
