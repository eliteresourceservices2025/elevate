import { describe, expect, it } from "vitest";
import { COURSES } from "../../../../learn/src/content";
import { diffCourses, type DiffQuestion } from "./studio-diff";
import { hasErrors, lintCourse, type ExamConfigLike } from "./studio-lint";

const lineaged = (qs: typeof COURSES.hipaa.questions): DiffQuestion[] => qs.map((q, i) => ({ ...q, lineage: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));

describe("lintCourse", () => {
  for (const course of Object.values(COURSES)) {
    it(`finds no errors in the shipped ${course.slug} course`, () => {
      const issues = lintCourse(course.content, course.questions, course.examConfig as ExamConfigLike, course.minPoolFactor);
      expect(issues.filter((i) => i.level === "error")).toEqual([]);
    });
  }

  const base = COURSES.cybersecurity;
  const run = (mutate: (c: typeof base.content, q: typeof base.questions) => void) => {
    const content = structuredClone(base.content);
    const qs = structuredClone(base.questions);
    mutate(content, qs);
    return lintCourse(content, qs, base.examConfig as ExamConfigLike);
  };

  it("refuses markup, web addresses and number shapes in the lessons and in the exam", () => {
    const html = run((c) => {
      const b = c.modules[0].screens[0].blocks[0];
      if (b.type === "paragraph") b.text = "Click <b>here</b> now";
    });
    expect(hasErrors(html)).toBe(true);
    const link = run((_, q) => {
      q[0].rationale = "See https://example.org for the details of this rule.";
    });
    expect(link.some((i) => i.level === "error" && /address/i.test(i.message))).toBe(true);
    const ssn = run((_, q) => {
      q[0].stem = "A caller reads out 123-45-6789 and asks you to confirm it. What do you do?";
    });
    expect(ssn.some((i) => /social security/i.test(i.message))).toBe(true);
  });

  it("refuses a question with no real key, duplicate options or an all-of-the-above option", () => {
    expect(hasErrors(run((_, q) => void (q[0].correctIds = ["f"])))).toBe(true);
    expect(hasErrors(run((_, q) => void (q[0].options[1].text = q[0].options[0].text)))).toBe(true);
    expect(hasErrors(run((_, q) => void (q[0].options[2].text = "All of the above")))).toBe(true);
  });

  it("refuses a duplicate stem and a question that copies a knowledge check", () => {
    expect(hasErrors(run((_, q) => void (q[1].stem = q[0].stem)))).toBe(true);
    const check = run((c, q) => {
      const b = c.modules.flatMap((m) => m.screens.flatMap((s) => s.blocks)).find((x) => x.type === "check");
      if (b && b.type === "check") q[0].stem = b.question;
    });
    expect(check.some((i) => /knowledge check/i.test(i.message))).toBe(true);
  });

  it("warns, without blocking, when a module has few questions", () => {
    const issues = run((c, q) => void q.splice(0, q.length - 20));
    expect(issues.some((i) => i.level === "warning")).toBe(true);
  });
});

describe("diffCourses", () => {
  const a = { content: COURSES.hipaa.content, examConfig: COURSES.hipaa.examConfig, questions: lineaged(COURSES.hipaa.questions) };

  it("says nothing changed for the same course", () => {
    expect(diffCourses(a, a).unchanged).toBe(true);
  });

  it("reports a reworded screen, a retitled module, a reworded question and a changed key", () => {
    const content = structuredClone(a.content);
    content.modules[0].title = "Renamed module";
    const screen = content.modules[0].screens[0];
    const block = screen.blocks[0];
    if (block.type === "paragraph") block.text = `${block.text} Extra sentence.`;
    const questions = structuredClone(a.questions);
    questions[0].stem = `${questions[0].stem} (reworded)`;
    questions[1].correctIds = [questions[1].options.find((o) => !questions[1].correctIds.includes(o.id))!.id];
    const d = diffCourses(a, { content, examConfig: a.examConfig, questions });
    expect(d.unchanged).toBe(false);
    expect(d.modules.changed[0].changes.join(" ")).toContain("Renamed module");
    expect(d.modules.changed[0].screens.changed).toContain(screen.title);
    expect(d.questions.changed.map((c) => c.what).flat()).toEqual(expect.arrayContaining(["wording", "answer key"]));
    expect(d.questions.added).toEqual([]);
    expect(d.questions.removed).toEqual([]);
  });

  it("reports added and removed modules and questions, and changed exam rules", () => {
    const content = structuredClone(a.content);
    const removed = content.modules.pop()!;
    const questions = a.questions.filter((q) => q.moduleKey !== removed.key);
    const cfg = { ...(a.examConfig as object), passPercent: 90 };
    const d = diffCourses(a, { content, examConfig: cfg, questions });
    expect(d.modules.removed).toEqual([removed.title]);
    expect(d.questions.removed.length).toBeGreaterThan(0);
    expect(d.examConfig).not.toBeNull();
  });
});
