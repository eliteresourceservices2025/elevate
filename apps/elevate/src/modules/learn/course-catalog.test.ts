import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { describeCourse, findLearnCourse, listLearnCourses, pickCourse } from "./course-catalog";
import { COURSE_SLUG_PATTERN, CORE_COURSES } from "./constants";

// A fake executor: returns the add-on rows it was given, so the catalog's merging rules can be tested without a database.
const rowsOf = (rows: object[]) => ({ execute: async (_q: SQL) => rows });

const ADDON = { slug: "acme-health", title: "Acme Health requirements", label: null, noun: null, fixed_track: "full", client_id: "11111111-1111-4111-8111-111111111111" };

describe("course catalog", () => {
  it("lists the core courses first and then add-ons by name", async () => {
    const list = await listLearnCourses(rowsOf([ADDON]));
    expect(list.map((c) => c.slug)).toEqual([...CORE_COURSES.map((c) => c.slug), "acme-health"]);
    expect(list[CORE_COURSES.length]).toMatchObject({ kind: "client_addon", clientId: ADDON.client_id, fixedTrack: "full", label: "Acme Health requirements", noun: "Acme Health requirements training" });
  });

  it("with no add-ons it is exactly the core courses", async () => {
    const list = await listLearnCourses(rowsOf([]));
    expect(list).toEqual([...CORE_COURSES]);
  });

  it("never lets a database row replace or duplicate a core course", async () => {
    const list = await listLearnCourses(rowsOf([{ ...ADDON, slug: "hipaa", label: "Fake HIPAA" }]));
    expect(list.filter((c) => c.slug === "hipaa")).toHaveLength(1);
    expect(list.find((c) => c.slug === "hipaa")?.label).toBe("HIPAA");
  });

  it("finds a core course without asking the database, and an add-on by its address", async () => {
    const boom = { execute: async () => { throw new Error("database touched"); } };
    expect((await findLearnCourse(boom, "hipaa"))?.label).toBe("HIPAA");
    expect((await findLearnCourse(rowsOf([ADDON]), "acme-health"))?.kind).toBe("client_addon");
    expect(await findLearnCourse(rowsOf([ADDON]), "nope")).toBeNull();
    expect(await findLearnCourse(rowsOf([]), null)).toBeNull();
  });

  it("falls back to HIPAA for an unknown address on a page, and to a plain word for a notice", async () => {
    const catalog = await listLearnCourses(rowsOf([ADDON]));
    expect(pickCourse(catalog, "nope").slug).toBe("hipaa");
    expect(pickCourse(catalog, undefined).slug).toBe("hipaa");
    expect(pickCourse(catalog, "acme-health").slug).toBe("acme-health");
    expect((await describeCourse(rowsOf([]), "gone")).noun).toBe("training");
  });

  it("accepts only course addresses the database accepts", () => {
    for (const ok of ["hipaa", "acme-health", "a1", "x-2-y"]) expect(COURSE_SLUG_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["", "Acme", "a_b", "-a", "a-", "a--b", "a b", "../x"]) expect(COURSE_SLUG_PATTERN.test(bad), bad).toBe(false);
  });
});
