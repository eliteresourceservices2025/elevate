import { describe, expect, it } from "vitest";
import { COURSES } from "../../../../learn/src/content";
import { courseContentSchema, questionSeedSchema } from "../../../../learn/src/content/schema";
import { canPublish, publishChecklist } from "./studio-checklist";
import { hasErrors, hasPlaceholders, lintCourse, textIsAllowed, type ExamConfigLike } from "./studio-lint";
import { addonSlugFor, moduleKeyFor, newAddonCourse, newBlock, newModule, newQuestion, newScreen, placeholdersIn, screenIdFor } from "./studio-scaffold";

const course = COURSES.cybersecurity;
const cfg = course.examConfig as ExamConfigLike;

describe("scaffolds", () => {
  it("makes unique, valid keys and ids", () => {
    expect(moduleKeyFor("Working from a cafe!", [])).toBe("working_from_a_cafe");
    expect(moduleKeyFor("Passwords", ["passwords", "passwords_2"])).toBe("passwords_3");
    expect(screenIdFor("A new screen", ["a-new-screen"])).toBe("a-new-screen-2");
    expect(/^[a-z0-9_]{1,40}$/.test(moduleKeyFor("x".repeat(100), []))).toBe(true);
  });

  it("builds a module that the content schema accepts, with placeholders flagged but not an error", () => {
    const m = newModule({ title: "A new module", estimatedMinutes: 8, tracks: ["full"] }, course.content.modules.map((x) => x.key));
    const content = structuredClone(course.content);
    content.modules.push(m);
    expect(courseContentSchema.safeParse(content).success).toBe(true);
    const issues = lintCourse(content, course.questions, cfg);
    expect(hasErrors(issues)).toBe(false);
    expect(hasPlaceholders(issues)).toBe(true);
    expect(placeholdersIn(content, course.questions)).toBeGreaterThan(5);
  });

  it("builds every block type and every question type to a valid shape", () => {
    for (const type of ["paragraph", "list", "callout", "compare", "steps", "scenario", "check", "table", "layers", "timeline", "glossary", "case", "sort", "cards", "spot", "flip", "build", "branch", "game"] as const) {
      const s = newScreen("Try", []);
      s.blocks = [newBlock(type)];
      const content = structuredClone(course.content);
      content.modules[0].screens.push(s);
      expect(courseContentSchema.safeParse(content).success, type).toBe(true);
    }
    for (const type of ["single", "multiple", "true_false", "scenario"] as const) {
      const q = newQuestion({ moduleKey: course.content.modules[0].key, type, existingStems: [] });
      expect(questionSeedSchema.safeParse(q).success, type).toBe(true);
      const issues = lintCourse(course.content, [...course.questions, q], cfg);
      expect(hasErrors(issues), type).toBe(false);
    }
  });

  it("gives two new questions in one module different wording", () => {
    const m = course.content.modules[0].key;
    const a = newQuestion({ moduleKey: m, type: "single", existingStems: [] });
    const b = newQuestion({ moduleKey: m, type: "single", existingStems: [a.stem] });
    expect(a.stem).not.toBe(b.stem);
  });
});

describe("publishChecklist", () => {
  const clean = { issues: [], unchangedVsLive: false, viewerIsLastEditor: false };
  it("is ready when nothing blocks", () => {
    expect(canPublish(publishChecklist(clean))).toBe(true);
  });
  it("blocks on errors, placeholders, no change and the last editor", () => {
    expect(canPublish(publishChecklist({ ...clean, issues: [{ level: "error", where: "x", message: "bad" }] }))).toBe(false);
    expect(canPublish(publishChecklist({ ...clean, issues: [{ level: "warning", code: "placeholder", where: "course", message: "TO WRITE" }] }))).toBe(false);
    expect(canPublish(publishChecklist({ ...clean, unchangedVsLive: true }))).toBe(false);
    expect(canPublish(publishChecklist({ ...clean, viewerIsLastEditor: true }))).toBe(false);
  });
  it("only advises on a thin bank, and allows the first publication (nothing live yet)", () => {
    const items = publishChecklist({ ...clean, unchangedVsLive: null, issues: [{ level: "warning", where: "M", message: "Only 3 exam questions for this module (aim for 8 or more)." }] });
    expect(canPublish(items)).toBe(true);
    expect(items.find((i) => i.label.includes("at least 8"))?.ok).toBe(false);
  });
});

describe("client add-on scaffold", () => {
  it("builds a draft the checks accept, with placeholders that block publishing", () => {
    const a = newAddonCourse("Acme Health", textIsAllowed);
    expect(courseContentSchema.safeParse(a.content).success).toBe(true);
    const issues = lintCourse(a.content, a.questions, a.examConfig);
    expect(hasErrors(issues)).toBe(false);
    expect(hasPlaceholders(issues)).toBe(true);
    expect(a.questions).toHaveLength(5);
    expect(a.content.modules).toHaveLength(1);
    expect(a.content.modules[0].screens).toHaveLength(3);
    expect(a.content.modules[0].tracks).toEqual(["full"]);
  });

  it("keeps a name with a web address out of lesson text", () => {
    const a = newAddonCourse("clinic.com Group", textIsAllowed);
    expect(a.content.modules[0].title).toBe("Working with this client");
    expect(hasErrors(lintCourse(a.content, a.questions, a.examConfig))).toBe(false);
  });

  it("makes plain, unique addresses", () => {
    expect(addonSlugFor("Acme Health, Inc.", [])).toBe("acme-health-inc-requirements");
    expect(addonSlugFor("Acme Health, Inc.", ["acme-health-inc-requirements"])).toBe("acme-health-inc-requirements-2");
    expect(addonSlugFor("***", [])).toBe("client-requirements");
    expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(addonSlugFor("A".repeat(200), []))).toBe(true);
  });
});

describe("the lesson stage has no page scroll", () => {
  it("warns about a slide that is too long, and not about a short one", () => {
    const content = structuredClone(course.content);
    const long = newScreen("A very long slide", content.modules[0].screens.map((s) => s.id));
    long.blocks = Array.from({ length: 3 }, () => ({ type: "paragraph" as const, text: "x".repeat(600) }));
    content.modules[0].screens.push(long);
    const warned = lintCourse(content, course.questions, cfg).filter((i) => i.message.includes("long for the lesson stage"));
    expect(warned.map((i) => i.where)).toContain(`${content.modules[0].title}: A very long slide`);
  });
});
