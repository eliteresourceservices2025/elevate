import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// One reusable motion-graphics recap: an intro card, one scene per storyboard entry, and an outro card. The words on screen are
// always the captions. When the recap carries a `narration` block (see narrate.cjs) a voice reads each scene and the visuals are
// paced to it; without one the video is silent. Brand: ERS purple and gold on a deep ink background.

export const C = { ink: "#1F1535", card: "#2E2250", cardHi: "#3A2B66", purple: "#6C1ABA", lilac: "#C9B2EE", gold: "#E2BE2B", white: "#FFFFFF", muted: "#CFC6E6", warn: "#F5A8A0" };
export const HEAD = "Cambria, Georgia, serif";
export const BODY = "Calibri, Arial, sans-serif";

export const fps = 30;
// Background music sits well under the voice: about 13 dB below it (measured on the first render at 0.14: 20 dB under was too quiet to hear).
export const MUSIC_VOLUME = 0.3;

export function useAppear(delaySec = 0, durSec = 0.5) {
  const f = useCurrentFrame();
  const start = delaySec * fps;
  return interpolate(f, [start, start + durSec * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

export function useSlide(delaySec = 0) {
  const f = useCurrentFrame();
  const { fps: vfps } = useVideoConfig();
  return spring({ frame: f - delaySec * fps, fps: vfps, config: { damping: 18, stiffness: 120 }, durationInFrames: 22 });
}

export const Shell = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: C.ink, fontFamily: BODY, color: C.white }}>
    <AbsoluteFill style={{ background: "radial-gradient(circle at 85% 12%, rgba(108,26,186,0.55) 0%, rgba(31,21,53,0) 52%)" }} />
    {children}
  </AbsoluteFill>
);

const Heading = ({ text }) => {
  const o = useAppear(0, 0.4);
  return <div style={{ opacity: o, fontSize: 24, letterSpacing: 4, color: C.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 28 }}>{text}</div>;
};

