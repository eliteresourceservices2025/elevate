import type { Block, CourseContent, CourseModule, QuestionSeed } from "../../../../learn/src/content/schema";

// New things in the studio start as scaffolds: valid enough to save, with "TO WRITE:" text that the checks flag until it is
// replaced. A draft with placeholders can be saved and shared, but cannot be published. Pure (no database).

export const PLACEHOLDER = "TO WRITE:";
export const hasPlaceholder = (text: string) => text.includes(PLACEHOLDER);

const IDS = ["a", "b", "c", "d", "e", "f"] as const;

/** A module key from a title: lower case letters, digits and underscores, unique among the given keys. */
export function moduleKeyFor(title: string, taken: string[]): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 34) || "module";
  let key = base;
  for (let i = 2; taken.includes(key); i += 1) key = `${base}_${i}`;
  return key;
}

/** A screen id from a title, unique among the given ids. */
export function screenIdFor(title: string, taken: string[]): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34) || "screen";
  let id = base;
  for (let i = 2; taken.includes(id); i += 1) id = `${base}-${i}`;
  return id;
}

export function newBlock(type: Block["type"]): Block {
  switch (type) {
    case "paragraph":
      return { type, text: `${PLACEHOLDER} write this paragraph.` };
    case "list":
      return { type, items: [`${PLACEHOLDER} first item`, `${PLACEHOLDER} second item`] };
    case "callout":
      return { type, tone: "tip", text: `${PLACEHOLDER} write this callout.` };
    case "compare":
      return { type, left: { title: "Do", items: [`${PLACEHOLDER} item`] }, right: { title: "Do not", items: [`${PLACEHOLDER} item`] } };
    case "steps":
      return { type, items: [{ title: "Step 1", text: `${PLACEHOLDER} what to do` }, { title: "Step 2", text: `${PLACEHOLDER} what to do next` }] };
    case "scenario":
      return {
        type,
        title: "A situation",
        prompt: `${PLACEHOLDER} describe what happens.`,
        choices: [
          { text: `${PLACEHOLDER} the right response`, feedback: `${PLACEHOLDER} why this is right.`, best: true },
          { text: `${PLACEHOLDER} a tempting wrong response`, feedback: `${PLACEHOLDER} why this is not right.`, best: false },
        ],
      };
    case "check":
      return {
        type,
        question: `${PLACEHOLDER} the question`,
        options: [
          { text: `${PLACEHOLDER} the right answer`, correct: true, feedback: `${PLACEHOLDER} why.` },
          { text: `${PLACEHOLDER} a wrong answer`, correct: false, feedback: `${PLACEHOLDER} why not.` },
        ],
      };
  }
}

export function newScreen(title: string, takenIds: string[]): CourseModule["screens"][number] {
  return { id: screenIdFor(title, takenIds), title, blocks: [newBlock("paragraph")] };
}

export function newModule(p: { title: string; estimatedMinutes: number; tracks: CourseModule["tracks"] }, takenKeys: string[]): CourseModule {
  return {
    key: moduleKeyFor(p.title, takenKeys),
    title: p.title,
    summary: `${PLACEHOLDER} one or two sentences on what this module covers.`,
    estimatedMinutes: p.estimatedMinutes,
    tracks: p.tracks,
    screens: [1, 2, 3].map((n) => ({ id: `screen-${n}`, title: `Screen ${n}`, blocks: [newBlock("paragraph")] })),
    keyPoints: [1, 2, 3].map((n) => `${PLACEHOLDER} key point ${n}`),
  };
}

export function newQuestion(p: { moduleKey: string; type: QuestionSeed["type"]; existingStems: string[] }): QuestionSeed {
  let n = p.existingStems.length + 1;
  let stem = `${PLACEHOLDER} question ${n} for this module goes here`;
  while (p.existingStems.some((s) => s.trim().toLowerCase() === stem.toLowerCase())) {
    n += 1;
    stem = `${PLACEHOLDER} question ${n} for this module goes here`;
  }
  const base = { moduleKey: p.moduleKey, topic: "New topic", stem, rationale: `${PLACEHOLDER} why the answer is right.` };
  if (p.type === "true_false") return { ...base, type: "true_false", options: [{ id: "a", text: "True" }, { id: "b", text: "False" }], correctIds: ["a"] };
  if (p.type === "multiple") return { ...base, type: "multiple", options: IDS.slice(0, 4).map((id, i) => ({ id, text: `${PLACEHOLDER} option ${i + 1}` })), correctIds: ["a", "b"] };
  return { ...base, type: p.type, options: IDS.slice(0, 4).map((id, i) => ({ id, text: `${PLACEHOLDER} option ${i + 1}` })), correctIds: ["a"] };
}

/** Every piece of text in a course that still has the placeholder marker (for the publish checklist). */
export function placeholdersIn(content: CourseContent, questions: QuestionSeed[]): number {
  const walk = (v: unknown): number => (typeof v === "string" ? (hasPlaceholder(v) ? 1 : 0) : Array.isArray(v) ? v.reduce<number>((n, x) => n + walk(x), 0) : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).reduce<number>((n, x) => n + walk(x), 0) : 0);
  return walk(content) + walk(questions);
}

// ---- Client add-ons ---------------------------------------------------------------------------------------------------------------

const ADDON_QUESTIONS = 5;

/** The address of a client's add-on: the client's name in lower case words plus "-requirements", unique among the taken addresses. */
export function addonSlugFor(clientName: string, taken: string[]): string {
  const words = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const base = `${words || "client"}-requirements`;
  let slug = base;
  for (let i = 2; taken.includes(slug); i += 1) slug = `${base}-${i}`;
  return slug;
}

/**
 * The first draft of a client add-on: one module of three screens and a short exam of placeholder questions, all on the full track
 * (an add-on has one track, so a renewal repeats it). `safe` says whether a piece of text is allowed in course text; a client name
 * that would trip the text checks (for example a web address) is kept out of lessons and used only in titles.
 */
export function newAddonCourse(clientName: string, safe: (text: string) => boolean) {
  const name = clientName.trim().replace(/\s+/g, " ").slice(0, 70);
  const inText = safe(name) ? name : "this client";
  const first = newModule({ title: `Working with ${inText}`.slice(0, 160), estimatedMinutes: 10, tracks: ["full"] }, []);
  const content: CourseContent = {
    title: `${name} requirements`,
    attestation: {
      version: "v1",
      text: `${PLACEHOLDER} I have completed the training on ${inText}'s requirements and understand what is expected of me when I work for this client.`,
    },
    modules: [first],
  };
  const questions: QuestionSeed[] = [];
  for (let i = 0; i < ADDON_QUESTIONS; i += 1) questions.push(newQuestion({ moduleKey: first.key, type: "single", existingStems: questions.map((q) => q.stem) }));
  return {
    title: content.title,
    label: `${name} requirements`.slice(0, 60),
    noun: `${name} requirements training`.slice(0, 100),
    content,
    questions,
    examConfig: { passPercent: 80, maxTries: 3, waitMinutesAfterFail: 60, renewalMonths: 12, tracks: { full: { questions: ADDON_QUESTIONS } } },
  };
}
