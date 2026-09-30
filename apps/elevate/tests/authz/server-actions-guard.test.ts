import fs from "node:fs";
import path from "node:path";
/* eslint-disable security/detect-non-literal-fs-filename -- reads this repo's own source files */
import { describe, expect, it } from "vitest";

// Every exported function in a "use server" file is a public endpoint the browser can call, with
// arguments it controls. So each one must start by asking who is calling (requireUser), and helpers
// that take the acting user as an argument must never be exported from such a file.

const root = path.resolve(import.meta.dirname, "../../src");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

const serverActionFiles = files(root).filter((f) => /^\s*["']use server["']/m.test(fs.readFileSync(f, "utf8").slice(0, 200)));

// Sign-in flows are public by nature: they run before anyone is signed in.
const PUBLIC_BY_DESIGN = new Set(["modules/auth/actions.ts"]);

describe("server actions", () => {
  it("finds the action files", () => {
    expect(serverActionFiles.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of serverActionFiles) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");

    it(`${rel}: exports only async functions (and types)`, () => {
      const bad = [...source.matchAll(/^export\s+(?!async function|type |interface )(\w+)/gm)].map((m) => m[0]);
      expect(bad).toEqual([]);
    });

    if (PUBLIC_BY_DESIGN.has(rel)) continue;

    it(`${rel}: every exported action calls requireUser() first`, () => {
      const bodies = [...source.matchAll(/^export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)];
      expect(bodies.length).toBeGreaterThan(0);
      for (const [, name, body] of bodies) {
        const firstAwait = body.match(/await\s+(\w+)\(/)?.[1];
        expect({ name, firstAwait }).toEqual({ name, firstAwait: "requireUser" });
      }
    });
  }
});
