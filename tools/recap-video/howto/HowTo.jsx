import React from "react";
import { AbsoluteFill, Audio, Composition, Img, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame } from "remotion";

// A narrated how-to video: an intro card, one scene per step (a screenshot that zooms to the part the step is about, a gold ring around
// it, a short caption and a voice-over), and an outro card. Built by howto/build.cjs from howto/storyboards.cjs and the screenshots the Help
// center tool takes. Self-contained on purpose (it shares nothing with the recap videos), so each can change without the other.

const C = { ink: "#1F1535", card: "#2E2250", purple: "#6C1ABA", lilac: "#C9B2EE", gold: "#E2BE2B", white: "#FFFFFF", muted: "#CFC6E6" };
const HEAD = "Cambria, Georgia, serif";
const BODY = "Calibri, Arial, sans-serif";
const fps = 30;
const WIN = { x: 40, y: 78, w: 1200, h: 486 };
const MUSIC_VOLUME = 0.26;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

export const totalFrames = (v) => Math.round((v.intro + v.outro + v.steps.reduce((a, s) => a + s.seconds, 0)) * fps);

const Backdrop = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: C.ink, fontFamily: BODY, color: C.white }}>
    <AbsoluteFill style={{ background: "radial-gradient(circle at 88% 8%, rgba(108,26,186,0.6) 0%, rgba(31,21,53,0) 55%)" }} />
    {children}
  </AbsoluteFill>
);

const Wordmark = () => (
  <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 30, letterSpacing: 5, color: C.white }}>
    ELEVATE<span style={{ color: C.gold }}>.</span>
  </div>
);

const Card = ({ kicker, title, sub }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const y = interpolate(f, [0, 20], [26, 0], { extrapolateRight: "clamp" });
  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: "0 110px", justifyContent: "center", opacity: o, transform: `translateY(${y}px)` }}>
        <Wordmark />
        <div style={{ marginTop: 52, display: "inline-block", alignSelf: "flex-start", background: C.gold, color: C.ink, fontWeight: 700, fontSize: 24, letterSpacing: 4, padding: "8px 20px", borderRadius: 999, textTransform: "uppercase" }}>{kicker}</div>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: title.length > 42 ? 62 : 74, lineHeight: 1.1, marginTop: 28, maxWidth: 1000 }}>{title}</div>
        {sub ? <div style={{ marginTop: 26, fontSize: 32, color: C.muted, maxWidth: 940, lineHeight: 1.3 }}>{sub}</div> : null}
      </AbsoluteFill>
    </Backdrop>
  );
};

/** Where the picture sits in the window for a view { s, cx, cy }: scale s, with picture point (cx, cy) in the middle, kept inside the picture. */
function place(view, img) {
  const w = img.w * view.s;
  const h = img.h * view.s;
  const tx = w <= WIN.w ? (WIN.w - w) / 2 : Math.min(0, Math.max(WIN.w - w, WIN.w / 2 - view.cx * view.s));
  const ty = h <= WIN.h ? (WIN.h - h) / 2 : Math.min(0, Math.max(WIN.h - h, WIN.h / 2 - view.cy * view.s));
  return { tx, ty };
}

const Step = ({ video, step, index }) => {
  const f = useCurrentFrame();
  const t0 = 0.35 * fps;
  const p = ease(clamp01((f - t0) / (1.0 * fps)));
  const view = { s: Math.exp(lerp(Math.log(step.from.s), Math.log(step.to.s), p)), cx: lerp(step.from.cx, step.to.cx, p), cy: lerp(step.from.cy, step.to.cy, p) };
  const { tx, ty } = place(view, step.img);
  const fadeIn = interpolate(f, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const capO = interpolate(f, [6, 20], [0, 1], { extrapolateRight: "clamp" });
  const capY = interpolate(f, [6, 22], [18, 0], { extrapolateRight: "clamp" });
  const ringO = step.box ? interpolate(f, [t0 + 0.45 * fps, t0 + 0.95 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const pulse = 0.8 + 0.2 * Math.sin((f / fps) * Math.PI * 2 * 1.2);
  const b = step.box;
  const pad = 8;
  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: fadeIn }}>
        <div style={{ position: "absolute", left: 40, top: 22, background: C.gold, color: C.ink, fontWeight: 700, fontSize: 22, letterSpacing: 3, padding: "6px 16px", borderRadius: 999, textTransform: "uppercase" }}>
          Step {index + 1} of {video.steps.length}
        </div>
        <div style={{ position: "absolute", right: 40, top: 20 }}>
          <Wordmark />
        </div>
        <div style={{ position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, borderRadius: 16, overflow: "hidden", background: "#F6F3FB", boxShadow: "0 18px 50px rgba(0,0,0,0.45), 0 0 0 2px rgba(201,178,238,0.35)" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: step.img.w, height: step.img.h, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${view.s})` }}>
            <Img src={staticFile(step.img.file)} style={{ width: step.img.w, height: step.img.h, display: "block" }} />
            {b ? (
              <div
                style={{
                  position: "absolute",
                  left: b.x - pad,
                  top: b.y - pad,
                  width: b.w + pad * 2,
                  height: b.h + pad * 2,
                  borderRadius: 12 / view.s,
                  border: `${5 / view.s}px solid ${C.gold}`,
                  boxShadow: `0 0 0 ${10 / view.s}px rgba(226,190,43,${0.22 * pulse})`,
                  opacity: ringO,
                }}
              />
            ) : null}
          </div>
        </div>
        <div style={{ position: "absolute", left: 60, right: 60, top: 584, height: 118, display: "flex", alignItems: "center", opacity: capO, transform: `translateY(${capY}px)` }}>
          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: step.caption.length > 56 ? 40 : 46, lineHeight: 1.14 }}>{step.caption}</div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

export const HowTo = ({ video }) => {
  const { narration } = video;
  let at = 0;
  const parts = [];
  const push = (kind, seconds, extra) => {
    const dur = Math.round(seconds * fps);
    parts.push({ kind, from: at, dur, ...extra });
    at += dur;
  };
  push("intro", video.intro, { audio: `${narration.folder}/intro.wav` });
  video.steps.forEach((s, i) => push("step", s.seconds, { step: s, index: i, audio: `${narration.folder}/s${i + 1}.wav` }));
  push("outro", video.outro, { audio: `${narration.folder}/outro.wav` });
  const total = at;
  return (
    <AbsoluteFill>
      {parts.map((p, i) => (
        <Sequence key={i} from={p.from} durationInFrames={p.dur}>
          {p.kind === "intro" ? <Card kicker="How-to" title={video.title} sub={video.intro_text} /> : null}
          {p.kind === "step" ? <Step video={video} step={p.step} index={p.index} /> : null}
          {p.kind === "outro" ? <Card kicker="That is it" title={video.outro_title} sub="The Help center guide has every detail." /> : null}
          <Sequence from={9}>
            <Audio src={staticFile(p.audio)} />
          </Sequence>
        </Sequence>
      ))}
      <Audio src={staticFile(narration.music)} volume={(f) => interpolate(f, [0, 30, total - 60, total], [0, MUSIC_VOLUME, MUSIC_VOLUME, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    </AbsoluteFill>
  );
};

const Root = () => (
  <Composition
    id="HowTo"
    component={HowTo}
    width={1280}
    height={720}
    fps={fps}
    durationInFrames={30 * 60}
    defaultProps={{ video: { title: "Preview", intro: 4, outro: 4, steps: [], narration: { folder: "", music: "music.wav" } } }}
    calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props.video) })}
  />
);

registerRoot(Root);
