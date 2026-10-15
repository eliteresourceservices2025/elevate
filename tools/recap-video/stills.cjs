// Renders one still from the middle of every scene of one recap, for a quick visual check.
//   node stills.cjs hipaa/associates      (writes to ./stills)
const path = require("path");
const fs = require("fs");
const { bundle } = require("@remotion/bundler");
const { renderStill, selectComposition } = require("@remotion/renderer");
const RECAPS = JSON.parse(fs.readFileSync(path.join(__dirname, "recaps.json"), "utf8"));
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(__dirname, "stills");
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const [course, module] = (process.argv[2] || "").split("/");
  const r = RECAPS.find((x) => x.course === course && x.module === module);
  if (!r) throw new Error("Usage: node stills.cjs <course>/<module>");
  const serveUrl = await bundle({ entryPoint: path.join(__dirname, "src/index.jsx"), onProgress: () => {} });
  const composition = await selectComposition({ serveUrl, id: "Recap", inputProps: { recap: r }, browserExecutable: CHROME });
  let at = r.intro * 30;
  const frames = [{ n: "intro", f: 54 }];
  r.scenes.forEach((s, i) => {
    const dur = Math.round(r.scenesSeconds[i] * 30);
    frames.push({ n: `s${i + 1}-${s.kind}`, f: at + Math.round(dur * 0.72) });
    at += dur;
  });
  frames.push({ n: "outro", f: at + 40 });
  for (const fr of frames) {
    const out = path.join(OUT, `${course}-${module}-${fr.n}.png`);
    await renderStill({ composition, serveUrl, output: out, frame: fr.f, inputProps: { recap: r }, browserExecutable: CHROME, logLevel: "error" });
    console.log(out);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
