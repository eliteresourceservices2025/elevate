// Makes the read-aloud clips for the Customer Service mock call and exam with VoiceStudio (running locally, port 3900) and files them
// where ELEVATE Learn serves them: apps/learn/media/voice/<key>.m4a, plus the list of finished clips in
// apps/learn/src/content/voice-index.json. Nothing leaves this computer.
//   1. (apps/elevate)  pnpm exec tsx scripts/learn-voice-texts.mts     writes out/voice/manifest.json (which clips, who speaks, what tone)
//   2. node customer-service/make-voice.cjs                           all missing clips (resumes where it stopped; run it again after a stop)
//      --only caller,reply     only some kinds (caller, reply, exam, letter)       --redo     make them again even if the file exists
//      --engine omnivoice      the engine for the CALLERS (default omnivoice); the exam reader always uses omnivoice
// The callers are invented people with their own voices; tone comes from the pitch and pace the engine can control. An engine that can act
// an emotion (IndexTTS) is used for callers when it is installed and --engine indextts2 is given.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = process.env.VOICESTUDIO_URL || "http://localhost:3900";
const ROOT = path.resolve(__dirname, "..");
const LEARN = path.resolve(ROOT, "..", "..", "apps", "learn");
const MEDIA = path.join(LEARN, "media", "voice");
const INDEX = path.join(LEARN, "src", "content", "voice-index.json");
const MANIFEST = path.join(ROOT, "out", "voice", "manifest.json");
const WORK = path.join(ROOT, "out", "voice", "wav");
const FFMPEG = path.join(ROOT, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");
const ONLY = (arg("--only", "") || "").split(",").filter(Boolean);
const REDO = process.argv.includes("--redo");
const ENGINE = arg("--engine", "omnivoice");

// who is speaking: a designed voice (age, gender, pitch, accent), not the owner's voice
const VOICES = {
  reader: "female, middle-aged, low pitch, american accent",
  maria: "female, middle-aged, moderate pitch, american accent",
  daniel: "male, middle-aged, moderate pitch, american accent",
  alex: "male, young adult, moderate pitch, american accent",
  linda: "female, middle-aged, high pitch, american accent",
  sam: "male, middle-aged, low pitch, american accent",
};

// what pitch and pace can say about a tone when the engine cannot act it out
function pace(tone) {
  if (/angry|sharp|raising/.test(tone)) return { pitch: "high pitch", speed: 1.22 };
  if (/irritated|impatient|demanding|pushy|annoyed|firm|curt/.test(tone)) return { pitch: null, speed: 1.15 };
  if (/anxious|worried|scared|uneasy|pleading|unsteady|shaking/.test(tone)) return { pitch: "high pitch", speed: 1.08 };
  if (/relieved|calm|quiet|tired/.test(tone)) return { pitch: null, speed: 0.95 };
  return { pitch: null, speed: 1.0 };
}
const instructFor = (clip) => {
  const base = VOICES[clip.speaker];
  if (clip.speaker === "reader") return base;
  const p = pace(clip.tone).pitch;
  return p ? base.replace(/(low|moderate|high) pitch/, p) : base;
};

async function synthesize(clip, file) {
  const speed = clip.speaker === "reader" ? 1.0 : pace(clip.tone).speed;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "omnivoice", input: clip.text, voice: "default", instructions: instructFor(clip), response_format: "wav", language: "en", speed }),
      });
      if (!res.ok) throw new Error(`VoiceStudio answered ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

(async () => {
  if (ENGINE !== "omnivoice") throw new Error(`Engine ${ENGINE} is not wired in yet.`);
  if (!fs.existsSync(MANIFEST)) throw new Error("Run learn-voice-texts.mts first (apps/elevate): " + MANIFEST);
  if (!fs.existsSync(FFMPEG)) throw new Error("ffmpeg not found at " + FFMPEG);
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!health) throw new Error(`VoiceStudio is not running at ${BASE}. Open the app first.`);
  fs.mkdirSync(MEDIA, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  const done = new Set(JSON.parse(fs.readFileSync(INDEX, "utf8")));
  const clips = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).filter((c) => (ONLY.length === 0 || ONLY.includes(c.kind)) && (REDO || !done.has(c.key) || !fs.existsSync(path.join(MEDIA, `${c.key}.m4a`))));
  console.log(`${clips.length} clips to make`);
  let n = 0;
  for (const clip of clips) {
    const wav = path.join(WORK, `${clip.key}.wav`);
    const out = path.join(MEDIA, `${clip.key}.m4a`);
    await synthesize(clip, wav);
    const r = spawnSync(FFMPEG, ["-y", "-loglevel", "error", "-i", wav, "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", "-f", "mp4", out]);
    if (r.status !== 0) throw new Error("ffmpeg failed: " + String(r.stderr));
    fs.rmSync(wav);
    done.add(clip.key);
    fs.writeFileSync(INDEX, JSON.stringify([...done].sort(), null, 1) + "\n"); // after every clip, so a stop loses nothing
    n += 1;
    process.stdout.write(`\r${n} of ${clips.length}  ${clip.kind}  ${clip.key}`);
  }
  process.stdout.write("\n");
})().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
