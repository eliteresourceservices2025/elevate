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
    case "table":
      return { type, columns: ["Item", "What it means"], rows: [[`${PLACEHOLDER} first item`, `${PLACEHOLDER} meaning`]] };
    case "layers":
      return { type, items: [{ label: "Layer 1", text: `${PLACEHOLDER} what it is` }, { label: "Layer 2", text: `${PLACEHOLDER} what it is` }] };
    case "timeline":
      return { type, items: [{ when: "First", text: `${PLACEHOLDER} what happens` }, { when: "Then", text: `${PLACEHOLDER} what happens next` }] };
    case "glossary":
      return { type, terms: [{ term: "Term", meaning: `${PLACEHOLDER} what it means` }, { term: "Another term", meaning: `${PLACEHOLDER} what it means` }] };
    case "case":
      return { type, title: "A worked case", scenario: `${PLACEHOLDER} describe the situation.`, question: `${PLACEHOLDER} what should happen?`, answer: `${PLACEHOLDER} the answer and why.` };
    case "sort":
      return { type, title: "Put these in order", prompt: `${PLACEHOLDER} what should the learner order?`, items: [`${PLACEHOLDER} first step`, `${PLACEHOLDER} second step`], explanation: `${PLACEHOLDER} why this is the order.` };
    case "cards":
      return {
        type,
        title: "Sort the cards",
        prompt: `${PLACEHOLDER} what are they sorting?`,
        groups: ["Group one", "Group two"],
        cards: [0, 1, 0].map((group, i) => ({ text: `${PLACEHOLDER} card ${i + 1}`, group, feedback: `${PLACEHOLDER} why.` })),
      };
    case "spot":
      return {
        type,
        title: "Spot the mistake",
        prompt: `${PLACEHOLDER} tap the line that is wrong.`,
        lines: [{ speaker: "Caller", text: `${PLACEHOLDER} what the caller says` }, { speaker: "Agent", text: `${PLACEHOLDER} the mistake`, wrong: true }, { speaker: "Caller", text: `${PLACEHOLDER} reply` }],
        explanation: `${PLACEHOLDER} what was wrong and why.`,
      };
    case "hotspot":
      return {
        type,
        title: "Find the problems",
        prompt: `${PLACEHOLDER} describe the scene and what to tap.`,
        items: [
          { label: "Item 1", text: `${PLACEHOLDER} what is shown`, problem: true, why: `${PLACEHOLDER} why it is a problem.` },
          { label: "Item 2", text: `${PLACEHOLDER} what is shown` },
          { label: "Item 3", text: `${PLACEHOLDER} what is shown` },
          { label: "Item 4", text: `${PLACEHOLDER} what is shown` },
        ],
        explanation: `${PLACEHOLDER} what the learner should take away.`,
      };
    case "flip":
      return { type, cards: [{ front: "Term", back: `${PLACEHOLDER} meaning` }, { front: "Another term", back: `${PLACEHOLDER} meaning` }] };
    case "build": {
      const slot = (label: string) => ({ label, options: [{ text: `${PLACEHOLDER} the right piece`, correct: true, feedback: `${PLACEHOLDER} why.` }, { text: `${PLACEHOLDER} a wrong piece`, correct: false, feedback: `${PLACEHOLDER} why not.` }] });
      return { type, title: "Build it", prompt: `${PLACEHOLDER} what are they building?`, slots: [slot("First part"), slot("Second part")] };
    }
    case "branch": {
      const turn = (n: number) => ({
        caller: `${PLACEHOLDER} what the caller says (turn ${n})`,
        choices: [{ text: `${PLACEHOLDER} a good reply`, mood: 15, reply: `${PLACEHOLDER} how the caller answers` }, { text: `${PLACEHOLDER} a poor reply`, mood: -20, reply: `${PLACEHOLDER} how the caller answers` }],
      });
      return { type, title: "A call", intro: `${PLACEHOLDER} set the scene (invented people only).`, turns: [turn(1), turn(2)] };
    }
    case "game": {
      const round = (n: number) => ({ question: `${PLACEHOLDER} question ${n}`, options: [{ text: `${PLACEHOLDER} right`, correct: true, feedback: `${PLACEHOLDER} why.` }, { text: `${PLACEHOLDER} wrong`, correct: false, feedback: `${PLACEHOLDER} why not.` }] });
      return { type, title: "Quick round", rounds: [round(1), round(2), round(3)] };
    }
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
export function newAddonCourse(clientName: string, safe: (text: string) => boolean, topic?: string, acknowledgmentOnly = false) {
  const name = clientName.trim().replace(/\s+/g, " ").slice(0, 70);
  // A client's second and later add-ons carry a short topic to tell them apart ("Acme: Billing policy").
  const subject = topic?.trim().replace(/\s+/g, " ").slice(0, 40) || null;
  const inText = safe(name) ? name : "this client";
  const first = newModule({ title: `Working with ${inText}`.slice(0, 160), estimatedMinutes: 10, tracks: ["full"] }, []);
  const content: CourseContent = {
    title: subject ? `${name}: ${subject}` : `${name} requirements`,
    attestation: {
      version: "v1",
      text: `${PLACEHOLDER} I have completed the training on ${inText}'s requirements and understand what is expected of me when I work for this client.`,
    },
    modules: [first],
  };
  const questions: QuestionSeed[] = [];
  // An acknowledgment-only add-on has no exam: nothing to write but the lessons and the statement.
  const asked = acknowledgmentOnly ? 0 : ADDON_QUESTIONS;
  for (let i = 0; i < asked; i += 1) questions.push(newQuestion({ moduleKey: first.key, type: "single", existingStems: questions.map((q) => q.stem) }));
  return {
    title: content.title,
    label: (subject ? `${name}: ${subject}` : `${name} requirements`).slice(0, 60),
    noun: (subject ? `${name} ${subject} training` : `${name} requirements training`).slice(0, 100),
    content,
    questions,
    examConfig: { passPercent: 80, maxTries: 3, waitMinutesAfterFail: 60, renewalMonths: 12, tracks: { full: { questions: asked } } },
  };
}
