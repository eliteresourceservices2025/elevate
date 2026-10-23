// Checks the storyboards before anything is recorded: scene kinds and icons exist, every spoken line is non-empty, and the estimated
// length is inside 60 to 90 seconds. Estimate: 2.2 words a second plus 0.35 s between pieces, 1.2 s around each scene, about 9 s of
// intro and outro. The real length is measured after narration (narrate-learn.cjs).
//   node learn/validate.cjs [hipaa|cybersecurity]
const path = require("path");
const fs = require("fs");
const { beatsOf } = require("../customer-service/beats.cjs");
const KINDS = ["hero", "icons", "formula", "flow", "swap", "dialogue", "checklist", "compare", "stat", "chain", "timeline", "stack"];

const iconsSrc = fs.readFileSync(path.join(__dirname, "../src/icons.js"), "utf8");
const ICONS = new Set([...iconsSrc.matchAll(/"([a-z0-9-]+)":\[\[/g)].map((m) => m[1]));

function iconsIn(x, out = []) {
  if (Array.isArray(x)) x.forEach((v) => iconsIn(v, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) k === "icon" ? out.push(v) : iconsIn(v, out);
  return out;
}

function check(videos, label) {
  let bad = 0;
  const fail = (m) => { bad++; console.log("  PROBLEM: " + m); };
  for (const v of videos) {
    const scenes = v.scenes;
    let words = 0;
    let beats = 0;
    if (scenes.length < 4 || scenes.length > 7) fail(`${v.id}: ${scenes.length} scenes (want 4 to 7)`);
    if (!scenes.some((s) => ["stat", "chain", "timeline", "stack", "flow", "formula", "swap", "dialogue"].includes(s.kind))) fail(`${v.id}: needs an animated diagram scene`);
    scenes.forEach((s, i) => {
      if (!KINDS.includes(s.kind)) fail(`${v.id} scene ${i + 1}: unknown kind ${s.kind}`);
      let bs;
      try { bs = beatsOf(s); } catch (e) { fail(`${v.id} scene ${i + 1}: ${e.message}`); return; }
      beats += bs.length;
      bs.forEach((b) => (words += b.say.trim().split(/\s+/).length));
      words += 0;
    });
    for (const ic of iconsIn(v)) if (!ICONS.has(ic)) fail(`${v.id}: icon "${ic}" is not in src/icons.js (add it to gen-icons.cjs)`);
    const outroWords = (v.outroItems || []).reduce((n, o) => n + o.say.split(/\s+/).length, 0);
    const est = 9 + (words + outroWords) / 2.2 + scenes.length * 1.2 + beats * 0.35;
    const flag = est < 62 || est > 88 ? "   <-- OUTSIDE 62 TO 88 SECONDS (estimate)" : "";
    console.log(`${v.id}: ${scenes.length} scenes, ${words} spoken words, about ${Math.round(est)}s${flag}`);
    if (flag) bad++;
  }
  console.log(`${label}: ${videos.length} videos, ${bad} problems`);
  return bad;
}

if (require.main === module) {
  const which = process.argv[2] || "hipaa";
  const file = { hipaa: "storyboards-hipaa.cjs", cybersecurity: "storyboards-cyber.cjs" }[which];
  const videos = require("./" + file);
  process.exit(check(videos, which) ? 1 : 0);
}
module.exports = { check };
