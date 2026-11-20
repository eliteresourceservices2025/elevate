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
