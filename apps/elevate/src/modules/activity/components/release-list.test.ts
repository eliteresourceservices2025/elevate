import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReleaseList } from "./release-list";
import type { PublishedRelease } from "../releases-service";

const rel = (version: string, over: Partial<PublishedRelease> = {}): PublishedRelease => ({
  id: `id-${version}`,
  version,
  publishedAt: "2026-11-20T10:00:00.000Z",
  status: "published",
  minRequired: false,
  notes: { added: ["New page"], improved: [], fixed: ["A fix"] },
  builds: [],
  ...over,
});
const render = (releases: PublishedRelease[], filter: "all" | "required" = "all") => renderToStaticMarkup(createElement(ReleaseList, { releases, filter, zone: "America/Phoenix" }));

describe("ReleaseList", () => {
  it("escapes the notes", () => {
    const html = render([rel("1.0.0", { notes: { added: ["<b>bold</b>"], improved: [], fixed: [] } })]);
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
  it("shows only the groups that have lines", () => {
    const html = render([rel("1.0.0")]);
    expect(html).toContain("Added");
    expect(html).toContain("Fixed");
    expect(html).not.toContain("Improved");
  });
  it("marks a required release, and only a required one", () => {
    const html = render([rel("1.1.0", { minRequired: true }), rel("1.0.0")]);
    expect((html.match(/Required update/g) ?? []).length).toBe(1);
  });
  it("opens the newest release and folds the older ones", () => {
    const html = render([rel("1.2.0"), rel("1.1.0")]);
    expect((html.match(/<details[^>]*open/g) ?? []).length).toBe(1);
    expect((html.match(/<details/g) ?? []).length).toBe(2);
  });
  it("lists only required releases when asked, and says so when there are none", () => {
    const some = render([rel("1.2.0"), rel("1.1.0", { minRequired: true })], "required");
    expect(some).toContain("1.1.0");
    expect(some).not.toContain("1.2.0");
    expect(render([rel("1.2.0")], "required")).toContain("No required updates");
  });
  it("links the filter and says when nothing has been released", () => {
    expect(render([rel("1.0.0")])).toContain("/tracker/download?filter=required");
    expect(render([])).toContain("No releases yet");
  });
});
