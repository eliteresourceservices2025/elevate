// Makes the narrated how-to videos for the Help center: the voice-over, then the MP4s.
//   node howto/build.cjs                      all videos in storyboards.cjs
//   node howto/build.cjs invite-a-person ...  some      (add --skip-existing to keep videos that are already there)
//   node howto/build.cjs --stills invite-a-person       a PNG at the end of every scene instead of a video, into howto/.build/stills
//   node howto/build.cjs --no-render                   only the voice-over (and the durations) so the wording can be checked
// Needs: the screenshots and content/help/assets/_boxes.json (run `pnpm help:shots` in apps/elevate first), Windows (the voice is System.Speech
// "Microsoft Zira Desktop"), Chrome (set CHROME_PATH if it is not in the usual place). Videos go to apps/elevate/content/help/videos/<id>.mp4,
// where the Help center serves them (the guide's header says `video: <id>`). See docs/modules/help-center.md.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { bundle } = require("@remotion/bundler");
const { renderMedia, renderStill, selectComposition } = require("@remotion/renderer");

const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.resolve(ROOT, "../../apps/elevate/content/help/assets");
const OUT = path.resolve(ROOT, "../../apps/elevate/content/help/videos");
const BUILD = path.join(__dirname, ".build");
const PUBLIC = path.join(BUILD, "public");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const VOICE = "Microsoft Zira Desktop";
const WIN = { w: 1200, h: 486 };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name) && !!args.splice(args.indexOf(name), 1);
const stills = flag("--stills");
const skipExisting = flag("--skip-existing");
const noRender = flag("--no-render");

const STORYBOARDS = require("./storyboards.cjs");
const BOXES = JSON.parse(fs.readFileSync(path.join(ASSETS, "_boxes.json"), "utf8"));

// Words a voice would mangle: spell out letters.
const SAY = [
  [/\bHR\b/g, "H R"], [/\bVAs?\b/g, "V A"], [/\bCSV\b/g, "C S V"], [/\bPDF\b/g, "P D F"], [/\bQR\b/g, "Q R"], [/\bIDs?\b/g, "I D"], [/\bERS\b/g, "E R S"],
  [/\bELEVATE\b/g, "Elevate"], [/\bJibble\b/g, "Jibble"], [/\bNDA\b/g, "N D A"], [/\bURL\b/g, "U R L"],
];
const speakable = (t) => SAY.reduce((s, [re, to]) => s.replace(re, to), String(t));

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
    if (id === "data") return size / byteRate;
    p += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in " + file);
}

const round1 = (n) => Math.round(n * 10) / 10;

/** The picture's view for a step: scale s with the point (cx, cy) of the picture in the middle of the window. */
function baseView(img) {
  const s = WIN.w / img.w;
  return { s, cx: img.w / 2, cy: WIN.h / 2 / s };
}
function focusView(img, box) {
  const pad = 70;
  const base = baseView(img);
  const s = Math.max(base.s, Math.min(WIN.w / (box.w + pad * 2), WIN.h / (box.h + pad * 2), 2.1));
  return { s, cx: box.x + box.w / 2, cy: box.y + box.h / 2 };
}

