import { describe, expect, it } from "vitest";
import { courseContentSchema, questionSeedSchema } from "../schema";
import { hipaaCourse, hipaaExamConfig, hipaaQuestions } from "./index";

// Content lint (docs/learn/06-testing-and-review.md): the course and the exam bank are checked like code, so a typo in the key, a
// duplicate question or a real-looking identifier cannot reach a learner.

const allText = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
};

describe("the HIPAA course", () => {
  it("is valid content with 8 modules of about 85 minutes", () => {
    const parsed = courseContentSchema.safeParse(hipaaCourse);
    expect(parsed.success).toBe(true);
    expect(hipaaCourse.modules.map((m) => m.key)).toEqual(["foundations", "phi", "privacy", "security", "remote", "phishing", "incidents", "lab"]);
    const total = hipaaCourse.modules.reduce((n, m) => n + m.estimatedMinutes, 0);
    expect(total).toBe(85);
  });

  it("has unique module keys and screen ids, and something to do in every module", () => {
    const keys = hipaaCourse.modules.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of hipaaCourse.modules) {
      const ids = m.screens.map((s) => s.id);
      expect(new Set(ids).size, `${m.key} screen ids`).toBe(ids.length);
      expect(m.screens.length, `${m.key} screens`).toBeGreaterThanOrEqual(7);
      const interactive = m.screens.flatMap((s) => s.blocks).filter((b) => b.type === "scenario" || b.type === "check");
      expect(interactive.length, `${m.key} interactive blocks`).toBeGreaterThanOrEqual(1);
    }
  });

  it("puts the right modules in each track", () => {
    const inTrack = (t: "full" | "essentials" | "refresher") => hipaaCourse.modules.filter((m) => m.tracks.includes(t)).map((m) => m.key);
    expect(inTrack("full")).toHaveLength(8);
    expect(inTrack("essentials")).toEqual(["foundations", "phi", "privacy", "phishing", "incidents"]);
    expect(inTrack("refresher")).toEqual(["foundations", "phi", "privacy", "phishing", "incidents"]);
  });

  it("contains no markup and nothing that looks like a real identifier, address or link", () => {
    const text = [...allText(hipaaCourse), ...allText(hipaaQuestions)];
    for (const t of text) {
      expect(t, t).not.toMatch(/[<>]/);
      expect(t, t).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/); // SSN shape
      expect(t, t).not.toMatch(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/); // US phone shape
      expect(t, t).not.toMatch(/https?:\/\//i);
      // an email-like or web address must be on the reserved .example name
      for (const hit of t.match(/[a-z0-9.-]+\.(com|org|net|io|ph|gov)\b/gi) ?? []) expect.fail(`real-looking address in content: ${hit}`);
    }
  });
});

describe("the exam bank", () => {
  it("has at least 80 valid questions", () => {
    expect(hipaaQuestions.length).toBeGreaterThanOrEqual(80);
    for (const question of hipaaQuestions) {
      const r = questionSeedSchema.safeParse(question);
      expect(r.success, question.stem).toBe(true);
    }
  });

  it("covers every module, at least 8 questions each", () => {
    for (const m of hipaaCourse.modules) {
      const n = hipaaQuestions.filter((x) => x.moduleKey === m.key).length;
      expect(n, `${m.key} questions`).toBeGreaterThanOrEqual(8);
    }
    const known = new Set(hipaaCourse.modules.map((m) => m.key));
    for (const x of hipaaQuestions) expect(known.has(x.moduleKey), x.moduleKey).toBe(true);
  });

  it("is large enough to draw each track's exam from, with room to rotate", () => {
    const keys = (t: "full" | "essentials") => new Set(hipaaCourse.modules.filter((m) => m.tracks.includes(t)).map((m) => m.key));
    const pool = (t: "full" | "essentials") => hipaaQuestions.filter((x) => keys(t).has(x.moduleKey)).length;
    expect(pool("full")).toBeGreaterThanOrEqual(hipaaExamConfig.tracks.full.questions * 3);
    expect(pool("essentials")).toBeGreaterThanOrEqual(hipaaExamConfig.tracks.essentials.questions * 3);
  });

  it("has well-formed questions: one idea, a real key, no trick options", () => {
    const stems = new Set<string>();
    for (const x of hipaaQuestions) {
      const key = x.stem.trim().toLowerCase();
      expect(stems.has(key), `duplicate stem: ${x.stem}`).toBe(false);
      stems.add(key);

      const ids = x.options.map((o) => o.id);
      expect(new Set(ids).size, x.stem).toBe(ids.length);
      const texts = x.options.map((o) => o.text.trim().toLowerCase());
      expect(new Set(texts).size, `duplicate options: ${x.stem}`).toBe(texts.length);
      for (const id of x.correctIds) expect(ids, x.stem).toContain(id);
      for (const o of x.options) expect(o.text, x.stem).not.toMatch(/\b(all|none) of the above\b/i);

      if (x.type === "multiple") expect(x.correctIds.length, x.stem).toBeGreaterThanOrEqual(2);
      else expect(x.correctIds.length, x.stem).toBe(1);
      if (x.type === "true_false") expect(x.options.map((o) => o.text), x.stem).toEqual(["True", "False"]);
      else expect(x.options.length, x.stem).toBeGreaterThanOrEqual(3);
    }
  });

  it("does not repeat a knowledge check from the lessons (the exam stays fresh)", () => {
    const checks = hipaaCourse.modules.flatMap((m) => m.screens.flatMap((s) => s.blocks)).flatMap((b) => (b.type === "check" ? [b.question.trim().toLowerCase()] : []));
    for (const x of hipaaQuestions) expect(checks, x.stem).not.toContain(x.stem.trim().toLowerCase());
  });
});
