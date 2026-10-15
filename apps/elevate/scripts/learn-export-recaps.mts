// Writes the recap storyboards (with module numbers, titles and scene timings) for the video renderer:
//   pnpm learn:export-recaps  ->  tools/recap-video/recaps.json
// Then, in tools/recap-video: npm install (once), node render.cjs. See docs/learn/13-recap-videos.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COURSES } from "../../learn/src/content";
import { INTRO_SECONDS, OUTRO_SECONDS, RECAPS, recapSeconds, sceneSeconds } from "../../learn/src/content/recaps";

const out = resolve(import.meta.dirname, "../../../tools/recap-video");
mkdirSync(out, { recursive: true });

const rows = RECAPS.map((r) => {
  const course = COURSES[r.course];
  const index = course.content.modules.findIndex((m) => m.key === r.module);
  if (index < 0) throw new Error(`Recap points at a module that does not exist: ${r.course}/${r.module}`);
  return {
    ...r,
    courseTitle: r.course === "hipaa" ? "HIPAA" : "Cybersecurity",
    moduleNumber: index + 1,
    moduleCount: course.content.modules.length,
    title: course.content.modules[index].title,
    scenesSeconds: r.scenes.map(sceneSeconds),
    seconds: recapSeconds(r),
    intro: INTRO_SECONDS,
    outro: OUTRO_SECONDS,
  };
});
writeFileSync(resolve(out, "recaps.json"), JSON.stringify(rows));
console.log(`Wrote ${rows.length} recaps to ${resolve(out, "recaps.json")}`);
