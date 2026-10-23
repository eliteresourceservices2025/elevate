// Subtitles for the HIPAA and Cybersecurity videos, built from the same words and timings the voice-over uses, so a caption can never
// drift from the narration. Saved as WebVTT next to the video and offered by the player as an option (a CC button): they are NOT burned
// into the picture. Same chunking as customer-service/captions.cjs. Keep AUDIO_DELAY in step with the <Sequence from={9}> in src/Cs.jsx.
const { beatsOf } = require("../customer-service/beats.cjs");

const FPS = 30;
const AUDIO_DELAY = 9;
const MAX_CHARS = 84;

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
  place(list, v.introSay, AUDIO_DELAY, Math.round(nar.introSeconds * FPS));
  let at = Math.round(v.intro * FPS);
  v.scenes.forEach((s, i) => {
    const ns = nar.scenes[i];
    const roles = s.roles || { rep: "You", family: "Caller" };
    beatsOf(s).forEach((b, k) => {
      const who = s.kind === "dialogue" ? (b.voice === "rep" ? roles.rep : b.voice === "family" ? roles.family : "") : "";
      place(list, (who ? who + ": " : "") + b.say, at + AUDIO_DELAY + Math.round(ns.cues[k] * FPS), Math.round(ns.durs[k] * FPS));
    });
    at += Math.round(v.scenesSeconds[i] * FPS);
  });
  v.outroItems.forEach((o, k) => place(list, o.say, at + AUDIO_DELAY + Math.round(nar.outroCues[k] * FPS), Math.round((nar.outroDurs?.[k] ?? 0.9) * FPS)));
  return list;
}

const stamp = (frame) => {
  const ms = Math.round((frame / FPS) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};
const toVtt = (list) => "WEBVTT\n\n" + list.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}\n`).join("\n");

module.exports = { captionsFor, toVtt };
