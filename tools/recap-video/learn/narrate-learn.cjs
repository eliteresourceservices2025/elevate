// Makes the voice-over for the HIPAA and Cybersecurity videos in the owner's cloned voice (VoiceStudio on port 3900, through
// customer-service/speak-vs.cjs) and the timing the renderer uses. The same method as customer-service/narrate-cs.cjs: every spoken
// piece (a "beat", see customer-service/beats.cjs) is its own WAV, the pieces of a scene are joined with short pauses, and the start
// time of each piece (the "cues") lets a picture appear exactly when its words start.
//   node learn/narrate-learn.cjs hipaa                       every HIPAA video
//   node learn/narrate-learn.cjs hipaa hipaa-state_laws      some
//   node learn/narrate-learn.cjs hipaa --speed 1.3
// Output: audio/learn/<video id>/{intro,s1..sN,outro}.wav, audio/learn/bgm.mp3, learn/video-data-<course>.json (storyboards plus
// timing), and for the app: apps/learn/src/content/recap-spoken.json (the words of every video, shown as "read the recap as text").
// Pieces are cached by speak-vs.cjs, so a repeated line is made once and an interrupted run carries on where it stopped.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { beatsOf } = require("../customer-service/beats.cjs");

const args = process.argv.slice(2);
const course = args[0];
const FILES = { hipaa: "storyboards-hipaa.cjs", cybersecurity: "storyboards-cyber.cjs" };
if (!FILES[course]) throw new Error("Usage: node learn/narrate-learn.cjs <hipaa|cybersecurity> [video id ...] [--speed 1.35]");
const speedAt = args.indexOf("--speed");
const SPEED = speedAt >= 0 ? args[speedAt + 1] : "1.35";
const want = args.slice(1).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--speed");

const ROOT = path.resolve(__dirname, "..");
const AUDIO = path.join(ROOT, "audio", "learn");
const DATA = path.join(__dirname, `video-data-${course}.json`);
const SPOKEN = path.resolve(ROOT, "../../apps/learn/src/content/recap-spoken.json");
const NAME = { hipaa: "HIPAA", cybersecurity: "Cybersecurity" };
const LEAD_IN = 0.3; // keep in step with src/Cs.jsx
const GAP = 0.35; // pause between spoken pieces
const GAP_AFTER_LEAD = 0.6;
const TAIL = 0.9; // quiet time at the end of a scene

const VIDEOS = require("./" + FILES[course]);
const todo = want.length ? VIDEOS.filter((v) => want.includes(v.id)) : VIDEOS;
if (want.length && todo.length !== want.length) throw new Error("Unknown video in: " + want.join(", "));

// Words a voice would mangle: spell out acronyms letter by letter. HIPAA is written "Heepa" for the voice (it says "Hip-aye" otherwise) and ERS is said as "ELITE Resource Services";
// captions and the "read as text" transcript keep the real spelling because only the spoken text goes through this list.
const SAY = [
  [/\bHIPAA\b/g, "Heepa"], [/\bePHI\b/g, "e P H I"], [/\bPHI\b/g, "P H I"], [/\bHHS\b/g, "H H S"], [/\bOCR\b/g, "O C R"], [/\bERS\b/g, "ELITE Resource Services"], [/\bMFA\b/g, "M F A"],
  [/\bBAA\b/g, "B A A"], [/\bCMIA\b/g, "C M I A"], [/\bHB\b/g, "H B"], [/\bAI\b/g, "A I"], [/\bIT\b/g, "I T"], [/\bWPA2\b/g, "W P A 2"], [/\bWPA3\b/g, "W P A 3"],
  [/\bEHR\b/g, "E H R"], [/\bHR\b/g, "H R"], [/\bVAs?\b/g, "V A"], [/\bQR\b/g, "Q R"], [/\bURLs?\b/g, "U R L"], [/\bIDs?\b/g, "I D"], [/\bSMS\b/g, "S M S"],
  [/\bVPN\b/g, "V P N"], [/\bUSB\b/g, "U S B"], [/\bPDF\b/g, "P D F"], [/\bDOJ\b/g, "D O J"], [/\bNPP\b/g, "N P P"],
];
const speakable = (t) => SAY.reduce((s, [re, to]) => s.replace(re, to), String(t));

