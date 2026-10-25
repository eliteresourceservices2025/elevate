// Makes the ELEVATE introduction video: voice-over with VoiceStudio (the owner's voice, local, port 3900), then the MP4.
//   node elevate-intro/build.cjs                 voice + render
//   node elevate-intro/build.cjs --no-render     only the voice-over and the transcript
//   node elevate-intro/build.cjs --stills        a PNG at the end of every scene instead of a video (into elevate-intro/.build/stills)
//   node elevate-intro/build.cjs --redo          speak everything again   (--speed 1.2 changes the pace; default 1.2)
// Needs: the screenshots in apps/elevate/content/help/assets, VoiceStudio running, Chrome (CHROME_PATH if not in the usual place).
// Output: out/elevate-intro/elevate-intro.mp4 and elevate-intro-transcript.md (out/ is not committed while the video is in review).
// RULE: the narration says "ELITE Resource Services", never "ERS". This script refuses to run if a standalone ERS is in any text.
const fs = require("fs");
const path = require("path");
const { bundle } = require("@remotion/bundler");
const { renderMedia, renderStill, selectComposition } = require("@remotion/renderer");

const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.resolve(ROOT, "../../apps/elevate/content/help/assets");
const OUT = path.join(ROOT, "out", "elevate-intro");
const BUILD = path.join(__dirname, ".build");
const PUBLIC = path.join(BUILD, "public");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.VOICESTUDIO_URL || "http://localhost:3900";
const WIN = { w: 1200, h: 486 };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name) && !!args.splice(args.indexOf(name), 1);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const stills = flag("--stills");
const noRender = flag("--no-render");
const redo = flag("--redo");
const SPEED = Number(opt("--speed", "1.2"));

const VIDEO = require("./storyboard.cjs");
const BOXES = JSON.parse(fs.readFileSync(path.join(ASSETS, "_boxes.json"), "utf8"));

// --- the ERS rule -------------------------------------------------------------------
const texts = [VIDEO.title, VIDEO.subtitle, VIDEO.introSay, VIDEO.outroSay, ...VIDEO.steps.flatMap((s) => [s.say, s.caption, s.label, ...(s.image.panel ? s.image.panel.lines : [])])];
const bad = texts.filter((t) => /\bE\.?\s?R\.?\s?S\b/.test(t));
if (bad.length) throw new Error(`The narration and captions must say "ELITE Resource Services", never "ERS". Found: ${bad.join(" | ")}`);
if (!/ELITE Resource Services/.test(VIDEO.introSay) || !/ELITE Resource Services/.test(VIDEO.outroSay)) throw new Error("The opening and closing lines must name ELITE Resource Services.");

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function wavSeconds(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  let byteRate = 0;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ") byteRate = b.readUInt32LE(p + 16);
    if (id === "data") return Math.min(size, b.length - p - 8) / byteRate;
    p += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in " + file);
}
const round1 = (n) => Math.round(n * 10) / 10;
const baseView = (img) => ({ s: WIN.w / img.w, cx: img.w / 2, cy: WIN.h / 2 / (WIN.w / img.w) });
function focusView(img, box) {
  const pad = 70;
  const s = Math.max(WIN.w / img.w, Math.min(WIN.w / (box.w + pad * 2), WIN.h / (box.h + pad * 2), 2.1));
  return { s, cx: box.x + box.w / 2, cy: box.y + box.h / 2 };
}

