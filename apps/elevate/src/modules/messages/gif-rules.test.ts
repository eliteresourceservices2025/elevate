import { describe, expect, it } from "vitest";
import { chooseGifProvider, isAllowedGifUrl, parseGifResults } from "./gif-rules";

describe("isAllowedGifUrl", () => {
  it("accepts https KLIPY hosts and subdomains only", () => {
    expect(isAllowedGifUrl("https://static.klipy.com/a/b.gif")).toBe(true);
    // Exact media hosts only: not the bare domain, not other subdomains, not klipy.co.
    expect(isAllowedGifUrl("https://klipy.com/x.webp")).toBe(false);
    expect(isAllowedGifUrl("https://api.klipy.com/x.gif")).toBe(false);
    expect(isAllowedGifUrl("https://klipy.co/x.gif")).toBe(false);
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

describe("GIPHY", () => {
  const giphyItem = (over: Record<string, unknown> = {}) => ({
    id: "abc123",
    title: "happy dance GIF",
    images: {
      fixed_width: { url: "https://media2.giphy.com/media/abc123/200w.gif", width: "200", height: "112" },
      fixed_width_small: { url: "https://media2.giphy.com/media/abc123/100w.gif", width: "100", height: "56" },
      original: { url: "https://media2.giphy.com/media/abc123/giphy.gif", width: "480", height: "270" },
    },
    ...over,
  });

  it("allows GIPHY media hosts and still refuses look-alikes", () => {
    expect(isAllowedGifUrl("https://media0.giphy.com/media/x/200w.gif")).toBe(true);
    expect(isAllowedGifUrl("https://i.giphy.com/x.gif")).toBe(true);
    expect(isAllowedGifUrl("https://giphy.com.evil.example/x.gif")).toBe(false);
    expect(isAllowedGifUrl("https://support.giphy.com/x.gif")).toBe(false);
    expect(isAllowedGifUrl("https://media5.giphy.com/x.gif")).toBe(false);
    expect(isAllowedGifUrl("https://giphy.com/x.gif")).toBe(false);
    expect(isAllowedGifUrl("https://notgiphy.com/x.gif")).toBe(false);
  });

  it("reads fixed_width to send and fixed_width_small to preview", () => {
    const [g] = parseGifResults({ data: [giphyItem()], meta: { status: 200 } });
    expect(g).toEqual({ id: "abc123", title: "happy dance GIF", url: "https://media2.giphy.com/media/abc123/200w.gif", previewUrl: "https://media2.giphy.com/media/abc123/100w.gif", width: 200, height: 112 });
  });

  it("drops items with disallowed hosts or no images, and survives junk", () => {
    const evil = giphyItem({ images: { fixed_width: { url: "https://evil.example/x.gif" }, fixed_width_small: { url: "https://evil.example/y.gif" } } });
    expect(parseGifResults({ data: [evil, giphyItem({ id: "" }), giphyItem({ images: null }), null, 4] })).toEqual([]);
  });
});

describe("choosing a provider", () => {
  const keys = { KLIPY_API_KEY: "k", GIPHY_API_KEY: "g" };
  it("follows GIF_PROVIDER when that provider has a key", () => {
    expect(chooseGifProvider({ ...keys, GIF_PROVIDER: "giphy" })).toBe("giphy");
    expect(chooseGifProvider({ ...keys, GIF_PROVIDER: "KLIPY" })).toBe("klipy");
  });
  it("falls back to the first provider with a key, and is off with none or when set to off", () => {
    expect(chooseGifProvider({ GIPHY_API_KEY: "g", GIF_PROVIDER: "klipy" })).toBe("giphy");
    expect(chooseGifProvider(keys)).toBe("klipy");
    expect(chooseGifProvider({})).toBeNull();
    expect(chooseGifProvider({ ...keys, GIF_PROVIDER: "off" })).toBeNull();
  });
});
