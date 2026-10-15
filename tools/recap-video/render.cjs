// Renders the optional recap videos for the Learn modules (motion graphics, captions on screen, optional voice-over).
//   node render.cjs                         silent, all 20, into apps/learn/public/recaps
//   node render.cjs hipaa/associates ...    silent, some
//   node render.cjs --data recaps.zira.json --audio audio/zira --out samples/zira hipaa/associates
//                                           narrated (made by narrate.cjs), written to the folder given by --out
// Reads recaps.json (made by `pnpm --filter elevate learn:export-recaps`). Needs Chrome: set CHROME_PATH if not in the usual place.
// See docs/learn/13-recap-videos.md.
const path = require("path");
const fs = require("fs");
const { bundle } = require("@remotion/bundler");
const { renderMedia, selectComposition } = require("@remotion/renderer");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const dataFile = opt("--data", "recaps.json");
const audioDir = opt("--audio", null);
const skipExisting = args.includes("--skip-existing") && !!args.splice(args.indexOf("--skip-existing"), 1);
const outArg = opt("--out", null);
const toPublic = outArg === null;
const outDir = path.resolve(__dirname, outArg || "../../apps/learn/public/recaps");
const DURATIONS = path.resolve(__dirname, "../../apps/learn/src/content/recap-durations.json");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const RECAPS = JSON.parse(fs.readFileSync(path.join(__dirname, dataFile), "utf8"));

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const todo = RECAPS.filter((r) => args.length === 0 || args.includes(`${r.course}/${r.module}`));
  const serveUrl = await bundle({
    entryPoint: path.join(__dirname, "src/index.jsx"),
    publicDir: audioDir ? path.resolve(__dirname, audioDir) : undefined,
    onProgress: () => {},
  });
  for (const r of todo) {
    const t0 = Date.now();
    if (skipExisting && fs.existsSync(path.join(outDir, `${r.course}-${r.module}.mp4`))) {
      console.log(`${r.course}-${r.module}.mp4`, "already rendered, skipped");
      continue;
    }
    const composition = await selectComposition({ serveUrl, id: "Recap", inputProps: { recap: r }, browserExecutable: CHROME });
    const file = path.join(outDir, `${r.course}-${r.module}.mp4`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: file,
      inputProps: { recap: r },
      browserExecutable: CHROME,
      crf: 30,
      pixelFormat: "yuv420p",
      muted: !r.narration,
      audioBitrate: "96k",
      concurrency: 4,
      logLevel: "error",
    });
    if (toPublic) {
      // the length shown in the player comes from the file that was actually rendered
      const d = fs.existsSync(DURATIONS) ? JSON.parse(fs.readFileSync(DURATIONS, "utf8")) : {};
      d[`${r.course}-${r.module}`] = Math.round(composition.durationInFrames / 30);
      fs.writeFileSync(DURATIONS, JSON.stringify(d, null, 1) + "\n");
    }
    console.log(`${path.relative(process.cwd(), file)}`, `${Math.round(composition.durationInFrames / 30)}s`, `${(fs.statSync(file).size / 1024).toFixed(0)} KB`, `${((Date.now() - t0) / 1000).toFixed(0)}s to render`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
