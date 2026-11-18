import { describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES, EMOJI_SET, QUICK_EMOJI, isAllowedEmoji, readRecentEmoji, rememberEmoji, searchEmoji } from "./emoji";

const fakeStorage = (initial?: string) => {
  let value: string | null = initial ?? null;
  return { getItem: () => value, setItem: (_k: string, v: string) => void (value = v) };
};

describe("the emoji catalog", () => {
  it("has the sweet potato, found by its English and Filipino names", () => {
    expect(isAllowedEmoji("🍠")).toBe(true);
    for (const q of ["sweet potato", "sweet", "kamote", "camote", "yam"]) expect(searchEmoji(q)).toContain("🍠");
  });

  it("has every category filled, no emoji twice in the list, and the quick row inside it", () => {
    for (const c of EMOJI_CATEGORIES) expect(c.emojis.length, c.id).toBeGreaterThan(10);
    expect(new Set(EMOJI_SET).size).toBe(EMOJI_SET.length);
    expect(EMOJI_SET.length).toBeGreaterThan(300);
    for (const e of QUICK_EMOJI) expect(isAllowedEmoji(e), e).toBe(true);
  });

  it("still allows every emoji the first picker offered, so older reactions stay valid", () => {
    for (const e of ["👍", "❤️", "😂", "🎉", "💜", "🫠", "🌍", "🛠️", "✔️"]) expect(isAllowedEmoji(e), e).toBe(true);
  });

  it("refuses anything that is not in the catalog", () => {
    for (const bad of ["", "x", "<b>", "👍👍", "🏳️‍🌈\u0000"]) expect(isAllowedEmoji(bad), bad).toBe(false);
  });

  it("searches by every word, and finds nothing for nonsense or an empty search", () => {
    expect(searchEmoji("pizza")).toContain("🍕");
    expect(searchEmoji("coffee cup")).toContain("☕");
    expect(searchEmoji("zzzz")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });
});

describe("recently used emoji", () => {
  it("remembers the newest first, once each, up to 16", () => {
    const storage = fakeStorage();
    expect(readRecentEmoji(storage)).toEqual([]);
    rememberEmoji("🍠", storage);
    rememberEmoji("👍", storage);
    expect(rememberEmoji("🍠", storage)).toEqual(["🍠", "👍"]);
    for (const e of EMOJI_CATEGORIES[0].emojis.slice(0, 20)) rememberEmoji(e, storage);
    expect(readRecentEmoji(storage)).toHaveLength(16);
  });

  it("ignores unknown or broken stored data and works without storage", () => {
    expect(readRecentEmoji(fakeStorage("not json"))).toEqual([]);
    expect(readRecentEmoji(fakeStorage(JSON.stringify(["🍠", "<script>", 5, "👍"])))).toEqual(["🍠", "👍"]);
    expect(readRecentEmoji(undefined)).toEqual([]);
    expect(rememberEmoji("🍠", undefined)).toEqual(["🍠"]);
  });
});
