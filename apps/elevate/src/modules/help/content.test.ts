import { describe, expect, it } from "vitest";
import { ROLE_SLUGS, type PayrollLevel, type RoleSlug } from "@/lib/roles";
import { getHelpArticle, listHelpArticles, mayOpenHelpFile, searchHelp, visibleCategories } from "./content";

// Reads the real articles in content/help: what each role may see is the whole point of the audience tag.
const asRoles = (...extra: RoleSlug[]) => ({ roles: ["employee", ...extra] as RoleSlug[] });
const withPayroll = (level: PayrollLevel, ...extra: RoleSlug[]) => ({ roles: ["employee", ...extra] as RoleSlug[], payrollAccess: level });

describe("the payroll guides", () => {
  const FOR_EVERYONE = ["how-payroll-works", "read-your-payslip"];
  const FOR_PAYROLL = ["prepare-a-pay-run", "approve-a-pay-run", "import-jibble-timesheet", "release-statements", "rehearse-a-pay-cycle"];
  const payrollSlugs = (viewer: Parameters<typeof listHelpArticles>[0]) => listHelpArticles(viewer).filter((a) => a.category === "payroll").map((a) => a.slug);

  it("a VA or employee with no payroll level sees only the two guides for everyone", () => {
    for (const viewer of [asRoles(), { roles: ["employee"] as RoleSlug[], payrollAccess: null }]) {
      expect(payrollSlugs(viewer).sort()).toEqual([...FOR_EVERYONE].sort());
    }
  });

  it("HR and a Super Admin without a payroll level don't see the staff guides either (the invoice guide is theirs by role)", () => {
    for (const viewer of [asRoles("hr_admin"), asRoles("super_admin")]) {
      const seen = payrollSlugs(viewer);
      for (const slug of FOR_PAYROLL) expect(seen, slug).not.toContain(slug);
      for (const slug of FOR_EVERYONE) expect(seen, slug).toContain(slug);
    }
  });

  it("someone with any payroll level also sees the staff guides", () => {
    for (const level of ["preparer", "approver", "viewer"] as const) {
      const seen = payrollSlugs(withPayroll(level));
      for (const slug of [...FOR_EVERYONE, ...FOR_PAYROLL]) expect(seen, `${level}: ${slug}`).toContain(slug);
    }
  });

  it("the staff guides, their search results and their pictures stay hidden from everyone else", () => {
    expect(getHelpArticle(asRoles(), "payroll", "prepare-a-pay-run")).toBeNull();
    expect(getHelpArticle(withPayroll("preparer"), "payroll", "prepare-a-pay-run")).not.toBeNull();
    expect(searchHelp(asRoles(), "Preparer").some((a) => a.slug === "prepare-a-pay-run")).toBe(false);
    expect(searchHelp(withPayroll("preparer"), "Preparer").some((a) => a.slug === "prepare-a-pay-run")).toBe(true);
    expect(mayOpenHelpFile(asRoles(), "assets", "prepare-a-pay-run/10-payment.png")).toBe(false);
    expect(mayOpenHelpFile(withPayroll("approver"), "assets", "prepare-a-pay-run/10-payment.png")).toBe(true);
    expect(mayOpenHelpFile(asRoles(), "assets", "read-your-payslip/01.png")).toBe(true);
  });
});

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