async function voiceId() {
  const list = await (await fetch(`${BASE}/profiles`)).json();
  const profiles = Array.isArray(list) ? list : list.profiles || [];
  const mine = profiles.find((p) => p.name === "Lorie") || profiles.find((p) => !p.is_demo);
  if (!mine) throw new Error("No voice profile in VoiceStudio.");
  return mine.id;
}
async function speak(text, file, voice) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "omnivoice", input: text, voice, response_format: "wav", language: "en", speed: SPEED }) });
      if (!res.ok) throw new Error(`VoiceStudio answered ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

(async () => {
  const dir = path.join(PUBLIC, VIDEO.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  // pictures and views
  let prev = null;
  const steps = VIDEO.steps.map((st, i) => {
    if (st.image.panel) {
      const img = { file: null, w: WIN.w, h: WIN.h };
      return { ...st, panel: st.image.panel, img, box: null, from: baseView(img), to: baseView(img) };
    }
    const file = path.join(ASSETS, `${st.image}.png`);
    if (!fs.existsSync(file)) throw new Error(`step ${i + 1}: no picture ${st.image}.png`);
    const rel = `img/${st.image}.png`;
    fs.mkdirSync(path.dirname(path.join(PUBLIC, rel)), { recursive: true });
    fs.copyFileSync(file, path.join(PUBLIC, rel));
    const img = { file: rel, ...pngSize(file) };
    const box = !st.focus ? null : typeof st.focus === "string" ? (BOXES[st.image] && BOXES[st.image][st.focus]) || null : st.focus;
    if (st.focus && !box) console.warn(`  warning: step ${i + 1}: "${st.focus}" is not in _boxes.json for ${st.image} (shown without a ring)`);
    const same = prev && prev.image === st.image;
    const from = same ? prev.to : baseView(img);
    const to = box ? focusView(img, box) : same ? prev.to : baseView(img);
    prev = { image: st.image, to };
    return { ...st, img, box, from, to };
  });

  // voice-over
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!health) throw new Error(`VoiceStudio is not running at ${BASE}. Open the app first.`);
  const voice = await voiceId();
  console.log(`VoiceStudio ${health.version} on ${health.device}, voice ${voice}, speed ${SPEED}`);
  const items = [{ name: "intro", text: VIDEO.introSay }, ...steps.map((s, i) => ({ name: `s${i + 1}`, text: s.say })), { name: "outro", text: VIDEO.outroSay }];
  const textsFile = path.join(dir, "texts.json");
  const known = fs.existsSync(textsFile) && !redo ? JSON.parse(fs.readFileSync(textsFile, "utf8")) : {};
  let n = 0;
  for (const it of items) {
    const file = path.join(dir, `${it.name}.wav`);
    if (known[it.name] !== it.text || !fs.existsSync(file)) {
      await speak(it.text, file, voice);
      known[it.name] = it.text;
      fs.writeFileSync(textsFile, JSON.stringify(known, null, 1));
    }
    n += 1;
    process.stdout.write(`spoke ${n} of ${items.length}\n`);
  }

  const dur = Object.fromEntries(items.map((it) => [it.name, wavSeconds(path.join(dir, `${it.name}.wav`))]));
  const scene = (name, min) => round1(Math.max(min, 0.3 + dur[name] + 1.0));
  const bgm = path.join(ROOT, "audio", "cs", "bgm.mp3");
  const musicName = fs.existsSync(bgm) ? "music.mp3" : "music.wav";
  if (fs.existsSync(bgm)) fs.copyFileSync(bgm, path.join(PUBLIC, "music.mp3"));
  else if (!fs.existsSync(path.join(PUBLIC, "music.wav"))) require("child_process").execFileSync(process.execPath, [path.join(ROOT, "music.cjs"), "190", path.join(PUBLIC, "music.wav")], { stdio: "inherit" });

  const video = {
    id: VIDEO.id,
    title: VIDEO.title,
    intro_text: VIDEO.subtitle,
    intro: scene("intro", 4),
    outro: scene("outro", 4),
    steps: steps.map((s, i) => ({ ...s, seconds: scene(`s${i + 1}`, 4.5) })),
    narration: { folder: VIDEO.id, music: musicName },
  };
  const total = video.intro + video.outro + video.steps.reduce((a, s) => a + s.seconds, 0);
  console.log(`${VIDEO.id}: ${video.steps.length} steps, ${Math.round(total)}s (${Math.round(Object.values(dur).reduce((a, b) => a + b, 0))}s of speech)`);

  const lines = ["# ELEVATE introduction video: transcript", "", `Narrated with the owner's voice through VoiceStudio (speed ${SPEED}).`, "", `> ${VIDEO.introSay}`, ""];
  for (const s of steps) lines.push(`**${s.label}** (on screen: ${s.caption})`, "", s.say, "");
  lines.push(`> ${VIDEO.outroSay}`, "");
  fs.writeFileSync(path.join(OUT, "elevate-intro-transcript.md"), lines.join("\n"));
  fs.writeFileSync(path.join(BUILD, "video-data.json"), JSON.stringify(video, null, 1));
  if (noRender) return;

  const serveUrl = await bundle({ entryPoint: path.join(__dirname, "Intro.jsx"), publicDir: PUBLIC, onProgress: () => {} });
  const composition = await selectComposition({ serveUrl, id: "Intro", inputProps: { video }, browserExecutable: CHROME });
  if (stills) {
    const sdir = path.join(BUILD, "stills");
    fs.mkdirSync(sdir, { recursive: true });
    let at = Math.round(video.intro * 30);
    const marks = [{ n: "intro", f: 40 }];
    video.steps.forEach((s, i) => {
      const d = Math.round(s.seconds * 30);
      marks.push({ n: `s${String(i + 1).padStart(2, "0")}`, f: at + d - 20 });
      at += d;
    });
    marks.push({ n: "outro", f: at + 40 });
    for (const m of marks) await renderStill({ composition, serveUrl, output: path.join(sdir, `${m.n}.png`), frame: m.f, inputProps: { video }, browserExecutable: CHROME, logLevel: "error" });
    console.log(`${marks.length} stills in elevate-intro/.build/stills`);
    return;
  }
  const t0 = Date.now();
  const file = path.join(OUT, "elevate-intro.mp4");
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: file, inputProps: { video }, browserExecutable: CHROME, crf: 26, pixelFormat: "yuv420p", audioBitrate: "128k", concurrency: 4, logLevel: "error" });
  console.log(`${path.relative(process.cwd(), file)}  ${Math.round(composition.durationInFrames / 30)}s  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB  ${((Date.now() - t0) / 1000).toFixed(0)}s to render`);
})().catch((e) => {
  console.error("\n" + (e && e.message ? e.message : e));
  process.exit(1);
});
