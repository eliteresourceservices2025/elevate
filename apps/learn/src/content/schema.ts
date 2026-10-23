import { z } from "zod";

// The shape of course content. Content is DATA, never HTML: every block below is rendered as React elements by the player, so an
// author cannot add markup or script. The same schema validates the authoring files (content lint test), the publish step and
// what the player reads back from the database.
//
// Knowledge checks and scenarios give immediate feedback and are NOT graded, so their answers travel with the lesson. The exam
// questions (questions.ts) are a separate bank whose answer key never leaves the database.

const text = z.string().trim().min(1).max(900);
const short = z.string().trim().min(1).max(160);

export const choiceSchema = z.object({ text: short, feedback: z.string().trim().min(1).max(500), best: z.boolean() });
export const checkOptionSchema = z.object({ text: short, correct: z.boolean(), feedback: z.string().trim().min(1).max(400) });

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text }),
  z.object({ type: z.literal("list"), ordered: z.boolean().optional(), items: z.array(short).min(2).max(10) }),
  z.object({ type: z.literal("callout"), tone: z.enum(["info", "warning", "tip"]), title: short.optional(), text }),
  z.object({
    type: z.literal("compare"),
    left: z.object({ title: short, items: z.array(short).min(1).max(6) }),
    right: z.object({ title: short, items: z.array(short).min(1).max(6) }),
  }),
  z.object({ type: z.literal("steps"), items: z.array(z.object({ title: short, text: short })).min(2).max(7) }),
  z.object({ type: z.literal("scenario"), title: short, prompt: text, choices: z.array(choiceSchema).min(2).max(4) }),
  // A grid of facts, for example what a business associate agreement must contain. Every row has one cell per column.
  z
    .object({
      type: z.literal("table"),
      caption: short.optional(),
      columns: z.array(z.string().trim().min(1).max(60)).min(2).max(4),
      rows: z.array(z.array(short).min(2).max(4)).min(1).max(10),
    })
    .refine((b) => b.rows.every((r) => r.length === b.columns.length), { message: "Every table row needs one cell for each column." }),
  // Stacked bands, for example the safeguards that sit on top of one another.
  z.object({ type: z.literal("layers"), title: short.optional(), items: z.array(z.object({ label: z.string().trim().min(1).max(60), text: short })).min(2).max(6) }),
  // A sequence with a label for each moment, for example the days after a breach is found.
  z.object({ type: z.literal("timeline"), title: short.optional(), items: z.array(z.object({ when: z.string().trim().min(1).max(60), text: short })).min(2).max(8) }),
  // Terms introduced in the module, kept together so they can be looked up again.
  z.object({ type: z.literal("glossary"), terms: z.array(z.object({ term: z.string().trim().min(1).max(60), meaning: z.string().trim().min(1).max(260) })).min(2).max(10) }),
  // A worked case: read it, think, then reveal the answer. Not graded.
  z.object({ type: z.literal("case"), title: short, scenario: text, question: short, answer: text }),
  z.object({
    type: z.literal("check"),
    question: short,
    multiple: z.boolean().optional(),
    options: z.array(checkOptionSchema).min(2).max(5),
  }),
  // ---- Interactive blocks (customer service course and later the older courses). Plain data like the rest; none is graded. ----
  // Put the steps in order. `items` are written in the CORRECT order; the player shows them shuffled.
  z.object({ type: z.literal("sort"), title: short, prompt: text, items: z.array(short).min(2).max(7), explanation: text }),
  // Sort each card into a group (for example "Empathy" or "Not empathy"). One card at a time, with a streak.
  z
    .object({
      type: z.literal("cards"),
      title: short,
      prompt: text,
      groups: z.array(z.string().trim().min(1).max(40)).min(2).max(3),
      cards: z.array(z.object({ text: short, group: z.number().int().min(0).max(2), feedback: z.string().trim().min(1).max(300) })).min(3).max(10),
    })
    .refine((b) => b.cards.every((c) => c.group < b.groups.length), { message: "Every card must point at one of the groups." }),
  // A short conversation or message with something wrong in it: tap the line that is wrong.
  z
    .object({
      type: z.literal("spot"),
      title: short,
      prompt: text,
      lines: z.array(z.object({ speaker: z.string().trim().min(1).max(30), text: short, wrong: z.boolean().optional() })).min(3).max(10),
      explanation: text,
    })
    .refine((b) => b.lines.some((l) => l.wrong), { message: "At least one line must be marked as the mistake." }),
  // Cards that flip over: a term or framework on the front, its meaning on the back.
  z.object({ type: z.literal("flip"), title: short.optional(), cards: z.array(z.object({ front: z.string().trim().min(1).max(80), back: z.string().trim().min(1).max(260) })).min(2).max(8) }),
  // Build something piece by piece (a call note, a reply): pick the right piece for each slot.
  z.object({
    type: z.literal("build"),
    title: short,
    prompt: text,
    slots: z
      .array(
        z
          .object({ label: z.string().trim().min(1).max(60), options: z.array(checkOptionSchema).min(2).max(4) })
          .refine((s) => s.options.filter((o) => o.correct).length === 1, { message: "Each slot needs exactly one correct option." }),
      )
      .min(2)
      .max(6),
  }),
  // A short call with a mood meter: the caller speaks, you pick a reply, the caller's mood moves.
  z.object({
    type: z.literal("branch"),
    title: short,
    intro: text,
    startMood: z.number().int().min(10).max(90).optional(),
    turns: z
      .array(
        z.object({
          caller: text,
          choices: z.array(z.object({ text: short, mood: z.number().int().min(-30).max(30), reply: z.string().trim().min(1).max(400) })).min(2).max(4),
        }),
      )
      .min(2)
      .max(6),
  }),
  // Quiz rounds played as a game: streak, optional seconds per question. Not graded and not part of the exam.
  z.object({
    type: z.literal("game"),
    title: short,
    seconds: z.number().int().min(5).max(60).optional(),
    rounds: z
      .array(
        z
          .object({ question: short, options: z.array(checkOptionSchema).min(2).max(4) })
          .refine((r) => r.options.filter((o) => o.correct).length === 1, { message: "Each round needs exactly one correct option." }),
      )
      .min(3)
      .max(10),
  }),
]);

