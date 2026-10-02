// Pure builders for what recruiting emails say, and the interview calendar invite (.ics). No database.
// Emails to applicants are short and carry no assessment of them: no scores, no notes, no reasons.

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstName = (full: string) => full.trim().split(/\s+/)[0] || "there";

export type CandidateMail = { subject: string; text: string; html: string };

function wrap(heading: string, lines: string[]): { text: string; html: string } {
  const text = `${lines.join("\n\n")}\n\nElite Resource Services`;
  const paragraphs = lines.map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${escapeHtml(l).replace(/\n/g, "<br>")}</p>`).join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3fb;font-family:Inter,Arial,sans-serif;color:#1f1b2d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#6C1ABA;padding:16px 24px;color:#ffffff;font-weight:700;font-size:18px">Elite Resource Services</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:18px">${escapeHtml(heading)}</h1>${paragraphs}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export function receivedMail(input: { fullName: string; jobTitle: string }): CandidateMail {
  const { text, html } = wrap("We received your application", [
    `Hi ${firstName(input.fullName)},`,
    `Thank you for applying for ${input.jobTitle}. We have your application and a member of our team will review it. You do not need to do anything else for now.`,
  ]);
  return { subject: "We received your application", text, html };
}

export function rejectionMail(input: { fullName: string; jobTitle: string }): CandidateMail {
  const { text, html } = wrap("About your application", [
    `Hi ${firstName(input.fullName)},`,
    `Thank you for your interest in ${input.jobTitle} and for the time you took to apply. We will not be moving forward with your application this time. We wish you the very best in your search.`,
  ]);
  return { subject: "About your application", text, html };
}

export function interviewMail(input: { fullName: string; jobTitle: string; when: string; location: string; note?: string | null }): CandidateMail {
  const { text, html } = wrap("Your interview", [
    `Hi ${firstName(input.fullName)},`,
    `We would like to talk with you about ${input.jobTitle}.\nWhen: ${input.when}\nWhere: ${input.location}`,
    ...(input.note ? [input.note] : []),
    "A calendar invite is attached. Reply to this email if the time does not work for you.",
  ]);
  return { subject: "Your interview with Elite Resource Services", text, html };
}

// --- Calendar invite -----------------------------------------------------------------------------------------------

const escapeIcs = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    if (enc.encode(current + ch).length > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
    }
    current += ch;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export type InterviewInvite = { uid: string; summary: string; startsAt: Date; minutes: number; location: string; description?: string; method?: "REQUEST" | "CANCEL"; sequence?: number };

/** A timed event in UTC. A re-sent invite with the same uid updates the event; method CANCEL removes it. */
export function buildInterviewIcs(invite: InterviewInvite, now = new Date()): string {
  const end = new Date(invite.startsAt.getTime() + invite.minutes * 60_000);
  const cancelled = invite.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ELEVATE//Recruiting//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${invite.method ?? "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${invite.uid}@elevate`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(invite.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SEQUENCE:${invite.sequence ?? (cancelled ? 1 : 0)}`,
    `SUMMARY:${escapeIcs(invite.summary)}`,
    `LOCATION:${escapeIcs(invite.location)}`,
    ...(invite.description ? [`DESCRIPTION:${escapeIcs(invite.description)}`] : []),
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
