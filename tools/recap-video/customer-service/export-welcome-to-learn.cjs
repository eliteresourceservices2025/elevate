// Hands the HIPAA and Cybersecurity welcome videos to ELEVATE Learn: copies each MP4 (rendered by render-welcome.cjs with CS_SET=hipaa-welcome /
// cybersecurity-welcome) into apps/learn/media/recaps as <course>-00-welcome.mp4 and writes apps/learn/src/content/welcome-videos.json (length and the
// words as a transcript). Run:   node customer-service/export-welcome-to-learn.cjs
const fs = require("fs");
const path = require("path");
const { beatsOf } = require("./beats.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out", "customer-service");
const LEARN = path.resolve(ROOT, "..", "..", "apps", "learn");
const SETS = [
  { course: "hipaa", set: "hipaa-welcome" },
  { course: "cybersecurity", set: "cybersecurity-welcome" },
];
const OUTRO = ["Listen.", "Understand.", "Act.", "Follow through."];
const result = {};
for (const { course, set } of SETS) {
  const [v] = require(`./${set}-data.json`);
  const from = path.join(OUT, `${v.id}.mp4`);
  if (!fs.existsSync(from)) throw new Error(`missing ${from}: render it first`);
  fs.copyFileSync(from, path.join(LEARN, "media", "recaps", `${v.id}.mp4`));
  const transcript = [v.introSay];
  for (const s of v.scenes) for (const b of beatsOf(s)) transcript.push(b.say);
  transcript.push((v.outroItems ? v.outroItems.map((i) => i.word + ".") : OUTRO).join(" "));
  result[course] = { id: v.id, title: v.title, seconds: v.seconds, transcript };
}
fs.writeFileSync(path.join(LEARN, "src", "content", "welcome-videos.json"), JSON.stringify(result, null, 1) + "\n");
console.log("exported", Object.keys(result).join(", "));