/** Block types a person can do something with (the lint asks for at least one per module). */
export const INTERACTIVE_BLOCK_TYPES = ["scenario", "check", "case", "sort", "cards", "spot", "flip", "build", "branch", "game"] as const;

export const screenSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: short,
  blocks: z.array(blockSchema).min(1).max(6),
});

export const moduleSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/),
  title: short,
  summary: z.string().trim().min(10).max(300),
  estimatedMinutes: z.number().int().min(1).max(120),
  /** Which tracks include the module (see docs/learn/04-course-and-exam.md). */
  tracks: z.array(z.enum(["full", "essentials", "refresher"])).min(1),
  screens: z.array(screenSchema).min(3).max(60),
  keyPoints: z.array(short).min(3).max(8),
});

export const courseContentSchema = z.object({
  title: short,
  /** Plain-language statement the person accepts after passing. Counsel approves the final wording before launch. */
  attestation: z.object({ version: z.string().regex(/^[a-z0-9._-]{1,30}$/), text: z.string().trim().min(40).max(1500) }),
  modules: z.array(moduleSchema).min(1).max(20),
});

export type Block = z.infer<typeof blockSchema>;
export type Screen = z.infer<typeof screenSchema>;
export type CourseModule = z.infer<typeof moduleSchema>;
export type CourseContent = z.infer<typeof courseContentSchema>;

// ---- Exam questions (the bank). Authored with `q()` so the option ids and the key are generated, not typed. ------------------

export const QUESTION_TYPES = ["single", "multiple", "true_false", "scenario"] as const;

export type QuestionSeed = {
  moduleKey: string;
  topic: string;
  type: (typeof QUESTION_TYPES)[number];
  stem: string;
  options: { id: string; text: string }[];
  correctIds: string[];
  rationale: string;
};

const IDS = ["a", "b", "c", "d", "e", "f"] as const;

/** q(module, topic, type, stem, options, indexes of the correct options, why). */
export function q(moduleKey: string, topic: string, type: QuestionSeed["type"], stem: string, options: string[], correct: number[], rationale: string): QuestionSeed {
  return {
    moduleKey,
    topic,
    type,
    stem,
    options: options.map((t, i) => ({ id: IDS[i], text: t })),
    correctIds: correct.map((i) => IDS[i]),
    rationale,
  };
}

export const questionSeedSchema = z.object({
  moduleKey: z.string().regex(/^[a-z0-9_]{1,40}$/),
  topic: z.string().trim().min(2).max(60),
  type: z.enum(QUESTION_TYPES),
  stem: z.string().trim().min(15).max(600),
  options: z.array(z.object({ id: z.enum(IDS), text: z.string().trim().min(1).max(260) })).min(2).max(6),
  correctIds: z.array(z.enum(IDS)).min(1).max(5),
  rationale: z.string().trim().min(20).max(700),
});
