// Merge fields for documents written in ELEVATE: {{contractor_name}} and friends, filled in from each person's record when the
// document is sent. Pure (no database). The allowed fields are fixed, so a typo is caught when the document is created and a document
// can never go out with an unfilled {{field}}. A value that is missing on the record stops the send and names the person.

export type SigneeField = { key: string; label: string };

export const SIGNEE_FIELDS: readonly SigneeField[] = [
  { key: "contractor_name", label: "Full name" },
  { key: "contractor_address", label: "Address" },
  { key: "role_title", label: "Role (position)" },
  { key: "start_date", label: "Start date" },
  { key: "reporting_line", label: "Reports to (manager)" },
];

/**
 * Fields HR types in when sending (the same for every copy of that send): pay terms, duties, schedule. Shown as inputs under the
 * editor for the ones the text uses. Pay stays a free-text note: ELEVATE never computes or checks it.
 */
export type SendField = { key: string; label: string; kind: "text" | "textarea" | "choice"; max: number; hint?: string; options?: string[]; initial?: string };
export const SEND_FIELDS: readonly SendField[] = [
  { key: "monthly_rate", label: "Monthly compensation (PHP)", kind: "text", max: 40, hint: "For example 35,000" },
  { key: "payment_frequency", label: "Payment frequency", kind: "choice", max: 20, options: ["weekly", "bi-weekly", "monthly"], initial: "monthly" },
  { key: "duties", label: "Description of duties", kind: "textarea", max: 800 },
  { key: "work_schedule", label: "Work schedule", kind: "text", max: 200, hint: "For example Monday to Friday, 8:00 am to 5:00 pm Arizona time" },
  { key: "courts_location", label: "City or province of the courts", kind: "text", max: 80, initial: "Manila" },
];

const KNOWN = new Set([...SIGNEE_FIELDS.map((f) => f.key), ...SEND_FIELDS.map((f) => f.key)]);
const SEND_KEYS = new Set(SEND_FIELDS.map((f) => f.key));

/** The label of any field, for messages. */
export const fieldLabel = (key: string) => SIGNEE_FIELDS.find((f) => f.key === key)?.label ?? SEND_FIELDS.find((f) => f.key === key)?.label ?? key;

/** The typed-in fields the text uses (HR fills these in when sending). */
export function sendFieldsUsed(body: string): SendField[] {
  return fieldsUsed(body).flatMap((k) => (SEND_KEYS.has(k) ? [SEND_FIELDS.find((f) => f.key === k) as SendField] : []));
}

/** Cleans what HR typed for the typed-in fields. Returns the cleaned values, or a message when one cannot be used. */
export function cleanSendInputs(body: string, raw: Record<string, unknown>): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const f of sendFieldsUsed(body)) {
    const typed = typeof raw[f.key] === "string" ? (raw[f.key] as string) : "";
    if (!collapse(typed)) {
      missing.push(f.label);
      continue;
    }
    // The limit is on what was typed, not on the escaped text that is printed (an escape adds a backslash).
    if (collapse(typed).length > f.max) return { error: `${f.label} is too long (${f.max} characters at most).` };
    const v = cleanValue(typed, f.max);
    if (f.kind === "choice" && !(f.options ?? []).includes(v)) return { error: `Choose a value for ${f.label}.` };
    values[f.key] = v;
  }
  if (missing.length) return { error: `Fill in: ${missing.join(", ")}.` };
  return { values };
}
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** The placeholders a document uses, in order of first use. */
export function fieldsUsed(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) seen.add(m[1]);
  return [...seen];
}

/** Why the text cannot be used: an unknown {{field}}, or a stray "{{" that is not a field. Null when it is fine. */
export function mergeProblem(body: string): string | null {
  const unknown = fieldsUsed(body).filter((k) => !KNOWN.has(k));
  if (unknown.length) return `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.map((k) => `{{${k}}}`).join(", ")}. Use the fields listed under the editor.`;
  const stripped = body.replace(PLACEHOLDER, "");
  if (stripped.includes("{{") || stripped.includes("}}")) return "A field is not closed properly. Fields look like {{contractor_name}}.";
  return null;
}

/** Parts of a ready-made document that HR must replace before it is sent, written [[like this]]. */
export function unfilledPlaceholders(body: string): string[] {
  return [...new Set([...body.matchAll(/\[\[([^\]\n]{1,80})\]\]/g)].map((m) => m[1].trim()))];
}

/**
 * A value made safe to print. Control characters and braces go (so a value can never add a field), and the few characters that mean
 * formatting in the text (* _ [ ] ` and the backslash) are escaped with a backslash, so they print as typed. Everything else, such as
 * parentheses, # and quotes in a name, address or duties, is kept exactly: it is legal text.
 */
export function cleanValue(raw: string, max = 300): string {
  return collapse(raw)
    .slice(0, max)
    .replace(/[\\`*_[\]]/g, "\\$&");
}

/** The text on one line, without control characters or braces: what is checked against a field's length limit. */
export function collapse(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The fields the text uses that have no value in `values`. */
export function missingFields(body: string, values: Record<string, string | undefined>): string[] {
  return fieldsUsed(body).filter((k) => KNOWN.has(k) && !(values[k] ?? "").trim());
}

/** The text with every field replaced by its (cleaned) value. Call missingFields first: an empty value is left as it is. */
export function fillFields(body: string, values: Record<string, string | undefined>): string {
  return body.replace(PLACEHOLDER, (whole, key: string) => {
    const v = KNOWN.has(key) ? cleanValue(values[key] ?? "") : "";
    return v || whole;
  });
}

/** For the editor's preview: each field shown as its label in brackets, so HR can see where details will go. */
export function previewFields(body: string): string {
  return body.replace(PLACEHOLDER, (whole, key: string) => {
    return KNOWN.has(key) ? `**[${fieldLabel(key)}]**` : whole;
  });
}
