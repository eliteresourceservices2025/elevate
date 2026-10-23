// Renders the HIPAA and Cybersecurity videos (after learn/narrate-learn.cjs) into apps/learn/media/recaps: <id>.mp4 plus <id>.vtt
// (subtitles the player offers as an option). Also records the length in recap-durations.json and the subtitles in recap-captions.json.
//   node learn/render-learn.cjs hipaa                      all of a course
//   node learn/render-learn.cjs hipaa hipaa-state_laws     some      add --skip-existing to resume
// Needs Chrome: set CHROME_PATH if it is not in the usual place.
const path = require("path");
const fs = require("fs");
const { bundle } = require("@remotion/bundler");
const { renderMedia, selectComposition } = require("@remotion/renderer");
const { captionsFor, toVtt } = require("./captions-learn.cjs");

const args = process.argv.slice(2);
const skipExisting = args.includes("--skip-existing") && !!args.splice(args.indexOf("--skip-existing"), 1);
const course = args.shift();
const ROOT = path.resolve(__dirname, "..");
const APP = path.resolve(ROOT, "../../apps/learn");
const OUT = path.join(APP, "media", "recaps");
const CONTENT = path.join(APP, "src", "content");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, `video-data-${course}.json`), "utf8"));
const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const todo = DATA.filter((v) => args.length === 0 || args.includes(v.id));
  if (args.length && todo.length !== args.length) throw new Error("Unknown or not-yet-narrated video in: " + args.join(", "));
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.jsx"), publicDir: path.join(ROOT, "audio", "learn"), onProgress: () => {} });
  for (const v of todo) {
    const t0 = Date.now();
    const file = path.join(OUT, `${v.id}.mp4`);
    if (skipExisting && fs.existsSync(file)) {
      console.log(`${v.id}.mp4 already rendered, skipped`);
      continue;
    }
    const composition = await selectComposition({ serveUrl, id: "CsVideo", inputProps: { video: v }, browserExecutable: CHROME });
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: file, inputProps: { video: v }, browserExecutable: CHROME, crf: 28, pixelFormat: "yuv420p", audioBitrate: "112k", concurrency: 4, logLevel: "error" });
    fs.writeFileSync(path.join(OUT, `${v.id}.vtt`), toVtt(captionsFor(v)));
    const durations = readJson(path.join(CONTENT, "recap-durations.json"), {});
    durations[v.id] = Math.round(composition.durationInFrames / 30);
    fs.writeFileSync(path.join(CONTENT, "recap-durations.json"), JSON.stringify(durations, null, 1) + "\n");
    const caps = new Set(readJson(path.join(CONTENT, "recap-captions.json"), []));
    caps.add(v.id);
    fs.writeFileSync(path.join(CONTENT, "recap-captions.json"), JSON.stringify([...caps].sort(), null, 1) + "\n");
    console.log(`${v.id}.mp4  ${Math.round(composition.durationInFrames / 30)}s  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB  ${((Date.now() - t0) / 1000).toFixed(0)}s to render`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
