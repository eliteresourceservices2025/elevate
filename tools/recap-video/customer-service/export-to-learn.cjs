// Hands the finished Customer Service videos to ELEVATE Learn: copies each MP4 into apps/learn/media/recaps (the
// private folder the signed-in route serves from) and writes apps/learn/src/content/customer-service/videos.json (title, length and the
// words as a transcript). Run after render-cs.cjs / render-welcome.cjs:   node customer-service/export-to-learn.cjs
// HELD BACK on purpose: the three deck mock calls (cs-11 to cs-13). They sat too close to the graded mock call scenarios (one repeats a
// graded caller line word for word), so they are replaced by the worked examples in demos-storyboard.cjs (cs-d1 to cs-d3).
const fs = require("fs");
const path = require("path");
const { beatsOf } = require("./beats.cjs");

const HELD_BACK = ["cs-11-mock-call-routine-inquiry", "cs-12-mock-call-frustrated-family", "cs-13-mock-call-supervisor-request"];
const SPEAKER = { rep: "Representative: ", family: "Family member: " };
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out", "customer-service");
const LEARN = path.resolve(ROOT, "..", "..", "apps", "learn");
const MEDIA = path.join(LEARN, "media", "recaps");

// the deck videos, the welcome video, the four module videos and the three worked-example calls (those that exist so far)
const optional = (f) => (fs.existsSync(path.join(__dirname, f)) ? require("./" + f) : []);
const videos = [...require("./welcome-data.json"), ...require("./video-data.json"), ...optional("modules-data.json"), ...optional("demos-data.json")].filter((v) => !HELD_BACK.includes(v.id) && fs.existsSync(path.join(OUT, `${v.id}.mp4`)));
fs.mkdirSync(MEDIA, { recursive: true });
const list = [];
for (const v of videos) {
  for (const ext of ["mp4"]) { // the subtitles are burned into the picture, so no .vtt is offered
    const from = path.join(OUT, `${v.id}.${ext}`);
    if (!fs.existsSync(from)) throw new Error(`missing ${from}: render it first`);
    fs.copyFileSync(from, path.join(MEDIA, `customer-service-${v.id}.${ext}`));
  }
  const transcript = [v.introSay || `Customer Service Excellence. ${v.title}.`];
  for (const s of v.scenes) for (const b of beatsOf(s)) transcript.push((SPEAKER[b.voice] || "") + b.say);
  list.push({ id: v.id, title: v.title, seconds: v.seconds, transcript });
}
fs.writeFileSync(path.join(LEARN, "src", "content", "customer-service", "videos.json"), JSON.stringify(list, null, 1) + "\n");
console.log(`${list.length} videos copied to ${MEDIA}; held back: ${HELD_BACK.join(", ")}`);
