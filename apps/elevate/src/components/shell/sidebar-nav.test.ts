import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(__dirname, "sidebar-nav.tsx"), "utf8");

describe("SidebarNav prefetching", () => {
  it("does not prefetch authenticated destinations shown in the sidebar", () => {
    expect(source).toMatch(/<Link\s+href=\{href\}[\s\S]*?prefetch=\{false\}[\s\S]*?onClick=\{onNavigate\}/);
    expect(source).toMatch(/<Link href="\/whats-new" prefetch=\{false\} onClick=\{onNavigate\}/);
  });
});
