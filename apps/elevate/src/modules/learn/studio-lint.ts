import { courseContentSchema, INTERACTIVE_BLOCK_TYPES, questionSeedSchema, type CourseContent, type QuestionSeed } from "../../../../learn/src/content/schema";
import { placeholdersIn } from "./studio-scaffold";

// The checks a course must pass before it can be saved or published from the studio. Pure (no database). The same rules the content
// tests in apps/learn apply to the files in code, so a studio edit cannot slip below what code content has to meet.
// ERRORS block saving and publishing. WARNINGS are shown and do not block (a thin question bank, for example).

/** `code: "placeholder"` marks unfinished "TO WRITE:" text: allowed in a draft, never in a published version. */
export type LintIssue = { level: "error" | "warning"; where: string; message: string; code?: "placeholder" };

export type ExamConfigLike = { tracks?: Record<string, { questions: number }> };

const MIN_POOL_FACTOR = 3;
const LONG_SLIDE_CHARS = 1400;

const allText = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(allText) : value && typeof value === "object" ? Object.values(value as Record<string, unknown>).flatMap(allText) : [];

function textRules(where: string, texts: string[], out: LintIssue[]) {
  for (const t of texts) {
    const short = t.length > 50 ? `${t.slice(0, 50)}...` : t;
    if (/[<>]/.test(t)) out.push({ level: "error", where, message: `Markup characters (< or >) are not allowed: "${short}"` });
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) out.push({ level: "error", where, message: `Looks like a social security number: "${short}"` });
    if (/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.test(t)) out.push({ level: "error", where, message: `Looks like a phone number: "${short}"` });
    if (/https?:\/\//i.test(t)) out.push({ level: "error", where, message: `Web addresses are not allowed in course text: "${short}"` });
    for (const hit of t.match(/[a-z0-9.-]+\.(com|org|net|io|ph|gov)\b/gi) ?? []) out.push({ level: "error", where, message: `Looks like a real web or email address: ${hit}` });
  }
}

export function lintCourse(content: CourseContent, questions: QuestionSeed[], examConfig: ExamConfigLike, poolFactor = MIN_POOL_FACTOR): LintIssue[] {
  const out: LintIssue[] = [];
  const parsed = courseContentSchema.safeParse(content);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) out.push({ level: "error", where: i.path.join(".") || "course", message: i.message });
    return out;
  }

  const keys = content.modules.map((m) => m.key);
  if (new Set(keys).size !== keys.length) out.push({ level: "error", where: "modules", message: "Module keys must be unique." });
  for (const m of content.modules) {
    const ids = m.screens.map((s) => s.id);
    if (new Set(ids).size !== ids.length) out.push({ level: "error", where: m.title, message: "Two screens in this module have the same id." });
    if (m.screens.length < 5) out.push({ level: "warning", where: m.title, message: `Only ${m.screens.length} screens (the shipped courses have at least 5).` });
    const interactive = m.screens.flatMap((s) => s.blocks).filter((b) => (INTERACTIVE_BLOCK_TYPES as readonly string[]).includes(b.type));
    if (interactive.length === 0) out.push({ level: "warning", where: m.title, message: "No knowledge check or scenario: people have nothing to do in this module." });
    for (const s of m.screens) {
      // the lesson stage has no page scroll, so a slide that is long scrolls inside its own card: worth splitting
      const chars = allText(s.blocks).join(" ").length;
      if (s.blocks.length > 4 || chars > LONG_SLIDE_CHARS) out.push({ level: "warning", where: `${m.title}: ${s.title}`, message: "This slide is long for the lesson stage (it scrolls inside its card). Consider splitting it into two slides." });
    }
    textRules(m.title, allText(m), out);
  }
  textRules("responsibility statement", allText(content.attestation), out);

  const known = new Set(keys);
  const stems = new Set<string>();
  const checks = content.modules.flatMap((m) => m.screens.flatMap((s) => s.blocks)).flatMap((b) => (b.type === "check" ? [b.question.trim().toLowerCase()] : []));
  for (const x of questions) {
    const where = `Question: ${x.stem.slice(0, 40)}`;
    const r = questionSeedSchema.safeParse(x);
    if (!r.success) {
      out.push({ level: "error", where, message: r.error.issues[0]?.message ?? "Invalid question." });
      continue;
    }
    if (!known.has(x.moduleKey)) out.push({ level: "error", where, message: `Points at a module that does not exist (${x.moduleKey}).` });
    const stem = x.stem.trim().toLowerCase();
    if (stems.has(stem)) out.push({ level: "error", where, message: "Another question has the same wording." });
    stems.add(stem);
    if (checks.includes(stem)) out.push({ level: "error", where, message: "This is the same as a knowledge check in the lessons (the exam must stay fresh)." });
    const ids = x.options.map((o) => o.id);
    const texts = x.options.map((o) => o.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) out.push({ level: "error", where, message: "Two options have the same text." });
    for (const id of x.correctIds) if (!ids.includes(id)) out.push({ level: "error", where, message: `The key points at an option that is not there (${id}).` });
    for (const o of x.options) if (/\b(all|none) of the above\b/i.test(o.text)) out.push({ level: "error", where, message: "\"All of the above\" and \"none of the above\" options are not allowed." });
    if (x.type === "multiple") {
      if (x.correctIds.length < 2) out.push({ level: "error", where, message: "A select-all question needs at least two correct options." });
    } else if (x.correctIds.length !== 1) out.push({ level: "error", where, message: "This question type needs exactly one correct option." });
    if (x.type === "true_false") {
      if (x.options.map((o) => o.text).join("|") !== "True|False") out.push({ level: "error", where, message: "A true/false question must have the options True and False." });
    } else if (x.options.length < 3) out.push({ level: "error", where, message: "Use at least three options." });
    textRules(where, [x.stem, ...x.options.map((o) => o.text), x.rationale], out);
  }

  for (const m of content.modules) {
    const n = questions.filter((x) => x.moduleKey === m.key).length;
    if (n < 8) out.push({ level: "warning", where: m.title, message: `Only ${n} exam questions for this module (aim for 8 or more).` });
  }
  for (const [track, { questions: n }] of Object.entries(examConfig.tracks ?? {})) {
    const trackKeys = new Set(content.modules.filter((m) => (m.tracks as string[]).includes(track)).map((m) => m.key));
    if (trackKeys.size === 0) continue;
    const pool = questions.filter((x) => trackKeys.has(x.moduleKey)).length;
    const need = Math.ceil(n * poolFactor);
    if (pool < need) out.push({ level: "warning", where: `${track} track`, message: `The exam draws ${n} questions from ${pool}; at least ${need} are recommended so attempts differ.` });
    if (pool < n) out.push({ level: "error", where: `${track} track`, message: `The exam needs ${n} questions but only ${pool} are available for this track.` });
  }
  const unfinished = placeholdersIn(content, questions);
  if (unfinished > 0) out.push({ level: "warning", code: "placeholder", where: "course", message: `${unfinished} ${unfinished === 1 ? "place still has" : "places still have"} the placeholder text "TO WRITE:". Replace ${unfinished === 1 ? "it" : "them"} before publishing.` });
  return out;
}

export const hasErrors = (issues: LintIssue[]) => issues.some((i) => i.level === "error");
export const hasPlaceholders = (issues: LintIssue[]) => issues.some((i) => i.code === "placeholder");

/** Would this text pass the course-text rules (no markup, numbers that look like identifiers, or web addresses)? */
export function textIsAllowed(text: string): boolean {
  const out: LintIssue[] = [];
  textRules("text", [text], out);
  return out.length === 0;
}
