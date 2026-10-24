// Makes the voice-over for the WELCOME video with VoiceStudio (the owner's cloned voice, running locally on port 3900) and the timing the
// renderer uses. Separate from narrate-cs.cjs on purpose: the other videos keep their Zira voice and their video-data.json.
//   node customer-service/narrate-welcome.cjs                 all pieces
//   node customer-service/narrate-welcome.cjs --speed 1.3     faster or slower (1.0 is the voice's natural pace; default 1.25)
//   node customer-service/narrate-welcome.cjs --voice <id>    another VoiceStudio profile (default: the profile named Lorie)
// Output: audio/cs/cs-00-welcome/{intro,s1..sN,outro}.wav, customer-service/welcome-data.json, out/customer-service/welcome-transcript.md
// Needs the VoiceStudio desktop app running. Nothing leaves the computer.
const fs = require("fs");
const path = require("path");
const { beatsOf } = require("./beats.cjs");
const VIDEOS = require(`./${process.argv.includes("--set") ? process.argv[process.argv.indexOf("--set") + 1] : "welcome"}-storyboard.cjs`);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const SPEED = Number(arg("--speed", "1.25"));
// --set modules reads modules-storyboard.cjs and writes modules-data.json (the default set is the welcome video)
const SET = arg("--set", "welcome");
const BASE = process.env.VOICESTUDIO_URL || "http://localhost:3900";
const ROOT = path.resolve(__dirname, "..");
const AUDIO = path.join(ROOT, "audio", "cs");
const DATA = path.join(__dirname, `${SET}-data.json`);
const LEAD_IN = 0.3; // keep in step with Cs.jsx
const GAP = 0.35;
const GAP_AFTER_LEAD = 0.6;
const TAIL = 0.9;
const OUTRO = ["Listen.", "Understand.", "Act.", "Follow through."];
// a storyboard may carry its own closing words (outroItems: [{ icon, word }]); the Customer Service welcome keeps the default
const outroOf = (v) => (v.outroItems ? v.outroItems.map((i) => i.word + ".") : OUTRO);

// --- minimal WAV reading/writing (VoiceStudio gives 24 kHz, 16 bit, mono) ---
function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  let fmt = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), byteRate: b.readUInt32LE(p + 16), align: b.readUInt16LE(p + 20), bits: b.readUInt16LE(p + 22) };
    if (id === "data") return { fmt, pcm: b.subarray(p + 8, p + 8 + Math.min(size, b.length - p - 8)) };
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

async function voiceId() {
  const given = arg("--voice", null);
  if (given) return given;
  const list = await (await fetch(`${BASE}/profiles`)).json();
  const profiles = Array.isArray(list) ? list : list.profiles || [];
  const mine = profiles.find((p) => p.name === "Lorie") || profiles.find((p) => !p.is_demo);
  if (!mine) throw new Error("No voice profile found in VoiceStudio. Create one in the app first.");
  return mine.id;
}

// HIPAA is written "Heepa" for the voice (it says "Hip-aye" otherwise) and ERS is said as "ELITE Resource Services"; captions and transcripts keep the real spelling.
async function speak(text, file, voice, rate = 1) {
  if (fs.existsSync(file) && !process.argv.includes("--redo")) return; // resume where it stopped
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "omnivoice", input: text.replace(/HIPAA/g, "Heepa").replace(/\bERS\b/g, "ELITE Resource Services"), voice, response_format: "wav", language: "en", speed: Math.round(SPEED * rate * 100) / 100 }),
      });
      if (!res.ok) throw new Error(`VoiceStudio answered ${res.status}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

(async () => {
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!health) throw new Error(`VoiceStudio is not running at ${BASE}. Open the app first.`);
  const voice = await voiceId();
  console.log(`VoiceStudio ${health.version} on ${health.device}, voice ${voice}, speed ${SPEED}`);

  const byId = new Map();
  for (const v of VIDEOS) {
    const folder = path.join(AUDIO, v.id);
    const parts = path.join(folder, "_parts");
    const pieces = [{ file: path.join(parts, "intro.wav"), text: v.introSay }];
    v.scenes.forEach((s, i) => beatsOf(s).forEach((b, k) => pieces.push({ file: path.join(parts, `s${i + 1}-b${k}.wav`), text: b.say, rate: b.voice === "family" ? 1.08 : 1 })));
    const outro = outroOf(v);
    outro.forEach((t, k) => pieces.push({ file: path.join(parts, `outro-b${k}.wav`), text: t }));
    let n = 0;
    for (const p of pieces) {
      await speak(p.text, p.file, voice, p.rate);
      n += 1;
      process.stdout.write(`\r${v.id}: spoke ${n} of ${pieces.length}`);
    }
    process.stdout.write("\n");

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

    const intro = readWav(path.join(parts, "intro.wav"));
    const introSec = seconds(intro.fmt, intro.pcm);
    fs.copyFileSync(path.join(parts, "intro.wav"), path.join(folder, "intro.wav"));

    const scenes = [];
    const scenesSeconds = [];
    v.scenes.forEach((s, i) => {
      const files = beatsOf(s).map((_, k) => path.join(parts, `s${i + 1}-b${k}.wav`));
      const lead = s.lead ? 1 : 0;
      const r = join(files, path.join(folder, `s${i + 1}.wav`), (k) => (lead && k === 0 ? GAP_AFTER_LEAD : GAP));
      scenes.push({ cues: r.cues, durs: r.durs, seconds: Math.round(r.total * 100) / 100 });
      scenesSeconds.push(Math.round((LEAD_IN + r.total + TAIL) * 10) / 10);
    });
    const o = join(outro.map((_, k) => path.join(parts, `outro-b${k}.wav`)), path.join(folder, "outro.wav"), () => 0.4);
    const introLen = Math.round(Math.max(4, introSec + 1.4) * 10) / 10;
    const outroLen = Math.round((LEAD_IN + o.total + 1.2) * 10) / 10;
    const total = Math.round(introLen + outroLen + scenesSeconds.reduce((a, b) => a + b, 0));
    byId.set(v.id, {
      ...v,
      n: 0,
      count: VIDEOS.length,
      scenesSeconds,
      intro: introLen,
      outro: outroLen,
      seconds: total,
      narration: { voice: `VoiceStudio ${voice}`, folder: v.id, scenes, introSeconds: introSec, outroCues: o.cues, music: fs.existsSync(path.join(AUDIO, "bgm.mp3")) ? "bgm.mp3" : "music.wav" },
    });
    console.log(`${v.id}: ${total}s${total < 55 || total > 75 ? "   <-- OUTSIDE 55 TO 75 SECONDS" : ""}`);
  }
  fs.writeFileSync(DATA, JSON.stringify(VIDEOS.map((v) => byId.get(v.id))));

  const lines = ["# Welcome video transcript", "", "Narrated with the owner's own voice through VoiceStudio.", ""];
  for (const v of VIDEOS) {
    lines.push(`> ${v.introSay}`, "");
    for (const s of v.scenes) for (const b of beatsOf(s)) lines.push(b.say, "");
    lines.push(`> ${outroOf(v).join(" ")}`, "");
  }
  const tdir = path.join(ROOT, "out", "customer-service");
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, `${SET}-transcript.md`), lines.join("\n"));
  console.log("wrote customer-service/welcome-data.json and out/customer-service/welcome-transcript.md");
})().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
