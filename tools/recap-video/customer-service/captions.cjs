// Builds the on-screen captions (subtitles) for a Customer Service video from the same words and timings the voice-over uses, so a
// caption can never drift from the narration. Used by render-cs.cjs and render-welcome.cjs; the result goes to src/Cs.jsx as
// video.captions = [{ from, to, text }] in frames (30 fps). Keep AUDIO_DELAY in step with the <Sequence from={9}> in Cs.jsx.
const { beatsOf } = require("./beats.cjs");

const FPS = 30;
const AUDIO_DELAY = 9;
const MAX_CHARS = 84; // one caption is at most about two lines at the size Cs.jsx uses
const OUTRO = ["Listen.", "Understand.", "Act.", "Follow through."];
const SPEAKER = { rep: "Representative: ", family: "Family member: " };

// splits long speech at sentence ends, then commas, so each caption is short enough to read; time is shared by length
function chunks(text) {
  if (text.length <= MAX_CHARS) return [text];
  const out = [];
  let cur = "";
  for (const part of text.match(/[^.!?]+[.!?]+["')]*\s*|[^.!?]+$/g) || [text]) {
    if (cur && (cur + part).length > MAX_CHARS) {
      out.push(cur.trim());
      cur = "";
    }
    cur += part;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap((c) => {
    if (c.length <= MAX_CHARS * 1.25) return [c];
    const words = c.split(" ");
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  });
}

function place(list, text, startFrame, durFrames) {
  const parts = chunks(text);
  const total = parts.reduce((n, p) => n + p.length, 0);
  let at = startFrame;
  parts.forEach((p, i) => {
    const len = i === parts.length - 1 ? startFrame + durFrames - at : Math.round((durFrames * p.length) / total);
    list.push({ from: at, to: at + len, text: p });
    at += len;
  });
}

function captionsFor(v) {
  const nar = v.narration;
  const list = [];
  const intro = Math.round(v.intro * FPS);
  place(list, v.introSay || `Customer Service Excellence. ${v.title}.`, AUDIO_DELAY, Math.round(nar.introSeconds * FPS));
  let at = intro;
  v.scenes.forEach((s, i) => {
    const ns = nar.scenes[i];
    beatsOf(s).forEach((b, k) => {
      place(list, (SPEAKER[b.voice] || "") + b.say, at + AUDIO_DELAY + Math.round(ns.cues[k] * FPS), Math.round(ns.durs[k] * FPS));
    });
    at += Math.round(v.scenesSeconds[i] * FPS);
  });
  (v.outroItems ? v.outroItems.map((i) => i.word + ".") : OUTRO).forEach((t, k) => place(list, t, at + AUDIO_DELAY + Math.round(nar.outroCues[k] * FPS), Math.round(0.9 * FPS)));
  return list;
}

const stamp = (frame) => {
  const ms = Math.round((frame / FPS) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};
const toVtt = (list) => "WEBVTT\n\n" + list.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}\n`).join("\n");

module.exports = { captionsFor, toVtt };
