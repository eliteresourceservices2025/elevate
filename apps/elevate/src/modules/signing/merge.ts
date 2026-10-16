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

const KNOWN = new Set(SIGNEE_FIELDS.map((f) => f.key));
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

/** A value made safe to print: no braces or control characters, no characters that format text, bounded. */
export function cleanValue(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[{}]/g, "")
    .replace(/[*_[\]()`#>~|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
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
    const f = SIGNEE_FIELDS.find((x) => x.key === key);
    return f ? `**[${f.label}]**` : whole;
  });
}
