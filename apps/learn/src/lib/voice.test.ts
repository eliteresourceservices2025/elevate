import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COURSES } from "../content";
import index from "../content/voice-index.json";
import { LETTERS, letterUrl, voiceKey, voiceUrl } from "./voice";

// The read-aloud clips are made ahead of time from the exact course text (tools/recap-video/customer-service/make-voice.cjs). If a line in
// the course changes, its clip no longer matches and this fails, so nobody ships audio that says something different from the screen.

const course = COURSES["customer-service"];
const file = (key: string) => resolve(__dirname, "../../media/voice", `${key}.m4a`);

describe("the read-aloud clips", () => {
  it("name a clip by a hash of its text, so the name says nothing about the answer", () => {
    expect(voiceKey("Hello")).toMatch(/^v-[0-9a-f]{24}$/);
    expect(voiceKey("Hello")).toBe(voiceKey("  Hello "));
    expect(voiceKey("Hello")).not.toBe(voiceKey("Hello."));
  });

  it("have a file for every entry in the list, and nothing is served that is not listed", () => {
    for (const key of index as string[]) expect(existsSync(file(key)), key).toBe(true);
    expect(voiceUrl("A line that was never recorded")).toBeNull();
  });

  it("cover every caller line and reply of the graded mock call, and every exam question and choice", () => {
    for (const call of course.calls ?? []) {
      for (const step of call.steps) {
        if (step.kind !== "caller") continue;
        if (!step.caller.trim().startsWith("(")) expect(voiceUrl(step.caller), `${call.key}/${step.id} line`).not.toBeNull();
        for (const c of step.choices) expect(voiceUrl(c.reply), `${call.key}/${step.id}/${c.id} reply`).not.toBeNull();
      }
    }
    for (const q of course.questions) {
      expect(voiceUrl(q.stem), q.stem).not.toBeNull();
      for (const o of q.options) expect(voiceUrl(o.text), `${q.stem} / ${o.text}`).not.toBeNull();
    }
    for (let i = 0; i < LETTERS.length; i++) expect(letterUrl(i), `letter ${i}`).not.toBeNull();
  });

  it("are served from the signed-in route, never a public file", () => {
    const url = voiceUrl(course.questions[0].stem)!;
    expect(url).toMatch(/^\/api\/voice\/v-[0-9a-f]{24}\.m4a$/);
    expect(existsSync(resolve(__dirname, "../../public/voice"))).toBe(false);
  });
});
