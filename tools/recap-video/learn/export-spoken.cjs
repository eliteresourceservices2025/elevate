// Writes apps/learn/src/content/recap-spoken.json (the words of every video, for "read the recap as text") straight from the
// storyboards, so it does not wait for the narration. narrate-learn.cjs writes the same file.
//   node learn/export-spoken.cjs
const fs = require("fs");
const path = require("path");
const { beatsOf } = require("../customer-service/beats.cjs");
const out = path.resolve(__dirname, "../../../apps/learn/src/content/recap-spoken.json");
const spoken = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
for (const file of ["storyboards-hipaa.cjs"]) for (const v of require("./" + file)) spoken[v.id] = v.scenes.map((s) => beatsOf(s).map((b) => b.say));
fs.writeFileSync(out, JSON.stringify(spoken, null, 1) + "\n");
console.log("wrote recap-spoken.json:", Object.keys(spoken).length, "videos");
