import { describe, expect, it } from "vitest";
import { COURSES } from "./index";
import { courseContentSchema, questionSeedSchema } from "./schema";

// Content lint (docs/learn/06-testing-and-review.md): every course and its exam bank are checked like code, so a typo in the key,
// a duplicate question or a real-looking identifier cannot reach a learner. Runs for every course in the registry.

const allText = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
};

describe("the course registry", () => {
  it("holds the HIPAA course and the separate cybersecurity course", () => {
    expect(Object.keys(COURSES).sort()).toEqual(["cybersecurity", "hipaa"]);
  });

  it("keeps the HIPAA course about HIPAA: general cybersecurity modules live in their own course", () => {
    const hipaa = COURSES.hipaa.content.modules.map((m) => m.key);
    const cyber = COURSES.cybersecurity.content.modules.map((m) => m.key);
    for (const key of ["phishing", "passwords", "devices"]) {
      expect(hipaa).not.toContain(key);
      expect(cyber).toContain(key);
    }
  });
});

for (const course of Object.values(COURSES)) {
  const { content, questions } = course;

  describe(`the ${course.slug} course`, () => {
    it("is valid content with unique module keys and screen ids, and something to do in every module", () => {
      expect(courseContentSchema.safeParse(content).success).toBe(true);
      const keys = content.modules.map((m) => m.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const m of content.modules) {
        const ids = m.screens.map((s) => s.id);
        expect(new Set(ids).size, `${m.key} screen ids`).toBe(ids.length);
        expect(m.screens.length, `${m.key} screens`).toBeGreaterThanOrEqual(5);
        const interactive = m.screens.flatMap((s) => s.blocks).filter((b) => b.type === "scenario" || b.type === "check" || b.type === "case");
        expect(interactive.length, `${m.key} interactive blocks`).toBeGreaterThanOrEqual(1);
      }
    });

    it("contains no markup and nothing that looks like a real identifier, address or link", () => {
      for (const t of [...allText(content), ...allText(questions)]) {
        expect(t, t).not.toMatch(/[<>]/);
        expect(t, t).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/); // SSN shape
        expect(t, t).not.toMatch(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/); // US phone shape
        expect(t, t).not.toMatch(/https?:\/\//i);
        for (const hit of t.match(/[a-z0-9.-]+\.(com|org|net|io|ph|gov)\b/gi) ?? []) expect.fail(`real-looking address in content: ${hit}`);
      }
    });

    it("has a valid exam bank that covers every module", () => {
      expect(questions.length).toBeGreaterThan(0);
      for (const question of questions) expect(questionSeedSchema.safeParse(question).success, question.stem).toBe(true);
      const known = new Set(content.modules.map((m) => m.key));
      for (const x of questions) expect(known.has(x.moduleKey), x.moduleKey).toBe(true);
      for (const m of content.modules) {
        const n = questions.filter((x) => x.moduleKey === m.key).length;
        expect(n, `${m.key} questions`).toBeGreaterThanOrEqual(8);
      }
    });

    it("can draw every track's exam from the bank with room to rotate", () => {
      const config = course.examConfig as { tracks: Record<string, { questions: number }> };
      for (const [track, { questions: n }] of Object.entries(config.tracks)) {
        const keys = new Set(content.modules.filter((m) => m.tracks.includes(track as "full")).map((m) => m.key));
        if (keys.size === 0) continue;
        const pool = questions.filter((x) => keys.has(x.moduleKey)).length;
        expect(pool, `${track} pool`).toBeGreaterThanOrEqual(Math.ceil(n * course.minPoolFactor));
      }
    });

    it("has well-formed questions: one idea, a real key, no trick options", () => {
      const stems = new Set<string>();
      for (const x of questions) {
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
      const checks = content.modules.flatMap((m) => m.screens.flatMap((s) => s.blocks)).flatMap((b) => (b.type === "check" ? [b.question.trim().toLowerCase()] : []));
      for (const x of questions) expect(checks, x.stem).not.toContain(x.stem.trim().toLowerCase());
    });
  });
}

describe("the HIPAA course specifically", () => {
  const { content, questions, examConfig } = COURSES.hipaa;

  it("has 7 modules of about 80 minutes, in order", () => {
    expect(content.modules.map((m) => m.key)).toEqual(["foundations", "phi", "privacy", "security", "workplace", "incidents", "lab"]);
    expect(content.modules.reduce((n, m) => n + m.estimatedMinutes, 0)).toBe(79);
  });

  it("puts the right modules in each track", () => {
    const inTrack = (t: "full" | "essentials" | "refresher") => content.modules.filter((m) => m.tracks.includes(t)).map((m) => m.key);
    expect(inTrack("full")).toHaveLength(7);
    expect(inTrack("essentials")).toEqual(["foundations", "phi", "privacy", "incidents"]);
    expect(inTrack("refresher")).toEqual(["foundations", "phi", "privacy", "incidents"]);
  });

  it("matches the organization's existing course: 15 questions and 80% to pass, on every track", () => {
    const config = examConfig as { passPercent: number; tracks: Record<string, { questions: number }> };
    expect(config.passPercent).toBe(80);
    for (const t of Object.values(config.tracks)) expect(t.questions).toBe(15);
    expect(questions.length).toBeGreaterThanOrEqual(80);
  });
});
