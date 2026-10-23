// Reads a manifest (JSON array of { file, text, voice }) and writes one WAV per entry with VoiceStudio (the owner's cloned voice,
// running locally on port 3900). Same job as speak-cs.ps1 (Windows voice), used by narrate-cs.cjs and narrate-welcome.cjs.
//   node customer-service/speak-vs.cjs <manifest.json> [--speed 1.35] [--voice <profile id>]
// Pieces are cached by (text, voice, speed) in audio/cs/_vs-cache, so a repeated line (the outro words, a phrase said in two videos) is
// made once, and an interrupted run carries on where it stopped. "family" lines (the caller in a dialogue) are said a little faster
// than the representative and the narrator, because one voice has to play both sides.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const args = process.argv.slice(2);
const manifestFile = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SPEED = Number(opt("--speed", process.env.VOICESTUDIO_SPEED || "1.35"));
const FAMILY_EXTRA = 1.08;
const BASE = process.env.VOICESTUDIO_URL || "http://localhost:3900";
const CACHE = path.resolve(__dirname, "..", "audio", "cs", "_vs-cache");

async function profile() {
  const given = opt("--voice", process.env.VOICESTUDIO_VOICE);
  if (given) return given;
  const list = await (await fetch(`${BASE}/profiles`)).json();
  const profiles = Array.isArray(list) ? list : list.profiles || [];
  const mine = profiles.find((p) => p.name === "Lorie") || profiles.find((p) => !p.is_demo);
  if (!mine) throw new Error("No voice profile found in VoiceStudio. Create one in the app first.");
  return mine.id;
}

async function synth(text, voice, speed) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "omnivoice", input: text, voice, response_format: "wav", language: "en", speed }),
      });
      if (!res.ok) throw new Error(`VoiceStudio answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

(async () => {
  if (!manifestFile) throw new Error("Usage: node speak-vs.cjs <manifest.json>");
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!health) throw new Error(`VoiceStudio is not running at ${BASE}. Open the app first.`);
  const voice = await profile();
  const items = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  fs.mkdirSync(CACHE, { recursive: true });
  let made = 0;
  let reused = 0;
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const speed = Math.round(SPEED * (it.voice === "family" ? FAMILY_EXTRA : 1) * 100) / 100;
    const key = crypto.createHash("sha1").update(`${voice}|${speed}|${it.text}`).digest("hex");
    const cached = path.join(CACHE, `${key}.wav`);
    if (fs.existsSync(cached)) reused += 1;
    else {
      fs.writeFileSync(cached, await synth(it.text, voice, speed));
      made += 1;
    }
    fs.mkdirSync(path.dirname(it.file), { recursive: true });
    fs.copyFileSync(cached, it.file);
    process.stdout.write(`\rspoke ${n + 1} of ${items.length}`);
  }
  process.stdout.write(`\nspoke ${items.length} files with VoiceStudio voice ${voice} at speed ${SPEED} (${made} new, ${reused} reused)\n`);
})().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
