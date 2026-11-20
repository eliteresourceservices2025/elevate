// A rough estimate of the media a call costs us at Cloudflare (egress, the part that counts toward the 1,000 GB a month free allowance),
// so Settings can show "about X of 1,000 GB" and warn early. These are planning numbers from the design (meeting: audio from everyone
// plus about 9 small video tiles; all-hands: one speaker stream); the real figure is in Cloudflare's dashboard.

const GB_PER_PARTICIPANT_HOUR = { meeting: 1.0, townhall: 0.6 } as const;

export function estimateCallGb(mode: "meeting" | "townhall", participantMinutes: number): number {
  const hours = Math.max(0, participantMinutes) / 60;
  // Two decimals, never negative.
  return Math.round(hours * GB_PER_PARTICIPANT_HOUR[mode] * 100) / 100;
}

export type TurnUsage = { egressGb: number; ingressGb: number };

const GB = 1_000_000_000; // Cloudflare bills in decimal gigabytes.

/** The GraphQL question: TURN bytes from the first of this month (UTC) to today, optionally for one TURN key. Variables are passed separately, never spliced in. */
export function buildTurnUsageQuery(now: Date, keyId?: string): { text: string; variables: Record<string, string> } {
  const from = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const to = now.toISOString().slice(0, 10);
  // The key id is checked by the caller (letters, digits, - and _ only), so writing it into the filter as a quoted literal is safe.
  const key = keyId && /^[A-Za-z0-9_-]{8,64}$/.test(keyId) ? `, keyId: ${JSON.stringify(keyId)}` : "";
  const text = `query TurnUsage($accountId: String!, $dateFrom: Date, $dateTo: Date) {
  viewer { accounts(filter: { accountTag: $accountId }) {
    callsTurnUsageAdaptiveGroups(limit: 100, filter: { date_geq: $dateFrom, date_leq: $dateTo${key} }) {
      dimensions { keyId }
      sum { egressBytes ingressBytes }
    }
  } }
}`;
  return { text, variables: { dateFrom: from, dateTo: to } };
}

/** Adds up the rows of Cloudflare's answer. Null when the answer does not have the expected shape. */
export function sumTurnBytes(data: unknown): TurnUsage | null {
  const rows = (data as { viewer?: { accounts?: { callsTurnUsageAdaptiveGroups?: unknown }[] } } | null | undefined)?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups;
  if (!Array.isArray(rows)) return null;
  let egress = 0;
  let ingress = 0;
  for (const row of rows) {
    const sum = (row as { sum?: { egressBytes?: unknown; ingressBytes?: unknown } } | null)?.sum;
    if (typeof sum?.egressBytes === "number") egress += sum.egressBytes;
    if (typeof sum?.ingressBytes === "number") ingress += sum.ingressBytes;
  }
  const round = (bytes: number) => Math.round((bytes / GB) * 100) / 100;
  return { egressGb: round(egress), ingressGb: round(ingress) };
}

/** Whether the month's estimated total has passed the warning level (a Super Admin sets it; 700 of the free 1,000 by default). */
export function overWarning(monthGb: number, warningGb: number): boolean {
  return monthGb >= warningGb;
}
