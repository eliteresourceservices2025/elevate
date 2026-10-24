// Renders the WELCOME video to MP4 (1280x720, 30 fps, H.264 + AAC) into out/customer-service.
//   node customer-service/render-welcome.cjs                 all (after narrate-welcome.cjs)
//   node customer-service/render-welcome.cjs cs-01-our-role  some      add --skip-existing to resume
//   node customer-service/render-welcome.cjs --stills cs-01-our-role   a PNG from the middle of every scene instead, into out/customer-service/stills
// Needs Chrome: set CHROME_PATH if it is not in the usual place. Output is not committed (out/ is ignored) while the videos are in review.
const path = require("path");
const fs = require("fs");
const { bundle } = require("@remotion/bundler");
const { captionsFor, toVtt } = require("./captions.cjs");
const { renderMedia, renderStill, selectComposition } = require("@remotion/renderer");

const args = process.argv.slice(2);
const stills = args.includes("--stills") && !!args.splice(args.indexOf("--stills"), 1);
const skipExisting = args.includes("--skip-existing") && !!args.splice(args.indexOf("--skip-existing"), 1);
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out", "customer-service");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SET = process.env.CS_SET || "welcome"; // CS_SET=modules renders the module videos
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, `${SET}-data.json`), "utf8"));
// Background music: a track called bgm.mp3 in audio/cs (free-licence music, see docs/learn/13-recap-videos.md) replaces the synthesized music.wav.
const BGM = fs.existsSync(path.join(ROOT, "audio", "cs", "bgm.mp3"));
if (BGM) for (const v of DATA) v.narration.music = "bgm.mp3";

// Subtitles: burned into the picture (they cannot be switched off or lost when the file is moved) and also saved as .vtt next to the MP4.
for (const v of DATA) v.captions = captionsFor(v);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const todo = DATA.filter((v) => args.length === 0 || args.includes(v.id));
  if (args.length && todo.length !== args.length) throw new Error("Unknown or not-yet-narrated video in: " + args.join(", "));
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.jsx"), publicDir: path.join(ROOT, "audio", "cs"), onProgress: () => {} });
  for (const v of todo) {
    const t0 = Date.now();
    const composition = await selectComposition({ serveUrl, id: "CsVideo", inputProps: { video: v }, browserExecutable: CHROME });
    if (stills) {
      const dir = path.join(OUT, "stills");
      fs.mkdirSync(dir, { recursive: true });
      let at = v.intro * 30;
      const frames = [{ n: "intro", f: 60 }];
      v.scenes.forEach((s, i) => {
        const dur = Math.round(v.scenesSeconds[i] * 30);
        frames.push({ n: `s${i + 1}-${s.kind}`, f: at + dur - 20 });
        at += dur;
      });
      frames.push({ n: "outro", f: at + Math.round(v.outro * 30) - 12 });
      for (const fr of frames) {
        const output = path.join(dir, `${v.id}-${fr.n}.png`);
        await renderStill({ composition, serveUrl, output, frame: fr.f, inputProps: { video: v }, browserExecutable: CHROME, logLevel: "error" });
      }
      console.log(`${v.id}: ${frames.length} stills`);
      continue;
    }
    fs.writeFileSync(path.join(OUT, `${v.id}.vtt`), toVtt(v.captions));
    const file = path.join(OUT, `${v.id}.mp4`);
    if (skipExisting && fs.existsSync(file)) {
      console.log(`${v.id}.mp4 already rendered, skipped`);
      continue;
    }
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: file,
      inputProps: { video: v },
      browserExecutable: CHROME,
      crf: 26,
      pixelFormat: "yuv420p",
      audioBitrate: "128k",
      concurrency: 4,
      logLevel: "error",
    });
    console.log(`${v.id}.mp4  ${Math.round(composition.durationInFrames / 30)}s  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB  ${((Date.now() - t0) / 1000).toFixed(0)}s to render`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
