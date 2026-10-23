// Lists every clip the read-aloud buttons need (the Customer Service mock call and exam), with who speaks and in what tone, as
// tools/recap-video/out/voice/manifest.json. The speaking script (tools/recap-video/customer-service/make-voice.cjs) turns each entry into an
// audio file in apps/learn/media/voice and records it in apps/learn/src/content/voice-index.json.
//   pnpm exec tsx scripts/learn-voice-texts.mts
// Clips are named by a hash of their exact text (apps/learn/src/lib/voice.ts), so changing a line in the course means making its clip again.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COURSES } from "../../learn/src/content";
import { LETTERS, voiceKey } from "../../learn/src/lib/voice";

const course = COURSES["customer-service"];

type Clip = { key: string; kind: "caller" | "reply" | "exam" | "letter"; text: string; speaker: string; tone: string };
const clips = new Map<string, Clip>();
const add = (c: Clip) => {
  if (!clips.has(c.key)) clips.set(c.key, c);
};

// Who each caller is (invented people), so the same person sounds the same all through a call.
const SPEAKER: Record<string, string> = {
  missed_update: "maria",
  third_call: "daniel",
  supervisor_trap: "alex",
  results_worry: "linda",
  urgent_symptom: "sam",
};

// How each caller line is said. Tone is words a person would use to direct an actor.
const LINE_TONE: Record<string, Record<string, string>> = {
  missed_update: { s1: "upset and disappointed", s2: "frustrated and a little impatient", s3: "calm but tired, asking plainly", s4: "anxious, wanting reassurance" },
  third_call: { s1: "angry, raising their voice", s2: "irritated and worn out", s3: "demanding and impatient", s4: "angry and curt" },
  supervisor_trap: { s1: "impatient and pushy", s2: "casual and dismissive", s3: "annoyed, raising their voice a little", s4: "irritated and firm" },
  results_worry: { s1: "anxious and worried, voice unsteady", s2: "tense but polite", s3: "pleading and scared", s4: "tired, quietly hopeful" },
  urgent_symptom: { s1: "worried but downplaying it", s2: "uneasy and uncertain", s3: "scared, voice shaking", s4: "calm" },
};

// How the caller answers back, from how the reply moved the mood: the better the reply, the calmer the caller.
function replyTone(mood: number): string {
  if (mood >= 15) return "relieved and calmer";
  if (mood >= 5) return "calmer, a little reassured";
  if (mood >= -4) return "flat and unconvinced";
  if (mood >= -14) return "irritated and impatient";
  return "angry and sharp, raising their voice";
}

for (const call of course.calls ?? []) {
  const who = SPEAKER[call.key];
  if (!who) throw new Error(`No speaker for call ${call.key}`);
  for (const step of call.steps) {
    if (step.kind !== "caller") continue; // a note step has no caller
    const line = step.caller;
    // a stage direction such as "(The caller hangs up ...)" is not spoken
    if (!line.trim().startsWith("(")) {
      const tone = LINE_TONE[call.key]?.[step.id];
      if (!tone) throw new Error(`No tone for ${call.key}/${step.id}`);
      add({ key: voiceKey(line), kind: "caller", text: line, speaker: who, tone });
    }
    for (const c of step.choices) add({ key: voiceKey(c.reply), kind: "reply", text: c.reply, speaker: who, tone: replyTone(c.mood) });
  }
}

// The exam is read by one calm voice: each stem, each choice on its own (choices are shown in a different order each try), and "Option A".
for (const q of course.questions) {
  add({ key: voiceKey(q.stem), kind: "exam", text: q.stem, speaker: "reader", tone: "calm and clear" });
  for (const o of q.options) add({ key: voiceKey(o.text), kind: "exam", text: o.text, speaker: "reader", tone: "calm and clear" });
}
LETTERS.slice(0, 6).forEach((l) => add({ key: `letter-${l}`, kind: "letter", text: `Option ${l.toUpperCase()}.`, speaker: "reader", tone: "calm and clear" }));

const out = resolve(import.meta.dirname, "../../../tools/recap-video/out/voice");
mkdirSync(out, { recursive: true });
const list = [...clips.values()];
writeFileSync(resolve(out, "manifest.json"), JSON.stringify(list, null, 1));
const by = (k: Clip["kind"]) => list.filter((c) => c.kind === k).length;
console.log(`${list.length} clips: ${by("caller")} caller lines, ${by("reply")} replies, ${by("exam")} exam, ${by("letter")} letters`);
