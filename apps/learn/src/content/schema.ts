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
  z.object({
    type: z.literal("check"),
    question: short,
    multiple: z.boolean().optional(),
    options: z.array(checkOptionSchema).min(2).max(5),
  }),
]);

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
