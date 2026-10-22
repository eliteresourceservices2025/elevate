import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_CATEGORIES } from "./categories";
import { parseArticleSource } from "./frontmatter";

// The narrated videos are made by tools/recap-video/howto from a storyboard. This keeps the storyboard, the guides that show the videos and the
// saved picture positions (content/help/assets/_boxes.json) from drifting apart.

const ROOT = path.join(process.cwd(), "content", "help");
const STORYBOARDS: { id: string; steps: { image: string; focus: string | null; caption: string; say: string }[] }[] = createRequire(import.meta.url)(
  path.join(process.cwd(), "..", "..", "tools", "recap-video", "howto", "storyboards.cjs"),
);
const BOXES: Record<string, Record<string, { w: number; h: number }>> = JSON.parse(readFileSync(path.join(ROOT, "assets", "_boxes.json"), "utf8"));

const guideVideos = new Map<string, string>(); // video id -> guide path
for (const c of HELP_CATEGORIES) {
  const dir = path.join(ROOT, c.slug);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const { meta } = parseArticleSource(readFileSync(path.join(dir, f), "utf8"));
    if (meta.video) guideVideos.set(meta.video, `${c.slug}/${f}`);
  }
}

describe("how-to video storyboards", () => {
  it("has a storyboard for every guide that shows a video, and the other way round", () => {
    expect(STORYBOARDS.map((s) => s.id).sort()).toEqual([...guideVideos.keys()].sort());
  });

  it("uses each id once", () => {
    const ids = STORYBOARDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(STORYBOARDS.map((s) => [s.id, s] as const))("%s: pictures and zoom targets exist, captions are plain", (_id, video) => {
    expect(video.steps.length).toBeGreaterThan(1);
    for (const [i, step] of video.steps.entries()) {
      expect(existsSync(path.join(ROOT, "assets", `${step.image}.png`)), `step ${i + 1}: no picture ${step.image}`).toBe(true);
      if (step.focus) {
        const box = BOXES[step.image]?.[step.focus];
        expect(box, `step ${i + 1}: "${step.focus}" is not recorded for ${step.image}`).toBeTruthy();
        expect(box.w >= 4 && box.h >= 4, `step ${i + 1}: "${step.focus}" has no size`).toBe(true);
      }
      // Spaced letters ("C S V", "H R") are for the voice only; on screen they read as typos.
      expect(step.caption, `step ${i + 1}: caption`).not.toMatch(/\b[A-Z] [A-Z]\b/);
      expect(step.caption.length).toBeLessThanOrEqual(60);
    }
  });
});