// `pace` is the seconds between one item appearing and the next: short when silent, spread across the voice when narrated.
const Statement = ({ text, pace }) => {
  const f = useCurrentFrame();
  const parts = text.split(" ");
  const per = pace ? Math.max(2.2, (pace * fps) / parts.length) : 2.2;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "0 110px", justifyContent: "center" }}>
        <div style={{ fontFamily: HEAD, fontSize: text.length > 95 ? 50 : 58, fontWeight: 700, lineHeight: 1.22 }}>
          {parts.map((w, i) => {
            const o = interpolate(f, [8 + i * per, 14 + i * per], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <span key={i} style={{ opacity: o, display: "inline-block", marginRight: 14, transform: `translateY(${(1 - o) * 14}px)` }}>
                {w}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const ListScene = ({ heading, items, pace }) => (
  <Shell>
    <AbsoluteFill style={{ padding: "50px 110px 60px", justifyContent: "center" }}>
      <Heading text={heading} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {items.map((t, i) => (
          <ListRow key={i} text={t} delay={0.6 + i * pace} />
        ))}
      </div>
    </AbsoluteFill>
  </Shell>
);

const ListRow = ({ text, delay }) => {
  const p = useSlide(delay);
  return (
    <div style={{ opacity: p, transform: `translateX(${(1 - p) * 60}px)`, background: C.card, borderRadius: 18, padding: "18px 26px", display: "flex", alignItems: "center", gap: 22, fontSize: 34, lineHeight: 1.2 }}>
      <div style={{ width: 44, height: 44, borderRadius: 22, background: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 26, flex: "none" }}>{"✓"}</div>
      <div>{text}</div>
    </div>
  );
};

const StepsScene = ({ heading, items, pace }) => (
  <Shell>
    <AbsoluteFill style={{ padding: "50px 90px 60px", justifyContent: "center" }}>
      <Heading text={heading} />
      <div style={{ display: "flex", gap: 20, alignItems: "stretch" }}>
        {items.map((it, i) => (
          <StepCard key={i} it={it} i={i} n={items.length} delay={0.6 + i * pace} />
        ))}
      </div>
    </AbsoluteFill>
  </Shell>
);

const StepCard = ({ it, i, n, delay }) => {
  const p = useSlide(delay);
  const w = (1100 - (n - 1) * 20) / n;
  return (
    <div style={{ width: w, opacity: p, transform: `translateY(${(1 - p) * 50}px)`, background: C.card, borderRadius: 20, padding: "24px 20px", minHeight: 280 }}>
      <div style={{ width: 54, height: 54, borderRadius: 27, background: C.gold, color: C.ink, fontWeight: 800, fontSize: 30, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>{i + 1}</div>
      <div style={{ fontFamily: HEAD, fontSize: n > 4 ? 28 : 32, fontWeight: 700, marginBottom: 10, lineHeight: 1.15 }}>{it.title}</div>
      <div style={{ fontSize: n > 4 ? 22 : 25, color: C.muted, lineHeight: 1.25 }}>{it.text}</div>
    </div>
  );
};

const LayersScene = ({ heading, items, pace }) => (
  <Shell>
    <AbsoluteFill style={{ padding: "50px 110px 60px", justifyContent: "center" }}>
      <Heading text={heading} />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {items.map((it, i) => (
          <LayerRow key={i} it={it} i={i} delay={0.6 + i * pace} />
        ))}
      </div>
    </AbsoluteFill>
  </Shell>
);

const LayerRow = ({ it, i, delay }) => {
  const p = useSlide(delay);
  const shade = [C.purple, "#5A2A9E", "#4B2D84", "#3E2B6E"][i] || C.card;
  return (
    <div style={{ opacity: p, transform: `scaleX(${0.85 + 0.15 * p})`, transformOrigin: "left", background: shade, borderRadius: 18, padding: "20px 30px", display: "flex", alignItems: "center", gap: 28 }}>
      <div style={{ fontFamily: HEAD, fontSize: 34, fontWeight: 700, width: 380, flex: "none", lineHeight: 1.1 }}>{it.label}</div>
      <div style={{ fontSize: 27, color: "#EFE9FA", lineHeight: 1.22 }}>{it.text}</div>
    </div>
  );
};

const CompareScene = ({ heading, left, right, neutral, rightAt }) => (
  <Shell>
    <AbsoluteFill style={{ padding: "50px 100px 60px", justifyContent: "center" }}>
      <Heading text={heading} />
      <div style={{ display: "flex", gap: 36 }}>
        <Side side={left} dir={-1} good neutral={neutral} delay={0.5} />
        <Side side={right} dir={1} neutral={neutral} delay={rightAt} />
      </div>
    </AbsoluteFill>
  </Shell>
);

const Side = ({ side, dir, good, neutral, delay }) => {
  const p = useSlide(delay);
  return (
    <div style={{ flex: 1, opacity: p, transform: `translateX(${dir * (1 - p) * 90}px)`, background: good ? C.cardHi : C.card, borderRadius: 22, padding: "28px 30px", border: `3px solid ${good ? C.purple : "#6B5A8F"}` }}>
      <div style={{ fontFamily: HEAD, fontSize: 38, fontWeight: 700, marginBottom: 18, color: neutral ? C.gold : good ? C.gold : C.warn }}>{side.title}</div>
      {side.items.map((t, i) => (
        <div key={i} style={{ fontSize: 28, lineHeight: 1.25, marginBottom: 14, display: "flex", gap: 14 }}>
          <span style={{ color: neutral ? C.lilac : good ? C.gold : C.warn, fontWeight: 800 }}>{neutral ? "•" : good ? "✓" : "✕"}</span>
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
};

const TimelineScene = ({ heading, items, pace }) => {
  const grow = useAppear(0.3, Math.max(1.2, items.length * pace));
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 110px 60px", justifyContent: "center" }}>
        <Heading text={heading} />
        <div style={{ position: "relative", paddingLeft: 56 }}>
          <div style={{ position: "absolute", left: 14, top: 8, width: 6, height: `${grow * 100}%`, background: C.purple, borderRadius: 3 }} />
          {items.map((it, i) => (
            <TimelineRow key={i} it={it} delay={0.6 + i * pace} />
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const TimelineRow = ({ it, delay }) => {
  const p = useSlide(delay);
  return (
    <div style={{ opacity: p, transform: `translateX(${(1 - p) * 40}px)`, display: "flex", gap: 28, alignItems: "baseline", marginBottom: 26, position: "relative" }}>
      <div style={{ position: "absolute", left: -50, top: 10, width: 22, height: 22, borderRadius: 11, background: C.gold }} />
      <div style={{ fontFamily: HEAD, fontSize: 34, fontWeight: 700, color: C.gold, width: 300, flex: "none", lineHeight: 1.1 }}>{it.when}</div>
      <div style={{ fontSize: 30, lineHeight: 1.22 }}>{it.text}</div>
    </div>
  );
};

const Intro = ({ recap }) => {
  const p = useSlide(0.1);
  return (
    <AbsoluteFill style={{ backgroundColor: C.purple, fontFamily: BODY, color: C.white, padding: "0 110px", justifyContent: "center" }}>
      <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
        <div style={{ fontSize: 26, letterSpacing: 5, color: C.gold, fontWeight: 700, marginBottom: 22 }}>
          {recap.courseTitle.toUpperCase()} COURSE  |  MODULE {recap.moduleNumber} OF {recap.moduleCount}
        </div>
        <div style={{ fontFamily: HEAD, fontSize: 70, fontWeight: 700, lineHeight: 1.1, maxWidth: 1050 }}>{recap.title}</div>
        <div style={{ marginTop: 34, fontSize: 28, color: "#EDE3F8" }}>Optional recap. Reading the module is the required part.</div>
      </div>
    </AbsoluteFill>
  );
};

const Outro = ({ recap }) => {
  const p = useSlide(0.1);
  return (
    <AbsoluteFill style={{ backgroundColor: C.purple, fontFamily: BODY, color: C.white, padding: "0 110px", justifyContent: "center" }}>
      <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
        <div style={{ fontFamily: HEAD, fontSize: 64, fontWeight: 700, lineHeight: 1.12 }}>Now read the module.</div>
        <div style={{ marginTop: 26, fontSize: 30, color: "#EDE3F8", maxWidth: 1000 }}>The lessons explain each point, with examples and practice. {recap.title}.</div>
      </div>
    </AbsoluteFill>
  );
};

export const Progress = ({ total }) => {
  const f = useCurrentFrame();
  const w = Math.min(1, f / total) * 100;
  return <div style={{ position: "absolute", left: 0, bottom: 0, height: 8, width: `${w}%`, background: C.gold }} />;
};

export const Fade = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, dur - 8, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const itemsOf = (s) => (s.items ? s.items.length : 1);

export const Recap = ({ recap }) => {
  const { durationInFrames } = useVideoConfig();
  // a recorded track (bgm.mp3) is already mastered loud, so it sits lower than the synthesized music
  const musicVolume = recap.narration && recap.narration.music === "bgm.mp3" ? 0.12 : MUSIC_VOLUME;
  const nar = recap.narration || null; // { intro, outro, scenes: [{file, seconds}], introSeconds, outroSeconds, folder }
  let at = 0;
  const parts = [];
  const intro = Math.round(recap.intro * fps);
  parts.push({ from: at, dur: intro, el: <Intro recap={recap} />, audio: nar ? `${nar.folder}/intro.wav` : null });
  at += intro;
  recap.scenes.forEach((s, i) => {
    const dur = Math.round(recap.scenesSeconds[i] * fps);
    const spoken = nar ? nar.scenes[i].seconds : 0;
    const n = itemsOf(s);
    // silent: quick stagger; narrated: spread the items across the time the voice takes
    const pace = nar ? Math.max(0.5, (spoken - 0.8) / Math.max(1, n)) : s.kind === "steps" ? 0.5 : s.kind === "timeline" ? 0.5 : 0.35;
    let el;
    switch (s.kind) {
      case "statement": el = <Statement text={s.text} pace={nar ? spoken * 0.8 : 0} />; break;
      case "list": el = <ListScene heading={s.heading} items={s.items} pace={pace} />; break;
      case "steps": el = <StepsScene heading={s.heading} items={s.items} pace={pace} />; break;
      case "layers": el = <LayersScene heading={s.heading} items={s.items} pace={nar ? pace : 0.45} />; break;
      case "compare": el = <CompareScene heading={s.heading} left={s.left} right={s.right} neutral={s.neutral} rightAt={nar ? 0.5 + spoken * 0.5 : 0.5} />; break;
      case "timeline": el = <TimelineScene heading={s.heading} items={s.items} pace={pace} />; break;
      default: el = null;
    }
    parts.push({ from: at, dur, el, audio: nar ? `${nar.folder}/s${i + 1}.wav` : null });
    at += dur;
  });
  const outro = Math.round(recap.outro * fps);
  parts.push({ from: at, dur: outro, el: <Outro recap={recap} />, audio: nar ? `${nar.folder}/outro.wav` : null });
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      {parts.map((p, i) => (
        <Sequence key={i} from={p.from} durationInFrames={p.dur}>
          <Fade dur={p.dur}>{p.el}</Fade>
          {p.audio ? (
            <Sequence from={9}>
              <Audio src={staticFile(p.audio)} />
            </Sequence>
          ) : null}
        </Sequence>
      ))}
      {nar && nar.music ? <Audio src={staticFile(nar.music)} volume={(f) => interpolate(f, [0, 30, durationInFrames - 75, durationInFrames], [0, musicVolume, musicVolume, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} /> : null}
      <Progress total={durationInFrames} />
    </AbsoluteFill>
  );
};

export const totalFrames = (recap) =>
  Math.round(recap.intro * fps) + recap.scenesSeconds.reduce((n, s) => n + Math.round(s * fps), 0) + Math.round(recap.outro * fps);
