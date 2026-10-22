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

// ---- Editable wording ------------------------------------------------------------------------------------------------------
// HR can reword the three emails applicants get without a person writing to them. The text is plain (no formatting, no links) and can use
// only the merge fields below; the built-in wording is used until HR saves their own. They never carry scores, notes or reasons.

export const TEMPLATE_KINDS = ["received", "rejection", "not_qualified"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  received: "We received your application",
  rejection: "Not moving forward",
  not_qualified: "Not qualified for the role",
};
export const TEMPLATE_WHEN: Record<TemplateKind, string> = {
  received: "Sent right after someone applies (when the job has this switched on).",
  rejection: "Sent when a recruiter closes an application as \"We are not moving forward\" and ticks the email box.",
  not_qualified: "Sent when a recruiter closes an application as \"Not qualified for the role\" and ticks the email box.",
};
export const MERGE_FIELDS = ["first_name", "job_title"] as const;
export const SUBJECT_MAX = 150;
export const BODY_MAX = 2000;

export type MailTemplate = { subject: string; body: string };
export const BUILT_IN_TEMPLATES: Record<TemplateKind, MailTemplate> = {
  received: {
    subject: "We received your application",
    body: "Hi {{first_name}},\n\nThank you for applying for {{job_title}}. We have your application and a member of our team will review it. You do not need to do anything else for now.",
  },
  rejection: {
    subject: "About your application",
    body: "Hi {{first_name}},\n\nThank you for your interest in {{job_title}} and for the time you took to apply. We will not be moving forward with your application this time. We wish you the very best in your search.",
  },
  not_qualified: {
    subject: "About your application",
    body: "Hi {{first_name}},\n\nThank you for applying for {{job_title}}. After reading your application, it does not match the requirements for this role at this time. You are welcome to apply again if your experience changes, and we wish you the very best in your search.",
  },
};

const FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** An error message for a template that cannot be saved (an unknown or unclosed merge field, too long, empty), or null. */
export function validateTemplate(t: MailTemplate): string | null {
  const subject = t.subject.trim();
  const body = t.body.trim();
  if (!subject) return "Write a subject.";
  if (!body) return "Write the message.";
  if (subject.length > SUBJECT_MAX) return `The subject can be ${SUBJECT_MAX} characters at most.`;
  if (body.length > BODY_MAX) return `The message can be ${BODY_MAX} characters at most.`;
  for (const text of [subject, body]) {
    for (const m of text.matchAll(FIELD)) if (!(MERGE_FIELDS as readonly string[]).includes(m[1])) return `Unknown field {{${m[1]}}}. You can use ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(" and ")}.`;
    const stripped = text.replace(FIELD, "");
    if (stripped.includes("{{") || stripped.includes("}}")) return "A { { field } } is not closed. Write it like {{first_name}}.";
  }
  return null;
}

const fill = (text: string, vars: Record<(typeof MERGE_FIELDS)[number], string>) => text.replace(FIELD, (_, name: string) => (vars as Record<string, string>)[name] ?? "");

/** Fills the merge fields and builds the email. The words are escaped for the HTML part, so a name or job title can never become markup. */
export function renderTemplate(template: MailTemplate, input: { fullName: string; jobTitle: string }): CandidateMail {
  const vars = { first_name: firstName(input.fullName), job_title: input.jobTitle };
  const subject = fill(template.subject, vars).replace(/\s+/g, " ").trim();
  const paragraphs = fill(template.body, vars)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const { text, html } = wrap(subject, paragraphs);
  return { subject, text, html };
}

export const receivedMail = (input: { fullName: string; jobTitle: string }, template: MailTemplate = BUILT_IN_TEMPLATES.received): CandidateMail => renderTemplate(template, input);
export const rejectionMail = (input: { fullName: string; jobTitle: string }, template: MailTemplate = BUILT_IN_TEMPLATES.rejection): CandidateMail => renderTemplate(template, input);
export const notQualifiedMail = (input: { fullName: string; jobTitle: string }, template: MailTemplate = BUILT_IN_TEMPLATES.not_qualified): CandidateMail => renderTemplate(template, input);

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
