import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COURSES } from "./index";
import { INTRO_SECONDS, OUTRO_SECONDS, RECAPS, findRecap, recapFile, recapSeconds, recapTranscript, sceneLines } from "./recaps";
import durations from "./recap-durations.json";

// The optional recap videos: every module has one, it is the length promised (60 to 90 seconds), its words pass the same text
// checks as the lessons, and the rendered file is in place. Reading the module remains the required part.

describe("recap videos", () => {
  it("has exactly one recap for every module of both courses, and none for a module that does not exist", () => {
    for (const course of Object.values(COURSES)) {
      for (const m of course.content.modules) {
        const found = RECAPS.filter((r) => r.course === (course.slug as string) && r.module === m.key);
        expect(found, `${course.slug}/${m.key}`).toHaveLength(1);
      }
    }
    for (const r of RECAPS) {
      const course = COURSES[r.course];
      expect(course, r.course).toBeDefined();
      expect(course.content.modules.some((m) => m.key === r.module), `${r.course}/${r.module}`).toBe(true);
    }
    expect(RECAPS).toHaveLength(Object.values(COURSES).reduce((n, c) => n + c.content.modules.length, 0));
  });

  it("runs 60 to 90 seconds as rendered (the voice sets the pace), with a readable number of scenes", () => {
    expect(Object.keys(durations).sort()).toEqual(RECAPS.map((r) => `${r.course}-${r.module}`).sort());
    for (const r of RECAPS) {
      const s = recapSeconds(r);
      expect(s, `${r.course}/${r.module}`).toBeGreaterThanOrEqual(60);
      expect(s, `${r.course}/${r.module}`).toBeLessThanOrEqual(90);
      expect(r.scenes.length, `${r.course}/${r.module}`).toBeGreaterThanOrEqual(4);
      expect(r.scenes.length, `${r.course}/${r.module}`).toBeLessThanOrEqual(8);
    }
    expect(INTRO_SECONDS + OUTRO_SECONDS).toBe(8);
  });

  it("keeps each scene short enough to read: at most 5 items, and short lines", () => {
    for (const r of RECAPS) {
      for (const s of r.scenes) {
        if ("items" in s) expect(s.items.length, `${r.module} ${s.kind}`).toBeLessThanOrEqual(5);
        if (s.kind === "compare") {
          expect(s.left.items.length).toBeLessThanOrEqual(4);
          expect(s.right.items.length).toBeLessThanOrEqual(4);
        }
        for (const line of sceneLines(s)) expect(line.length, `${r.module}: ${line}`).toBeLessThanOrEqual(140);
      }
    }
  });

  it("contains no markup and nothing that looks like a real identifier, address or link", () => {
    for (const r of RECAPS) {
      for (const t of recapTranscript(r)) {
        expect(t, t).not.toMatch(/[<>]/);
        expect(t, t).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
        expect(t, t).not.toMatch(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/);
        expect(t, t).not.toMatch(/https?:\/\//i);
        for (const hit of t.match(/[a-z0-9.-]+\.(com|org|net|io|ph|gov)\b/gi) ?? []) expect.fail(`real-looking address in recap: ${hit}`);
      }
    }
  });

  it("finds a recap by course and module, and builds its file path under the app's own origin", () => {
    const r = findRecap("hipaa", "associates");
    expect(r).not.toBeNull();
    expect(recapFile(r!)).toBe("/recaps/hipaa-associates.mp4");
    expect(findRecap("hipaa", "no-such-module")).toBeNull();
    expect(findRecap("someclient-requirements", "associates")).toBeNull();
  });

  it("has the rendered file in place for every recap, of a sensible size", () => {
    for (const r of RECAPS) {
      const file = resolve(__dirname, "../../public", recapFile(r).slice(1));
      expect(existsSync(file), `missing ${recapFile(r)} (render it: see docs/learn/13-recap-videos.md)`).toBe(true);
      const size = statSync(file).size;
      expect(size, recapFile(r)).toBeGreaterThan(20_000);
      expect(size, recapFile(r)).toBeLessThan(4_000_000);
    }
  });
});
