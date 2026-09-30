import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

describe("safeHref", () => {
  it("allows https, http, mailto and in-app paths", () => {
    expect(safeHref("https://example.com/a")?.external).toBe(true);
    expect(safeHref("http://example.com")?.external).toBe(true);
    expect(safeHref("mailto:hr@example.com")?.external).toBe(true);
    expect(safeHref("/documents?tab=company")).toEqual({ href: "/documents?tab=company", external: false });
  });

  it("refuses script-like and off-site tricks", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "//evil.example", "/\\evil.example", "java\nscript:alert(1)", "", "file:///etc/passwd", "ftp://example.com", "not a url"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe("parseInline", () => {
  it("turns markup into nodes", () => {
    expect(parseInline("a **bold** and *soft* and `code`")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", children: [{ type: "text", text: "bold" }] },
      { type: "text", text: " and " },
      { type: "em", children: [{ type: "text", text: "soft" }] },
      { type: "text", text: " and " },
      { type: "code", text: "code" },
    ]);
  });

  it("keeps HTML as plain text", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([{ type: "text", text: "<script>alert(1)</script>" }]);
    expect(parseInline('<img src=x onerror="alert(1)">')).toEqual([{ type: "text", text: '<img src=x onerror="alert(1)">' }]);
  });

  it("drops the link but keeps the words when the target is unsafe", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ type: "text", text: "click" }]);
  });

  it("adds rel and target to outside links only", () => {
    const [ext] = parseInline("[site](https://example.com)");
    expect(ext).toMatchObject({ type: "link", external: true });
    const [inner] = parseInline("[docs](/documents)");
    expect(inner).toMatchObject({ type: "link", external: false, href: "/documents" });
  });

  it("does not support images", () => {
    const nodes = parseInline("![x](https://example.com/a.png)");
    expect(nodes.some((n) => n.type === "link")).toBe(true); // the "[x](...)" part is an ordinary link, never an <img>
    expect(JSON.stringify(nodes)).not.toContain('"img"');
  });
});

describe("parseMarkdown", () => {
  it("builds headings, lists, quotes and paragraphs", () => {
    const blocks = parseMarkdown("# Title\n\nFirst line\nsecond line\n\n- one\n- two\n\n1. a\n2. b\n\n> note");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "quote"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(blocks[1]).toMatchObject({ type: "paragraph", children: [{ type: "text", text: "First line second line" }] });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true });
  });

  it("caps very long input", () => {
    const blocks = parseMarkdown("a".repeat(50_000));
    const first = blocks[0];
    expect(first.type === "paragraph" && first.children[0].type === "text" && first.children[0].text.length).toBe(10_000);
  });
});
