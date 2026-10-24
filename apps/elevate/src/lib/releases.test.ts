import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "./releases";

const parts = (v: string) => v.split(".").map(Number);

describe("releases", () => {
  it("shows the version in package.json", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("are valid, unique and newest first", () => {
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title.length).toBeGreaterThan(2);
      expect(r.highlights.length).toBeGreaterThan(0);
    }
    expect(new Set(RELEASES.map((r) => r.version)).size).toBe(RELEASES.length);
    for (let i = 1; i < RELEASES.length; i++) {
      const [a, b] = [parts(RELEASES[i - 1].version), parts(RELEASES[i].version)];
      const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(newer).toBeGreaterThan(0);
      expect(RELEASES[i - 1].date >= RELEASES[i].date).toBe(true);
    }
  });
});