function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  let fmt = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), byteRate: b.readUInt32LE(p + 16), align: b.readUInt16LE(p + 20), bits: b.readUInt16LE(p + 22) };
    if (id === "data") return { fmt, pcm: b.subarray(p + 8, p + 8 + size) };
    p += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in " + file);
}
function writeWav(file, fmt, pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(fmt.channels, 22);
  h.writeUInt32LE(fmt.rate, 24);
  h.writeUInt32LE(fmt.byteRate, 28);
  h.writeUInt16LE(fmt.align, 32);
  h.writeUInt16LE(fmt.bits, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
const silence = (fmt, sec) => Buffer.alloc(Math.round(sec * fmt.byteRate) - (Math.round(sec * fmt.byteRate) % fmt.align));
const seconds = (fmt, pcm) => pcm.length / fmt.byteRate;

const introSayOf = (v) => v.introSay || `${NAME[course]} training. Module ${v.n}. ${v.title}.`;
const outroOf = (v) => v.outroItems.map((o) => o.say);

// the list of everything to speak
const manifest = [];
for (const v of todo) {
  if (!v.outroItems || !v.outroItems.length) throw new Error(`${v.id}: outroItems missing`);
  const dir = path.join(AUDIO, v.id, "_parts");
  manifest.push({ file: path.join(dir, "intro.wav"), text: speakable(introSayOf(v)), voice: "narrator" });
  v.scenes.forEach((s, i) => beatsOf(s).forEach((b, k) => manifest.push({ file: path.join(dir, `s${i + 1}-b${k}.wav`), text: speakable(b.say), voice: b.voice })));
  outroOf(v).forEach((t, k) => manifest.push({ file: path.join(dir, `outro-b${k}.wav`), text: speakable(t), voice: "narrator" }));
}
fs.mkdirSync(AUDIO, { recursive: true });
const bgm = path.join(ROOT, "audio", "cs", "bgm.mp3");
const kept = path.join(ROOT, "assets", "music", "zephiramusic-lofi-gaming-606302.mp3"); // the committed copy (assets/music/README.md)
if (!fs.existsSync(bgm) && fs.existsSync(kept)) {
  fs.mkdirSync(path.dirname(bgm), { recursive: true });
  fs.copyFileSync(kept, bgm);
}
if (!fs.existsSync(bgm)) throw new Error("The music track is missing: restore tools/recap-video/assets/music/zephiramusic-lofi-gaming-606302.mp3.");
fs.copyFileSync(bgm, path.join(AUDIO, "bgm.mp3"));
const manifestFile = path.join(AUDIO, "manifest.json");
fs.writeFileSync(manifestFile, JSON.stringify(manifest));
execFileSync(process.execPath, [path.join(ROOT, "customer-service", "speak-vs.cjs"), manifestFile, "--speed", SPEED], { stdio: "inherit" });

const done = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, "utf8")) : [];
const byId = new Map(done.map((d) => [d.id, d]));

for (const v of todo) {
  const folder = path.join(AUDIO, v.id);
  const parts = path.join(folder, "_parts");
  const join = (files, outFile, gaps) => {
    const first = readWav(files[0]);
    const chunks = [];
    const cues = [];
    const durs = [];
    let t = 0;
    files.forEach((f, k) => {
      const w = readWav(f);
      cues.push(Math.round(t * 1000) / 1000);
      durs.push(Math.round(seconds(first.fmt, w.pcm) * 1000) / 1000);
      chunks.push(w.pcm);
      t += seconds(first.fmt, w.pcm);
      if (k < files.length - 1) {
        const g = gaps(k);
        chunks.push(silence(first.fmt, g));
        t += g;
      }
    });
    writeWav(outFile, first.fmt, Buffer.concat(chunks));
    return { cues, durs, total: t };
  };
  const introWav = readWav(path.join(parts, "intro.wav"));
  const introSec = seconds(introWav.fmt, introWav.pcm);
  fs.copyFileSync(path.join(parts, "intro.wav"), path.join(folder, "intro.wav"));
  const scenes = [];
  const scenesSeconds = [];
  v.scenes.forEach((s, i) => {
    const bs = beatsOf(s);
    const files = bs.map((_, k) => path.join(parts, `s${i + 1}-b${k}.wav`));
    const lead = s.lead ? 1 : 0;
    const r = join(files, path.join(folder, `s${i + 1}.wav`), (k) => (lead && k === 0 ? GAP_AFTER_LEAD : GAP));
    scenes.push({ cues: r.cues, durs: r.durs, seconds: Math.round(r.total * 100) / 100 });
    scenesSeconds.push(Math.round((LEAD_IN + r.total + TAIL) * 10) / 10);
  });
  const o = join(outroOf(v).map((_, k) => path.join(parts, `outro-b${k}.wav`)), path.join(folder, "outro.wav"), () => 0.4);
  const intro = Math.round(Math.max(4, introSec + 1.4) * 10) / 10;
  const outro = Math.round((LEAD_IN + o.total + 1.2) * 10) / 10;
  const total = Math.round(intro + outro + scenesSeconds.reduce((a, b) => a + b, 0));
  byId.set(v.id, {
    ...v,
    introSay: introSayOf(v),
    count: VIDEOS.length,
    scenesSeconds,
    intro,
    outro,
    seconds: total,
    narration: { voice: "Lorie (VoiceStudio)", folder: v.id, scenes, introSeconds: introSec, outroCues: o.cues, outroDurs: o.durs, music: "bgm.mp3" },
  });
  const flag = total < 60 || total > 90 ? "   <-- OUTSIDE 60 TO 90 SECONDS" : "";
  console.log(`${v.id}: ${total}s (speech ${Math.round(scenes.reduce((a, s) => a + s.seconds, 0))}s)${flag}`);
}
const out = VIDEOS.map((v) => byId.get(v.id)).filter(Boolean);
fs.writeFileSync(DATA, JSON.stringify(out));
console.log(`wrote learn/video-data-${course}.json (${out.length} videos)`);

// the words of every video for the app's "read the recap as text" (all storyboards, so it stays complete)
const spoken = fs.existsSync(SPOKEN) ? JSON.parse(fs.readFileSync(SPOKEN, "utf8")) : {};
for (const v of VIDEOS) spoken[v.id] = v.scenes.map((s) => beatsOf(s).map((b) => b.say));
fs.writeFileSync(SPOKEN, JSON.stringify(spoken, null, 1) + "\n");
console.log("wrote apps/learn/src/content/recap-spoken.json");
