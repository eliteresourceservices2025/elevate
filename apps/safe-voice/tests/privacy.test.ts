import fs from "node:fs";
import path from "node:path";
/* eslint-disable security/detect-non-literal-fs-filename -- reads this app's own source files */
import { describe, expect, it } from "vitest";

// Source-level guarantees for the anonymity promises: the app never reads or sets a cookie, never touches browser storage, never
// reads the user agent or referrer, only reads the few request headers it needs, and never logs request data.

const root = path.resolve(import.meta.dirname, "../src");
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [p] : [];
  });
const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const sources = files(root).map((f) => ({ rel: path.relative(root, f).split(path.sep).join("/"), text: withoutComments(fs.readFileSync(f, "utf8")) }));
// proxy.ts is the one place the words appear: it DELETES those headers from every request before any route runs.
const nonProxy = sources.filter((s) => s.rel !== "proxy.ts");

describe("Safe Voice source", () => {
  it("finds the app's files", () => expect(sources.length).toBeGreaterThan(10));

  it("never reads or sets cookies, and never uses browser storage", () => {
    for (const { rel, text } of nonProxy) {
      expect({ rel, hit: /\bcookies\s*\(|next\/headers|document\.cookie|set-cookie|localStorage|sessionStorage|indexedDB|\.cookies\b/i.test(text) }).toEqual({ rel, hit: false });
    }
  });

  it("proxy.ts removes cookies, authorization, user agent and referrer from every request", () => {
    const proxy = sources.find((s) => s.rel === "proxy.ts")!.text;
    for (const name of ["cookie", "authorization", "user-agent", "referer"]) expect(proxy).toContain(`"${name}"`);
    expect(proxy).toContain("headers.delete");
  });

  it("reads only the request headers it needs (address for the hashed limiter key, content length)", () => {
    const allowed = new Set(["x-forwarded-for", "x-real-ip", "content-length"]);
    for (const { rel, text } of nonProxy) {
      for (const m of text.matchAll(/headers\.get\(\s*["']([^"']+)["']/gi)) expect({ rel, header: m[1].toLowerCase() }).toEqual({ rel, header: [...allowed].find((a) => a === m[1].toLowerCase()) ?? "NOT ALLOWED" });
    }
  });

  it("never stores the address: it appears only in the limiter key helpers", () => {
    for (const { rel, text } of nonProxy) {
      if (rel === "lib/rate-limit.ts") continue;
      expect({ rel, hit: /x-forwarded-for|x-real-ip/i.test(text) }).toEqual({ rel, hit: false });
    }
  });

  it("never logs anything but an error class name", () => {
    for (const { rel, text } of nonProxy) {
      expect({ rel, hit: /console\.(log|info|debug|warn)\b/.test(text) }).toEqual({ rel, hit: false });
      for (const m of text.matchAll(/console\.error\(([^\n]*)\)/g)) expect(m[1]).toMatch(/^"[^"]*"(, error instanceof Error \? error\.name : "unknown error")?;?$|^"[^"]*"$/);
    }
  });

  it("makes no third-party requests from the browser", () => {
    for (const { rel, text } of sources) expect({ rel, hit: /https?:\/\/(?!localhost)/.test(text) }).toEqual({ rel, hit: false });
  });

  it("the database schema columns it writes hold no identifying fields", () => {
    const service = sources.find((s) => s.rel === "lib/service.ts")!.text;
    // eslint-disable-next-line security/detect-non-literal-regexp -- fixed words in a source-scanning test
    for (const word of ["ip", "user_agent", "email", "user_id", "file_name", "created_at"]) expect(new RegExp(`\\b${word}\\b`).test(service)).toBe(false);
  });
});
