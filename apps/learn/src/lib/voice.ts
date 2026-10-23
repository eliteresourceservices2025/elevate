import { createHash } from "node:crypto";
import index from "../content/voice-index.json";

// Read-aloud audio for the mock call and the exam. Each clip is one sentence of text, spoken ahead of time (tools/recap-video, see
// docs/learn/14-mock-call.md) and stored in media/voice. A clip is found by a hash of its exact text, so the file name says nothing
// about the answer, and a clip whose text the person has not been shown cannot be guessed (a caller's reply is only shown after the
// person has answered the step). The route that serves the files needs a signed-in person (src/lib/recap-media.ts).

const CLIPS = new Set(index as string[]);
export const LETTERS = ["a", "b", "c", "d", "e", "f"];

/** The clip name for a piece of text. The speaking script (tools/recap-video/customer-service/make-voice.cjs) computes the same. */
export const voiceKey = (text: string): string => "v-" + createHash("sha1").update(text.normalize("NFC").trim()).digest("hex").slice(0, 24);

/** The address of the clip for this exact text, or null when none was made (the page then falls back to the browser's own speech). */
export function voiceUrl(text: string): string | null {
  const key = voiceKey(text);
  return CLIPS.has(key) ? `/api/voice/${key}.m4a` : null;
}

/** The clip that says "Option A", "Option B" and so on, shared by every question. */
export function letterUrl(position: number): string | null {
  const key = `letter-${LETTERS[position] ?? "x"}`;
  return CLIPS.has(key) ? `/api/voice/${key}.m4a` : null;
}
