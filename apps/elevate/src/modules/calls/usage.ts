// A rough estimate of the media a call costs us at Cloudflare (egress, the part that counts toward the 1,000 GB a month free allowance),
// so Settings can show "about X of 1,000 GB" and warn early. These are planning numbers from the design (meeting: audio from everyone
// plus about 9 small video tiles; all-hands: one speaker stream); the real figure is in Cloudflare's dashboard.

const GB_PER_PARTICIPANT_HOUR = { meeting: 1.0, townhall: 0.6 } as const;

export function estimateCallGb(mode: "meeting" | "townhall", participantMinutes: number): number {
  const hours = Math.max(0, participantMinutes) / 60;
  // Two decimals, never negative.
  return Math.round(hours * GB_PER_PARTICIPANT_HOUR[mode] * 100) / 100;
}

/** Whether the month's estimated total has passed the warning level (a Super Admin sets it; 700 of the free 1,000 by default). */
export function overWarning(monthGb: number, warningGb: number): boolean {
  return monthGb >= warningGb;
}
