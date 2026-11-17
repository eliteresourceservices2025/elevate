import { describe, expect, it } from "vitest";
import { isAllowedGifUrl, parseGifResults } from "./gif-rules";

describe("isAllowedGifUrl", () => {
  it("accepts https KLIPY hosts and subdomains only", () => {
    expect(isAllowedGifUrl("https://static.klipy.com/a/b.gif")).toBe(true);
    expect(isAllowedGifUrl("https://klipy.com/x.webp")).toBe(true);
  });
  it("refuses everything else", () => {
    for (const bad of [
      "http://static.klipy.com/a.gif",
      "https://evilklipy.com/a.gif",
      "https://klipy.com.evil.example/a.gif",
      "https://user:pw@static.klipy.com/a.gif",
      "https://static.klipy.com:8443/a.gif",
      "https://127.0.0.1/a.gif",
      "javascript:alert(1)",
      "//static.klipy.com/a.gif",
      "not a url",
      `https://static.klipy.com/${"a".repeat(700)}.gif`,
      42,
      null,
    ]) expect(isAllowedGifUrl(bad)).toBe(false);
  });
});

describe("parseGifResults", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: 7,
    title: "Happy dance",
    files: {
      hd: { gif: { url: "https://static.klipy.com/hd.gif", width: 480, height: 270 }, webp: { url: "https://static.klipy.com/hd.webp" } },
      md: { gif: { url: "https://static.klipy.com/md.gif", width: 320, height: 180 } },
      xs: { gif: { url: "https://static.klipy.com/xs.gif", width: 90, height: 50 } },
    },
    ...over,
  });

  it("reads the nested shape, preferring a medium file to send and a small one to preview", () => {
    const [g] = parseGifResults({ result: true, data: { data: [item()], current_page: 1 } });
    expect(g).toMatchObject({ id: "7", title: "Happy dance", url: "https://static.klipy.com/md.gif", previewUrl: "https://static.klipy.com/xs.gif", width: 320, height: 180 });
  });

  it("is tolerant of a flat list under data or results", () => {
    expect(parseGifResults({ data: [item()] })).toHaveLength(1);
    expect(parseGifResults({ results: [item()] })).toHaveLength(1);
  });

  it("drops anything that is not an allowed https KLIPY image, and survives junk", () => {
    const evil = item({ files: { md: { gif: { url: "https://evil.example/x.gif" } }, sm: { gif: { url: "http://static.klipy.com/x.gif" } } } });
    expect(parseGifResults({ data: [evil, item({ id: "" })] })).toEqual([]);
    for (const junk of [null, undefined, 5, "x", {}, { data: "nope" }, { data: { data: [null, 3, "a"] } }]) expect(parseGifResults(junk)).toEqual([]);
  });
});
