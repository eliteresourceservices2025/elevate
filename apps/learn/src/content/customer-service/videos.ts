// The Customer Service course's lesson videos: where each one plays and the words of each as text. The files and videos.json come from
// tools/recap-video (customer-service/export-to-learn.cjs); the files are served by the signed-in route (src/lib/recap-media.ts).
// The subtitles are burned into the picture (they cannot be switched off or lost), so there is no separate subtitle track to offer.
// Every video is optional: reading the module stays the required part. The three worked mock calls (cs-11 to cs-13) are NOT here on
// purpose: they show model answers close to the graded mock call, so they stay out of the learner's course.
import videos from "./videos.json";

export type CourseVideo = { id: string; title: string; seconds: number; transcript: string[] };
export type VideoView = { label: string; file: string; seconds: number; transcript: string[] };

const COURSE = "customer-service";
const ALL = videos as CourseVideo[];

/** On the course page, before the first module. */
export const WELCOME_VIDEO = "cs-00-welcome";

/** Three worked example calls, on the course page before the graded mock call. They use different callers and situations from the graded calls. */
export const DEMO_VIDEOS = ["cs-d1-routine-request", "cs-d2-returned-form", "cs-d3-supervisor-exception"];

/** Videos that play at the top of a module, in this order. A module that is not listed has none. */
export const MODULE_VIDEOS: Record<string, string[]> = {
  excellence: ["cs-01-our-role"],
  communication: ["cs-m2-professional-communication"],
  channels: ["cs-02-phone-communication"],
  confidentiality: ["cs-m5-confidentiality"],
  healthcare: ["cs-m6-healthcare-calls"],
  listening: ["cs-03-active-listening", "cs-04-empathy", "cs-06-asking-questions"],
  personalities: ["cs-m8-difficult-callers"],
  difficult: ["cs-05-learn-framework", "cs-08-difficult-calls"],
  bad_news: ["cs-07-managing-expectations"],
  resolution: ["cs-09-unknown-answers-escalation", "cs-10-documentation"],
  resilience: ["cs-14-seven-steps-and-takeaways"],
};

function view(id: string): VideoView {
  const v = ALL.find((x) => x.id === id);
  if (!v) throw new Error(`No Customer Service video ${id}`);
  const base = `/api/recaps/${COURSE}-${v.id}`;
  return { label: v.title, file: `${base}.mp4`, seconds: v.seconds, transcript: v.transcript };
}

export const videosForModule = (course: string, moduleKey: string): VideoView[] => (course === COURSE ? (MODULE_VIDEOS[moduleKey] ?? []).map(view) : []);
export const demoVideos = (course: string): VideoView[] => (course === COURSE ? DEMO_VIDEOS.map(view) : []);
export const welcomeVideo = (course: string): VideoView | null => (course === COURSE ? { ...view(WELCOME_VIDEO), label: "Welcome to the course" } : null);
