// Makes the voice-over for the recap videos with a Windows voice (offline, System.Speech) and writes the timing the renderer uses.
//   node narrate.cjs "Microsoft Zira Desktop" hipaa/associates [more course/module ...]
// Output: audio/<voice>/<course>-<module>/{intro,s1..sN,outro}.wav and recaps.<voice>.json (recaps.json plus a `narration` block with
// the length of each piece, and scene lengths stretched so the voice always finishes before the scene ends).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const voice = process.argv[2];
const want = process.argv.slice(3);
if (!voice || want.length === 0) {
  console.error('Usage: node narrate.cjs "<Windows voice name>" <course>/<module> [...]');
  process.exit(1);
}
const slug = voice.replace(/^Microsoft /, "").replace(/ Desktop$/, "").toLowerCase();
const ALL = JSON.parse(fs.readFileSync(path.join(__dirname, "recaps.json"), "utf8"));
const AUDIO = path.join(__dirname, "audio", slug);

// Words a voice would mangle: spell out acronyms letter by letter.
const SAY = [
  [/\bePHI\b/g, "e P H I"], [/\bPHI\b/g, "P H I"], [/\bHHS\b/g, "H H S"], [/\bERS\b/g, "E R S"], [/\bMFA\b/g, "M F A"], [/\bBAA\b/g, "B A A"],
  [/\bAI\b/g, "A I"], [/\bIT\b/g, "I T"], [/\bWPA2\b/g, "W P A 2"], [/\bWPA3\b/g, "W P A 3"], [/\bEHR\b/g, "E H R"], [/\bHR\b/g, "H R"],
  [/\bHIPAA\b/g, "Hippa"], [/\bVAs?\b/g, "V A"], [/\bQR\b/g, "Q R"], [/\bURLs?\b/g, "U R L"], [/\bIDs?\b/g, "I D"],
];
const speakable = (t) => SAY.reduce((s, [re, to]) => s.replace(re, to), String(t));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const end = (t) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
const sentence = (t) => end(cap(t));

function sceneText(s) {
  switch (s.kind) {
    case "statement":
      return sentence(s.text);
    case "list":
      return [end(s.heading), ...s.items.map(sentence)].join(" ");
    case "steps":
      return [end(s.heading), ...s.items.map((i) => `${sentence(i.title)} ${sentence(i.text)}`)].join(" ");
    case "layers":
      return [end(s.heading), ...s.items.map((i) => `${sentence(i.label)} ${sentence(i.text)}`)].join(" ");
    case "compare":
      return [end(s.heading), end(s.left.title), ...s.left.items.map(sentence), end(s.right.title), ...s.right.items.map(sentence)].join(" ");
    case "timeline":
      return [end(s.heading), ...s.items.map((i) => `${sentence(i.when)} ${sentence(i.text)}`)].join(" ");
  }
  return "";
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

// the background music: made once per voice folder (a track you put there yourself is left alone)
const musicFile = path.join(AUDIO, "music.wav");
if (!fs.existsSync(musicFile)) execFileSync(process.execPath, [path.join(__dirname, "music.cjs"), "100", musicFile], { stdio: "inherit" });

const outAll = [];
const manifest = [];
const todo = ALL.filter((r) => want.includes(`${r.course}/${r.module}`));
if (todo.length !== want.length) throw new Error("Unknown recap in: " + want.join(", "));
for (const r of todo) {
  const folder = path.join(AUDIO, `${r.course}-${r.module}`);
  manifest.push({ file: path.join(folder, "intro.wav"), text: speakable(`${r.courseTitle} course, module ${r.moduleNumber}. ${r.title}.`) });
  r.scenes.forEach((s, i) => manifest.push({ file: path.join(folder, `s${i + 1}.wav`), text: speakable(sceneText(s)) }));
  manifest.push({ file: path.join(folder, "outro.wav"), text: speakable("Now read the module.") });
}
const manifestFile = path.join(AUDIO, "manifest.json");
fs.mkdirSync(AUDIO, { recursive: true });
fs.writeFileSync(manifestFile, JSON.stringify(manifest));
console.log(execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "speak.ps1"), "-Manifest", manifestFile, "-Voice", voice, "-Rate", "-1"], { encoding: "utf8" }).trim());

for (const r of todo) {
  const rel = `${r.course}-${r.module}`;
  const folder = path.join(AUDIO, rel);
  const scenes = r.scenes.map((_, i) => ({ file: `${rel}/s${i + 1}.wav`, seconds: wavSeconds(path.join(folder, `s${i + 1}.wav`)) }));
  const introSeconds = wavSeconds(path.join(folder, "intro.wav"));
  const outroSeconds = wavSeconds(path.join(folder, "outro.wav"));
  const scenesSeconds = r.scenes.map((_, i) => Math.round(Math.max(r.scenesSeconds[i], scenes[i].seconds + 1.4) * 10) / 10);
  const intro = Math.round(Math.max(4, introSeconds + 1.6) * 10) / 10;
  const outro = Math.round(Math.max(4, outroSeconds + 1.6) * 10) / 10;
  const seconds = Math.round(intro + outro + scenesSeconds.reduce((a, b) => a + b, 0));
  outAll.push({ ...r, scenesSeconds, intro, outro, seconds, narration: { voice, folder: rel, scenes, introSeconds, outroSeconds, music: "music.wav" } });
  console.log(`${rel}: narration ${Math.round(scenes.reduce((a, s) => a + s.seconds, 0) + introSeconds + outroSeconds)}s of speech, video ${seconds}s (silent version ${r.seconds}s)`);
}
fs.writeFileSync(path.join(__dirname, `recaps.${slug}.json`), JSON.stringify(outAll));
console.log(`wrote recaps.${slug}.json and audio in audio/${slug}`);