function prepare(video) {
  const dir = path.join(PUBLIC, video.id);
  fs.mkdirSync(dir, { recursive: true });

  // views, one per step; steps on the same picture start where the last one ended
  let prev = null;
  const steps = video.steps.map((st, i) => {
    const imgFile = path.join(ASSETS, `${st.image}.png`);
    if (!fs.existsSync(imgFile)) throw new Error(`${video.id} step ${i + 1}: no picture ${st.image}.png (run pnpm help:shots)`);
    const rel = `img/${st.image}.png`;
    fs.mkdirSync(path.dirname(path.join(PUBLIC, rel)), { recursive: true });
    fs.copyFileSync(imgFile, path.join(PUBLIC, rel));
    const size = pngSize(imgFile);
    const img = { file: rel, ...size };
    let box = null;
    if (st.focus) {
      box = typeof st.focus === "string" ? BOXES[st.image]?.[st.focus] ?? null : st.focus;
      if (!box) console.warn(`  warning: ${video.id} step ${i + 1}: "${st.focus}" is not in _boxes.json for ${st.image} (shown without a ring)`);
    }
    const same = prev && prev.image === st.image;
    const from = same ? prev.to : baseView(img);
    const to = box ? focusView(img, box) : same ? prev.to : baseView(img);
    prev = { image: st.image, to };
    return { ...st, img, box, from, to };
  });

  // voice-over: only what changed is spoken again
  const items = [
    { name: "intro", text: speakable(video.introSay || `How to ${video.title.charAt(0).toLowerCase()}${video.title.slice(1)}.`) },
    ...steps.map((st, i) => ({ name: `s${i + 1}`, text: speakable(st.say) })),
    { name: "outro", text: speakable(video.outroSay) },
  ];
  const textsFile = path.join(dir, "texts.json");
  const known = fs.existsSync(textsFile) ? JSON.parse(fs.readFileSync(textsFile, "utf8")) : {};
  const todo = items.filter((it) => known[it.name] !== it.text || !fs.existsSync(path.join(dir, `${it.name}.wav`)));
  if (todo.length) {
    const manifest = path.join(BUILD, `manifest-${video.id}.json`);
    fs.writeFileSync(manifest, JSON.stringify(todo.map((it) => ({ file: path.join(dir, `${it.name}.wav`), text: it.text }))));
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "speak.ps1"), "-Manifest", manifest, "-Voice", VOICE, "-Rate", "-1"], { encoding: "utf8" });
    for (const it of todo) known[it.name] = it.text;
    fs.writeFileSync(textsFile, JSON.stringify(known, null, 1));
  }

  const dur = Object.fromEntries(items.map((it) => [it.name, wavSeconds(path.join(dir, `${it.name}.wav`))]));
  const scene = (name, min) => round1(Math.max(min, 0.3 + dur[name] + 1.0));
  const out = {
    id: video.id,
    title: video.title,
    intro_text: video.subtitle || null,
    outro_title: video.title,
    intro: scene("intro", 4),
    outro: scene("outro", 4),
    steps: steps.map((st, i) => ({ ...st, seconds: scene(`s${i + 1}`, st.minSeconds || 4.5) })),
    narration: { folder: video.id, music: "music.wav" },
  };
  const total = out.intro + out.outro + out.steps.reduce((a, s) => a + s.seconds, 0);
  console.log(`${video.id}: ${out.steps.length} steps, ${Math.round(total)}s (${Math.round(Object.values(dur).reduce((a, b) => a + b, 0))}s of speech)`);
  if (total > 150) console.warn(`  warning: ${video.id} is longer than 2.5 minutes; split it or trim the wording`);
  return out;
}

(async () => {
  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const music = path.join(PUBLIC, "music.wav");
  if (!fs.existsSync(music)) execFileSync(process.execPath, [path.join(ROOT, "music.cjs"), "160", music], { stdio: "inherit" });

  const wanted = STORYBOARDS.filter((v) => args.length === 0 || args.includes(v.id));
  if (args.length && wanted.length !== args.length) throw new Error("Unknown video in: " + args.join(", "));
  const videos = wanted.filter((v) => !(skipExisting && fs.existsSync(path.join(OUT, `${v.id}.mp4`)) && !stills)).map(prepare);
  fs.writeFileSync(path.join(BUILD, "video-data.json"), JSON.stringify(videos, null, 1));
  if (noRender || videos.length === 0) return;

  const serveUrl = await bundle({ entryPoint: path.join(__dirname, "HowTo.jsx"), publicDir: PUBLIC, onProgress: () => {} });
  const failed = [];
  for (const v of videos) {
    try {
    const t0 = Date.now();
    const composition = await selectComposition({ serveUrl, id: "HowTo", inputProps: { video: v }, browserExecutable: CHROME });
    if (stills) {
      const dir = path.join(BUILD, "stills");
      fs.mkdirSync(dir, { recursive: true });
      let at = Math.round(v.intro * 30);
      const marks = [{ n: "intro", f: 40 }];
      v.steps.forEach((s, i) => {
        const dur = Math.round(s.seconds * 30);
        marks.push({ n: `s${i + 1}`, f: at + dur - 20 });
        at += dur;
      });
      marks.push({ n: "outro", f: at + 40 });
      for (const m of marks) await renderStill({ composition, serveUrl, output: path.join(dir, `${v.id}-${m.n}.png`), frame: m.f, inputProps: { video: v }, browserExecutable: CHROME, logLevel: "error" });
      console.log(`${v.id}: ${marks.length} stills in howto/.build/stills`);
      continue;
    }
    const file = path.join(OUT, `${v.id}.mp4`);
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: file, inputProps: { video: v }, browserExecutable: CHROME, crf: 28, pixelFormat: "yuv420p", audioBitrate: "96k", concurrency: 4, logLevel: "error" });
    console.log(`${path.relative(process.cwd(), file)}  ${Math.round(composition.durationInFrames / 30)}s  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  ${((Date.now() - t0) / 1000).toFixed(0)}s to render`);
    } catch (e) {
      // one video failing must not stop the others
      failed.push(v.id);
      console.error(`FAILED ${v.id}:`, e && e.message ? e.message : e);
    }
  }
  if (failed.length) throw new Error(`${failed.length} video(s) failed: ${failed.join(", ")}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
