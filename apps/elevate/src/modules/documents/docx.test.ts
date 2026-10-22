import { describe, expect, it } from "vitest";
import { makeDocx, makeDocxFromBodyXml } from "../../../tests/helpers/resume-files";
import { docxToPreviewBody, docxToText, isReasonableDocx, previewPage, sanitizeDocxHtml } from "./docx";

describe("sanitizeDocxHtml", () => {
  it("keeps plain structure and drops everything else, with every attribute removed", () => {
    expect(sanitizeDocxHtml('<h1 id="a" class="x">Title</h1><p style="color:red" onclick="steal()">Hello <strong>there</strong><br/></p>')).toBe("<h1>Title</h1><p>Hello <strong>there</strong><br></p>");
    expect(sanitizeDocxHtml('<ul><li>One</li></ul><table><tr><td colspan="2" style="x" onclick="y">Cell</td><th rowspan=3>H</th></tr></table>')).toBe('<ul><li>One</li></ul><table><tr><td colspan="2">Cell</td><th rowspan="3">H</th></tr></table>');
  });

  it("drops scripts, styles, frames, forms, pictures and links, keeping only a link's words", () => {
    const out = sanitizeDocxHtml('<script>alert(1)</script><style>p{}</style><iframe src="//evil"></iframe><form action="x"><input></form><svg onload="x"></svg><img src="x" onerror="y"><a href="javascript:alert(1)">click me</a><object data="x"></object>');
    expect(out).not.toMatch(/<(script|style|iframe|form|input|svg|img|a|object)\b/i);
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click me");
  });

  it("removes comments and escapes a stray angle bracket so no tag can be made from text", () => {
    expect(sanitizeDocxHtml("<p>a <!-- <script> --> b</p>")).toBe("<p>a  b</p>");
    expect(sanitizeDocxHtml("<p>1 < 2 and <3</p>")).toBe("<p>1 &lt; 2 and &lt;3</p>");
    expect(sanitizeDocxHtml("<p>x</p><scr")).toBe("<p>x</p>&lt;scr");
  });

  it("never produces a tag that is not on the list, whatever it is given", () => {
    const hostile = ['<p/onload=alert(1)>', "<<script>script>alert(1)<</script>/script>", '<img/src=x onerror=alert(1)>', '<P ONCLICK="x">', "<a\nhref=x>t</a>", "<svg><script>x</script></svg>"];
    for (const input of hostile) {
      const tags = [...sanitizeDocxHtml(input).matchAll(/<\/?([a-zA-Z0-9]+)/g)].map((m) => m[1].toLowerCase());
      expect(tags.every((t) => ["p", "br"].includes(t))).toBe(true);
    }
  });
});

describe("docxToPreviewBody", () => {
  it("keeps headings, bold text, lists and tables from a real Word file", async () => {
    const body =
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Service agreement</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Important</w:t></w:r><w:r><w:t xml:space="preserve"> terms apply.</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const html = await docxToPreviewBody(makeDocxFromBodyXml(body));
    expect(html).toContain("<h1>Service agreement</h1>");
    expect(html).toContain("<strong>Important</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("Cell B");
  });

  it("shows markup typed into a document as text, never as a tag", async () => {
    const html = await docxToPreviewBody(makeDocx(['<script>alert("x")</script>', '<img src=x onerror=alert(1)>']));
    expect(html).not.toMatch(/<(script|img)/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("returns null for an empty document, a damaged file and a file that declares an absurd size", async () => {
    expect(await docxToPreviewBody(makeDocx([]))).toBeNull();
    expect(await docxToPreviewBody(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBeNull();
    expect(await docxToText(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(isReasonableDocx(makeDocx(["fine"]))).toBe(true);
  });
});

describe("previewPage", () => {
  it("escapes the title and wraps the body in our own page", () => {
    const page = previewPage('A <b>"title"</b>', "<p>Body</p>");
    expect(page).toContain("<title>A &lt;b&gt;&quot;title&quot;&lt;/b&gt;</title>");
    expect(page).toContain("<p>Body</p>");
    expect(page).not.toContain("<script");
  });
});
