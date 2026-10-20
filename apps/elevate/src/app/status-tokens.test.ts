import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  return css.slice(start, css.indexOf("\n}", start));
}
const token = (scope: string, name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(scope)?.[1] ?? "";

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("status colour tokens", () => {
  for (const [theme, scope, page] of [["light", block(":root"), "#ffffff"], ["dark", block(".dark"), "#1d1728"]] as const) {
    for (const name of ["success", "warning", "info"]) {
      it(`${name} reads at 4.5:1 on its surface and on a card (${theme})`, () => {
        const text = token(scope, name);
        expect(text).not.toBe("");
        expect(contrast(text, token(scope, `${name}-surface`))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text, page)).toBeGreaterThanOrEqual(4.5);
      });
      it(`${name} solid fill keeps its label readable (${theme})`, () => {
        expect(contrast(token(scope, name), token(scope, `${name}-foreground`))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
