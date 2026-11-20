import { describe, expect, it } from "vitest";
import { compareVersions, detectPlatform, formatBytes, isNewer, normalizeNotes, parseVersion, pickUpdate, platformsFor } from "./releases-logic";

describe("parseVersion and compareVersions", () => {
  it("reads MAJOR.MINOR.PATCH only", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    for (const bad of ["1.2", "1.2.3-beta", "01.2.3", "", "0.0.0-sim", "a.b.c", "1.2.3.4", "1.2.1000000"]) expect(parseVersion(bad)).toBeNull();
  });
  it("compares numbers, not text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
  it("sorts a version it cannot read lowest", () => {
    expect(compareVersions("junk", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "junk")).toBeGreaterThan(0);
    expect(isNewer("1.0.0", "0.0.0-sim")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
  });
});

describe("normalizeNotes", () => {
  it("trims, drops blank lines and keeps the three groups", () => {
    const r = normalizeNotes({ added: "  New page \n\n", improved: "", fixed: "Fixed a thing\r\nAnother fix" });
    expect(r).toEqual({ ok: true, notes: { added: ["New page"], improved: [], fixed: ["Fixed a thing", "Another fix"] } });
  });
  it("refuses an empty form, too many lines and a long line", () => {
    expect(normalizeNotes({ added: "", improved: " ", fixed: "\n" }).ok).toBe(false);
    expect(normalizeNotes({ added: Array.from({ length: 13 }, (_, i) => `Line ${i}`).join("\n"), improved: "", fixed: "" }).ok).toBe(false);
    expect(normalizeNotes({ added: "x".repeat(201), improved: "", fixed: "" }).ok).toBe(false);
    expect(normalizeNotes({ added: "x".repeat(200), improved: "", fixed: "" }).ok).toBe(true);
  });
});

describe("detectPlatform and platformsFor", () => {
  it("tells computers from phones, tablets and Linux", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15")).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36")).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")).toBe("other");
    expect(detectPlatform(null)).toBe("other");
  });
  it("maps an OS to its platform builds", () => {
    expect(platformsFor("windows")).toEqual(["windows-x86_64"]);
    expect(platformsFor("mac")).toEqual(["darwin-aarch64", "darwin-x86_64"]);
  });
});

describe("formatBytes", () => {
  it("is short and human", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(8_800_000)).toBe("8.4 MB");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("pickUpdate", () => {
  const rel = (version: string, status: "published" | "withdrawn" = "published", platforms: ("windows-x86_64" | "darwin-aarch64")[] = ["windows-x86_64"]) => ({ version, status, platforms });
  const published = [rel("1.1.0"), rel("1.2.0"), rel("1.3.0", "withdrawn")];
  it("offers the newest published version that is newer than the current one", () => {
    expect(pickUpdate({ platform: "windows-x86_64", currentVersion: "1.0.0", published })).toBe("1.2.0");
  });
  it("offers nothing when the current version is the newest (a withdrawn newer one does not count)", () => {
    expect(pickUpdate({ platform: "windows-x86_64", currentVersion: "1.2.0", published })).toBeNull();
    expect(pickUpdate({ platform: "windows-x86_64", currentVersion: "9.0.0", published })).toBeNull();
  });
  it("offers nothing when the platform has no build", () => {
    expect(pickUpdate({ platform: "darwin-aarch64", currentVersion: "1.0.0", published })).toBeNull();
  });
  it("treats a missing or unreadable current version as older than everything", () => {
    expect(pickUpdate({ platform: "windows-x86_64", currentVersion: null, published })).toBe("1.2.0");
    expect(pickUpdate({ platform: "windows-x86_64", currentVersion: "0.0.0-sim", published })).toBe("1.2.0");
  });
});
