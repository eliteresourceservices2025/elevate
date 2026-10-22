import { describe, expect, it } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";
import { getHelpArticle, listHelpArticles, mayOpenHelpFile, searchHelp, visibleCategories } from "./content";

// Reads the real articles in content/help: what each role may see is the whole point of the audience tag.
const asRoles = (...extra: RoleSlug[]): RoleSlug[] => ["employee", ...extra];

describe("who sees which real article", () => {
  it("an employee sees only articles for everyone", () => {
    const articles = listHelpArticles(asRoles());
    expect(articles.length).toBeGreaterThan(0);
    expect(articles.every((a) => a.audience === "all")).toBe(true);
    expect(getHelpArticle(asRoles(), "people", "invite-a-person")).toBeNull();
  });

  it("HR sees the invite guide, a recruiter does not", () => {
    expect(getHelpArticle(asRoles("hr_admin"), "people", "invite-a-person")).not.toBeNull();
    expect(getHelpArticle(asRoles("recruiter"), "people", "invite-a-person")).toBeNull();
  });

  it("only a Super Admin sees the erase-test-applications guide", () => {
    for (const role of ROLE_SLUGS) {
      const seen = getHelpArticle(asRoles(role), "recruiting", "erase-test-applications") !== null;
      expect(seen, role).toBe(role === "super_admin");
    }
  });

  it("an unknown category or slug is not found", () => {
    expect(getHelpArticle(asRoles("super_admin"), "nope", "invite-a-person")).toBeNull();
    expect(getHelpArticle(asRoles("super_admin"), "people", "../x")).toBeNull();
  });

  it("categories and search only count what the person may see", () => {
    expect(visibleCategories(asRoles()).every((c) => c.count > 0)).toBe(true);
    expect(searchHelp(asRoles(), "invitation").some((a) => a.slug === "invite-a-person")).toBe(false);
    expect(searchHelp(asRoles("hr_admin"), "invitation").some((a) => a.slug === "invite-a-person")).toBe(true);
    expect(searchHelp(asRoles("hr_admin"), "a")).toEqual([]);
  });
});

describe("picture and video guard", () => {
  it("lets a video through only to someone who may read its article", () => {
    const withVideo = listHelpArticles(asRoles("super_admin")).find((a) => a.video);
    if (!withVideo) return; // no videos yet
    expect(mayOpenHelpFile(asRoles("super_admin"), "videos", `${withVideo.video}.mp4`)).toBe(true);
    expect(mayOpenHelpFile(asRoles("super_admin"), "videos", "other.mp4")).toBe(false);
  });

  it("lets a picture through only inside a visible article's folder", () => {
    expect(mayOpenHelpFile(asRoles("hr_admin"), "assets", "invite-a-person/01.png")).toBe(true);
    expect(mayOpenHelpFile(asRoles(), "assets", "invite-a-person/01.png")).toBe(false);
    expect(mayOpenHelpFile(asRoles("hr_admin"), "assets", "unknown-slug/01.png")).toBe(false);
  });
});
