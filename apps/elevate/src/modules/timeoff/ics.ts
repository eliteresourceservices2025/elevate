// Calendar invite (.ics, RFC 5545) for approved leave. All-day event, no personal detail beyond "Day off".

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const compact = (date: string) => date.replace(/-/g, "");

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Lines longer than 75 bytes are folded onto continuation lines that start with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    if (bytes.encode(current + ch).length > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
    }
    current += ch;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export type LeaveInvite = {
  /** A stable id so a re-sent invite updates the same event. */
  uid: string;
  /** "Day off" style title. */
  summary: string;
  startDate: string;
  /** Inclusive last day. */
  endDate: string;
  /** When the invite was made, as an ISO instant. */
  stampIso: string;
  /** "CANCEL" turns the invite into a cancellation of the same event. */
  method?: "PUBLISH" | "CANCEL";
};

export function buildLeaveIcs(invite: LeaveInvite): string {
  const stamp = invite.stampIso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const cancelled = invite.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ELEVATE//Time off//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${invite.method ?? "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${invite.uid}@elevate`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(invite.startDate)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(invite.endDate))}`,
    `SUMMARY:${escapeText(invite.summary)}`,
    "TRANSP:OPAQUE",
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SEQUENCE:${cancelled ? 1 : 0}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
