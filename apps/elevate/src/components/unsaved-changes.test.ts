import { describe, expect, it } from "vitest";
import { leavesThePage } from "./unsaved-changes";

const here = { origin: "https://elevate.example.com", pathname: "/announcements/new", search: "" };
const plain = { meta: false, ctrl: false, shift: false, alt: false, button: 0 };
const link = (href: string, extra: Partial<{ target: string; download: boolean }> = {}) => ({ href, target: "", download: false, ...extra });

describe("leavesThePage", () => {
  it("returns the path of a link to another page of this site", () => {
    expect(leavesThePage(link("https://elevate.example.com/people?x=1#a"), here, plain)).toBe("/people?x=1#a");
    expect(leavesThePage(link("/people"), here, plain)).toBe("/people");
  });
  it("ignores the same page, other sites, new tabs, downloads and modified clicks", () => {
    expect(leavesThePage(link("https://elevate.example.com/announcements/new"), here, plain)).toBeNull();
    expect(leavesThePage(link("https://elevate.example.com/announcements/new#top"), here, plain)).toBeNull();
    expect(leavesThePage(link("https://other.example.org/x"), here, plain)).toBeNull();
    expect(leavesThePage(link("/people", { target: "_blank" }), here, plain)).toBeNull();
    expect(leavesThePage(link("/file.pdf", { download: true }), here, plain)).toBeNull();
    expect(leavesThePage(link("/people"), here, { ...plain, ctrl: true })).toBeNull();
    expect(leavesThePage(link("/people"), here, { ...plain, meta: true })).toBeNull();
    expect(leavesThePage(link("/people"), here, { ...plain, button: 1 })).toBeNull();
  });
  it("ignores an address it cannot read", () => {
    expect(leavesThePage(link("http://[bad"), here, plain)).toBeNull();
  });
});
