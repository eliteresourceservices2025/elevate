import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_SLUGS } from "@/lib/roles";
import { canSeeHelpArticle } from "./audience";
import { isSafeAssetPath, referencedImages, splitBody } from "./body";
import { HELP_CATEGORIES } from "./categories";
import { parseArticleSource, splitFrontmatter } from "./frontmatter";

const ROOT = path.join(process.cwd(), "content", "help");

const GOOD = `---
title: Invite a person
summary: Send an invitation so someone can sign up.
category: people
audience: hr_admin, team_lead
order: 2
video: invite-a-person
updated: 2026-10-21
---
Body here.`;

describe("article header", () => {
  it("reads a good header", () => {
    const { meta, body } = parseArticleSource(GOOD);
    expect(meta.audience).toEqual(["hr_admin", "team_lead"]);
    expect(meta.order).toBe(2);
    expect(meta.video).toBe("invite-a-person");
    expect(body).toBe("Body here.");
  });
  it("accepts audience all", () => {
    expect(parseArticleSource(GOOD.replace("hr_admin, team_lead", "all")).meta.audience).toBe("all");
  });
  it("refuses a missing header, an unknown role, an unknown category and a bad video name", () => {
    expect(() => splitFrontmatter("no header")).toThrow();
    expect(() => parseArticleSource(GOOD.replace("hr_admin, team_lead", "boss"))).toThrow();
    expect(() => parseArticleSource(GOOD.replace("category: people", "category: nope"))).toThrow();
    expect(() => parseArticleSource(GOOD.replace("invite-a-person", "../x"))).toThrow();
  });
});

describe("who sees an article", () => {
  it("shows an all article to every role", () => {
    for (const role of ROLE_SLUGS) expect(canSeeHelpArticle([role, "employee"], "all")).toBe(true);
  });
  it("hides an HR article from an employee, executive and a plain employee with no other role", () => {
    const audience = ["super_admin", "hr_admin", "team_lead", "recruiter"] as const;
    expect(canSeeHelpArticle(["employee"], audience)).toBe(false);
    expect(canSeeHelpArticle(["employee", "executive"], audience)).toBe(false);
    expect(canSeeHelpArticle(["employee", "recruiter"], audience)).toBe(true);
    expect(canSeeHelpArticle(["employee", "hr_admin"], audience)).toBe(true);
  });
});

describe("pictures", () => {
  it("accepts a plain path and refuses anything that could leave the folder", () => {
    expect(isSafeAssetPath("invite/01-people.png")).toBe(true);
    for (const bad of ["../x.png", "a/../b.png", "/etc/passwd.png", "a\\b.png", "a.svg", "a.png?x=1", "https://x.com/a.png", ".hidden.png"]) {
      expect(isSafeAssetPath(bad)).toBe(false);
    }
  });
  it("splits an image line out of the text", () => {
    const parts = splitBody("Before\n\n![The page](help:invite/01.png)\n\nAfter");
    expect(parts.map((p) => p.kind)).toEqual(["markdown", "image", "markdown"]);
    expect(parts[1]).toEqual({ kind: "image", path: "invite/01.png", alt: "The page" });
    expect(referencedImages("![x](help:../a.png)")).toEqual([]);
  });
});

describe("the real articles", () => {
  const files = HELP_CATEGORIES.flatMap((c) => {
    const dir = path.join(ROOT, c.slug);
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => ({ category: c.slug, file: f })) : [];
  });

  it("has articles", () => expect(files.length).toBeGreaterThan(0));

  it.each(files)("$category/$file has a valid header, existing pictures and video", ({ category, file }) => {
    const { meta, body } = parseArticleSource(readFileSync(path.join(ROOT, category, file), "utf8"));
    expect(meta.category).toBe(category);
    for (const image of referencedImages(body)) expect(existsSync(path.join(ROOT, "assets", image)), `${image} is missing`).toBe(true);
    if (meta.video) expect(existsSync(path.join(ROOT, "videos", `${meta.video}.mp4`)), `video ${meta.video} is missing`).toBe(true);
    // Guides are for people who are not technical: no real email addresses in the text, apart from the example domain.
    const emails = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    for (const email of emails) expect(email.endsWith("@example.com"), `${email} is not an example address`).toBe(true);
  });

  it("uses each slug once", () => {
    const slugs = files.map((f) => f.file);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
