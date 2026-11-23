/** Today's worked time (breaks already left out of the stretches), in total and for each client and project, for the Tracker App's screen. */
export type TodayTotals = { totalMs: number; byWork: { clientId: string; projectId: string | null; ms: number }[] };

export function summarizeToday(stretches: readonly { from: number; to: number; clientId: string | null; projectId: string | null }[]): TodayTotals {
  let totalMs = 0;
  const lines = new Map<string, { clientId: string; projectId: string | null; ms: number }>();
  for (const s of stretches) {
    const ms = s.to - s.from;
    if (ms <= 0) continue;
    totalMs += ms;
    if (s.clientId === null) continue; // time with no client counts in the total but has no line of its own
    const key = `${s.clientId}:${s.projectId ?? ""}`;
    const line = lines.get(key);
    if (line) line.ms += ms;
    else lines.set(key, { clientId: s.clientId, projectId: s.projectId, ms });
  }
  // Whole milliseconds: event times can carry fractions, and the Tracker App reads whole numbers (a fraction makes it unable to read the answer).
  return { totalMs: Math.round(totalMs), byWork: [...lines.values()].map((l) => ({ ...l, ms: Math.round(l.ms) })) };
}
