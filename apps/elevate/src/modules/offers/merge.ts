import { parseMarkdown, MARKDOWN_MAX_LENGTH, type Block, type Inline } from "@/lib/markdown";

// Offer templates are Markdown-style text with {{merge_fields}}. Pure: no database. The allowed fields are fixed, so a typo in a template
// is caught when it is saved, and a letter can never go out with an unfilled {{field}}.

export type MergeField = { key: string; label: string; source: "auto" | "input"; required: boolean };

export const MERGE_FIELDS: readonly MergeField[] = [
  { key: "candidate_name", label: "Applicant's name", source: "auto", required: true },
  { key: "offer_date", label: "Date of the letter", source: "auto", required: true },
  { key: "expires_on", label: "Last day to accept", source: "auto", required: true },
  { key: "role_title", label: "Role", source: "input", required: true },
  { key: "start_date", label: "Start date", source: "input", required: true },
  { key: "client_name", label: "Client", source: "input", required: false },
  { key: "pay_note", label: "Pay note (free text)", source: "input", required: false },
];

const KNOWN = new Set(MERGE_FIELDS.map((f) => f.key));
const REQUIRED = new Set(MERGE_FIELDS.filter((f) => f.required).map((f) => f.key));
export const OPTIONAL_BLANK = "To be confirmed";
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** The placeholders a template uses, in order of first use. */
export function fieldsUsed(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) seen.add(m[1]);
  return [...seen];
}

/** Why a template cannot be saved, or null: too long, an unknown {{field}}, or a stray "{{" that is not a field. */
export function templateProblem(body: string): string | null {
  if (body.trim().length < 20) return "Write the letter (at least a few sentences).";
  if (body.length > MARKDOWN_MAX_LENGTH) return "The template is too long (10,000 characters at most).";
  const unknown = fieldsUsed(body).filter((k) => !KNOWN.has(k));
  if (unknown.length) return `Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.map((k) => `{{${k}}}`).join(", ")}. Use the fields listed under the editor.`;
  const stripped = body.replace(PLACEHOLDER, "");
  if (stripped.includes("{{") || stripped.includes("}}")) return "A merge field is not closed properly. Fields look like {{role_title}}.";
  return null;
}

/** A value made safe to put in a letter: no braces, no control characters, bounded; names also lose the characters that format text. */
export function cleanValue(raw: string, opts: { name?: boolean } = {}): string {
  let v = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[{}]/g, "").trim().slice(0, 300);
  if (opts.name) v = v.replace(/[*_[\]()`#>~]/g, "").replace(/\s+/g, " ").trim();
  return v;
}

export type OfferValues = Record<string, string>;

/** The value for one field: what was filled in, "To be confirmed" for an optional field left blank, or null for a required one that is empty. */
function valueFor(key: string, values: OfferValues): string | null {
  // eslint-disable-next-line security/detect-object-injection -- key is checked against the fixed list of merge fields by every caller
  const v = (values[key] ?? "").trim();
  if (v) return v;
  return REQUIRED.has(key) ? null : OPTIONAL_BLANK;
}

/** Required fields the template uses that have no value (so the letter cannot be sent yet). Optional ones read "To be confirmed". */
export function missingFields(body: string, values: OfferValues): string[] {
  return fieldsUsed(body).filter((k) => KNOWN.has(k) && valueFor(k, values) === null);
}

/** The letter as plain text with every field filled. Used for the saved snapshot. Unfilled fields are left visible as {{field}}. */
export function renderText(body: string, values: OfferValues): string {
  return body.replace(PLACEHOLDER, (whole, key: string) => (KNOWN.has(key) ? (valueFor(key, values) ?? whole) : whole));
}

const fillInline = (nodes: Inline[], values: OfferValues): Inline[] =>
  nodes.map((n) => {
    if (n.type === "text") return { ...n, text: n.text.replace(PLACEHOLDER, (whole, key: string) => (KNOWN.has(key) ? (valueFor(key, values) ?? whole) : whole)) };
    if (n.type === "strong" || n.type === "em" || n.type === "link") return { ...n, children: fillInline(n.children, values) };
    return n;
  });

/**
 * The letter as blocks, with the fields filled AFTER parsing, so a value can never turn into formatting or a link. This is what the
 * PDF and the preview draw.
 */
export function renderBlocks(body: string, values: OfferValues): Block[] {
  return parseMarkdown(body).map((b): Block => {
    if (b.type === "list") return { ...b, items: b.items.map((item) => fillInline(item, values)) };
    return { ...b, children: fillInline(b.children, values) };
  });
}

/** Plain text of a run of inline nodes (links become their label). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : inlineText(n.children))).join("");
}

export const DEFAULT_OFFER_TEMPLATE = `# Independent contractor agreement offer

Dear {{candidate_name}},

Elite Resource Services ("ERS") is pleased to offer you an engagement as an independent contractor in the role of **{{role_title}}**, to begin on **{{start_date}}**.

## Engagement

- Role: {{role_title}}
- Start date: {{start_date}}
- Client: {{client_name}}
- Pay: {{pay_note}}

You will provide your services as an independent contractor and not as an employee of ERS. You are responsible for your own taxes and for providing your own equipment, as set out in the contractor agreement you will receive on your first day.

## Confidentiality

You agree not to include, store or share any client or patient information outside the systems ERS provides, and to keep confidential everything you learn about ERS and its clients.

## Accepting this offer

Please sign below by {{expires_on}}. This offer is dated {{offer_date}}. We look forward to working with you.

Elite Resource Services
`;
