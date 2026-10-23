import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, HEAD, BODY, fps, MUSIC_VOLUME, Shell, Fade, Progress, useSlide, useAppear } from "./Recap.jsx";
import { ICONS } from "./icons.js";

// Customer Service Excellence videos: mostly graphics (icons, cards, chat bubbles), a few words on screen, and a Zira voice-over that
// carries the detail. Every thing on screen appears exactly when its words start (the cues come from narrate-cs.cjs). Same brand
// look as the recap videos. The full spoken text is in transcripts.md.

const LEAD_IN = 0.3; // the audio starts 9 frames into each scene (see <Sequence from={9}> below)
const GOOD = "#7FD6A3";
const BAD = "#F5A8A0";

export const Icon = ({ name, size = 48, color = C.white, stroke = 2 }) => {
  const nodes = ICONS[name];
  if (!nodes) throw new Error("Unknown icon: " + name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {nodes.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
};

export const Badge = ({ icon, size = 96, bg = C.purple, color = C.white, ring }) => (
  <div style={{ width: size, height: size, borderRadius: size / 2, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", boxShadow: ring ? `0 0 0 6px ${ring}` : "none" }}>
    <Icon name={icon} size={size * 0.52} color={color} />
  </div>
);

export const Heading = ({ text }) => {
  const o = useAppear(0, 0.4);
  if (!text) return null;
  return <div style={{ opacity: o, fontSize: 24, letterSpacing: 4, color: C.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 26 }}>{text}</div>;
};

// seconds into the scene at which beat k should appear
export const mkAt = (cues, offset) => (k) => Math.max(0, LEAD_IN + (cues[offset + k] ?? 0) - 0.12);

const Hero = ({ s, cues }) => {
  const p = useSlide(0.15);
  const q = useSlide(LEAD_IN + (cues[0] ?? 0));
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "0 110px", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ opacity: p, transform: `scale(${0.7 + 0.3 * p})` }}>
          <Badge icon={s.icon} size={190} bg={C.purple} ring="rgba(226,190,43,0.35)" />
        </div>
        <div style={{ opacity: q, transform: `translateY(${(1 - q) * 24}px)`, marginTop: 38 }}>
          <div style={{ fontFamily: HEAD, fontSize: s.title.length > 40 ? 58 : 68, fontWeight: 700, lineHeight: 1.12 }}>{s.title}</div>
          {s.sub && s.sub.length > 100 ? (
            <div style={{ marginTop: 22, background: C.card, borderRadius: 20, padding: "22px 30px", fontSize: 28, lineHeight: 1.3, textAlign: "left", maxWidth: 980 }}>{s.sub}</div>
          ) : s.sub ? (
            <div style={{ marginTop: 20, fontSize: 32, color: C.muted }}>{s.sub}</div>
          ) : null}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const IconCard = ({ it, at, w, accent, big }) => {
  const p = useSlide(at);
  const small = w < 280 && !big;
  const badge = big ? (w >= 330 ? 130 : w >= 250 ? 116 : 100) : small ? 84 : 104;
  return (
    <div style={{ width: w, opacity: p, transform: `translateY(${(1 - p) * 44}px) scale(${0.94 + 0.06 * p})`, background: C.card, borderRadius: 24, padding: big ? "46px 12px 42px" : small ? "26px 12px 24px" : "30px 18px 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: big ? 26 : small ? 14 : 20, textAlign: "center" }}>
      <Badge icon={it.icon} size={badge} bg={accent || C.purple} color={accent === C.gold ? C.ink : C.white} />
      <div style={{ fontFamily: HEAD, fontSize: w >= 330 ? 34 : w >= 280 ? 30 : w >= 190 ? 25 : 22, fontWeight: 700, lineHeight: 1.12 }}>{it.label}</div>
    </div>
  );
};

const Icons = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  const n = s.items.length;
  const cols = s.cols || (n <= 4 ? n : n <= 6 ? 3 : 4);
  const gap = 24;
  const w = (1100 - (cols - 1) * gap) / cols;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 90px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", flexWrap: "wrap", gap, justifyContent: "center" }}>
          {s.items.map((it, i) => (
            <IconCard key={i} it={it} at={at(i)} w={w} big={n <= cols} />
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const Sym = ({ ch, at }) => {
  const p = useSlide(at);
  return <div style={{ opacity: p, fontFamily: HEAD, fontSize: 64, fontWeight: 700, color: C.gold, flex: "none", transform: `scale(${0.6 + 0.4 * p})` }}>{ch}</div>;
};

const Formula = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  const n = s.items.length;
  const w = (1140 - n * 44 - 2 * n * 16) / (n + 1);
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 70px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center" }}>
          {s.items.map((it, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <Sym ch="+" at={at(i)} /> : null}
              <IconCard it={it} at={at(i)} w={w} big />
            </React.Fragment>
          ))}
          <Sym ch="=" at={at(n)} />
          <IconCard it={s.result} at={at(n)} w={w} accent={C.gold} big />
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const FlowCard = ({ it, at, w, letters, small }) => {
  const p = useSlide(at);
  return (
    <div style={{ width: w, opacity: p, transform: `translateY(${(1 - p) * 50}px)`, background: C.card, borderRadius: 22, padding: small ? "22px 12px" : "26px 18px", minHeight: small ? 0 : 340, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }}>
      {letters ? (
        <div style={{ fontFamily: HEAD, fontSize: 112, fontWeight: 800, color: C.gold, lineHeight: 1 }}>{it.big}</div>
      ) : (
        <div style={{ width: 58, height: 58, borderRadius: 29, background: C.gold, color: C.ink, fontWeight: 800, fontSize: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>{it.big}</div>
      )}
      {it.icon ? <Icon name={it.icon} size={letters ? 44 : 52} color={C.lilac} /> : null}
      <div style={{ fontFamily: HEAD, fontSize: small ? 28 : 32, fontWeight: 700, lineHeight: 1.12 }}>{it.label}</div>
      {it.sub ? <div style={{ fontSize: small ? 20 : 24, color: C.muted, lineHeight: 1.2 }}>{it.sub}</div> : null}
    </div>
  );
};

const Flow = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  const n = s.items.length;
  const gap = 14;
  const perRow = n > 5 ? Math.ceil(n / 2) : n;
  const w = (1120 - (perRow - 1) * gap) / perRow;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 80px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", gap, flexWrap: "wrap", justifyContent: "center" }}>
          {s.items.map((it, i) => (
            <FlowCard key={i} it={it} at={at(i)} w={w} letters={s.letters} small={n > 5} />
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const SwapCard = ({ text, at, good, w }) => {
  const p = useSlide(at);
  const col = good ? GOOD : BAD;
  return (
    <div style={{ width: w, opacity: p, transform: `translateX(${(good ? 1 : -1) * (1 - p) * 70}px)`, background: good ? C.cardHi : C.card, border: `3px solid ${good ? "#3E8F63" : "#8A5A66"}`, borderRadius: 22, padding: "22px 26px", display: "flex", gap: 18, alignItems: "flex-start" }}>
      <Badge icon={good ? "check" : "x"} size={54} bg={col} color={C.ink} />
      <div>
        <div style={{ fontSize: 20, letterSpacing: 3, fontWeight: 700, color: col, textTransform: "uppercase", marginBottom: 6 }}>{good ? "Say" : "Instead of"}</div>
        <div style={{ fontSize: text.length > 80 ? 25 : 29, lineHeight: 1.22 }}>{text}</div>
      </div>
    </div>
  );
};

const Swap = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 80px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {s.items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 28, alignItems: "stretch" }}>
              <SwapCard text={it.bad} at={at(2 * i)} w={520} />
              <div style={{ alignSelf: "center" }}>
                <Icon name="arrow-right" size={44} color={C.gold} />
              </div>
              <SwapCard text={it.good} at={at(2 * i + 1)} w={520} good />
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const Bubble = ({ line, at, active, compact, roles }) => {
  const p = useSlide(at);
  const rep = line.who === "rep";
  return (
    <div style={{ display: "flex", flexDirection: rep ? "row-reverse" : "row", alignItems: "center", gap: 20, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ flex: "none" }}>
        <Badge icon={rep ? "headset" : "user"} size={compact ? 62 : 78} bg={rep ? C.purple : C.gold} color={rep ? C.white : C.ink} ring={active ? (rep ? "rgba(201,178,238,0.6)" : "rgba(226,190,43,0.55)") : undefined} />
      </div>
      <div style={{ maxWidth: 820, background: rep ? C.purple : C.card, border: `3px solid ${rep ? "#8B45D6" : "#6B5A8F"}`, borderRadius: rep ? "26px 6px 26px 26px" : "6px 26px 26px 26px", padding: compact ? "10px 22px" : "16px 26px" }}>
        <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 2, color: rep ? C.lilac : C.gold, textTransform: "uppercase", marginBottom: 4 }}>{rep ? (roles && roles.rep) || "Representative" : (roles && roles.family) || "Family member"}</div>
        <div style={{ fontSize: compact ? (line.text.length > 130 ? 22 : 25) : line.text.length > 130 ? 24 : 28, lineHeight: 1.22 }}>{line.text}</div>
      </div>
    </div>
  );
};

const Dialogue = ({ s, cues, durs }) => {
  const f = useCurrentFrame();
  const off = s.lead ? 1 : 0;
  const at = mkAt(cues, off);
  const compact = s.lines.length > 3;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "40px 90px 56px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        {s.scenario ? (
          <div style={{ opacity: useAppear(0.2, 0.5), alignSelf: "flex-start", background: C.card, borderRadius: 14, padding: "10px 20px", display: "flex", gap: 12, alignItems: "center", fontSize: 24, color: C.muted, marginBottom: 22 }}>
            <Icon name="phone-call" size={26} color={C.gold} />
            {s.scenario}
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 12 : 18 }}>
          {s.lines.map((l, i) => {
            const t0 = at(i) + 0.12;
            const d = durs[off + i] ?? 2;
            const active = f >= t0 * fps && f <= (t0 + d + 0.15) * fps;
            return <Bubble key={i} line={l} at={at(i)} active={active} compact={compact} roles={s.roles} />;
          })}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const CheckRow = ({ text, at, icon }) => {
  const p = useSlide(at);
  return (
    <div style={{ opacity: p, transform: `translateX(${(1 - p) * 60}px)`, background: C.card, borderRadius: 18, padding: "16px 26px", display: "flex", alignItems: "center", gap: 22 }}>
      <Badge icon={icon || "check"} size={52} bg={GOOD} color={C.ink} />
      <div style={{ fontSize: 33, lineHeight: 1.2 }}>{text}</div>
    </div>
  );
};

const Checklist = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  const two = s.items.length > 5;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 100px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14, ...(two ? {} : {}) }}>
          {s.items.map((it, i) => (
            <CheckRow key={i} text={it.text} at={at(i)} icon={it.icon} />
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const Side = ({ side, good, startAt, at }) => {
  const p = useSlide(startAt);
  const col = good ? GOOD : BAD;
  return (
    <div style={{ flex: 1, opacity: p, transform: `translateX(${(good ? -1 : 1) * (1 - p) * 80}px)`, background: good ? C.cardHi : C.card, borderRadius: 24, padding: "26px 28px", border: `3px solid ${good ? "#3E8F63" : "#8A5A66"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <Badge icon={side.icon || (good ? "thumbs-up" : "thumbs-down")} size={64} bg={col} color={C.ink} />
        <div style={{ fontFamily: HEAD, fontSize: 36, fontWeight: 700, color: good ? C.gold : BAD }}>{side.title}</div>
      </div>
      {side.items.map((it, i) => (
        <CompareItem key={i} text={it.text} good={good} at={at(i)} />
      ))}
    </div>
  );
};

const CompareItem = ({ text, good, at }) => {
  const p = useSlide(at);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 16}px)`, fontSize: 28, lineHeight: 1.22, marginBottom: 14, display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ marginTop: 2, flex: "none" }}>
        <Icon name={good ? "check" : "x"} size={30} color={good ? GOOD : BAD} stroke={3} />
      </div>
      <span>{text}</span>
    </div>
  );
};

const Compare = ({ s, cues }) => {
  const off = s.lead ? 1 : 0;
  const at = mkAt(cues, off);
  const nl = s.left.items.length;
  // the left side's card is the "bad" or the "good" side as the storyboard says (default: left = avoid, right = instead)
  const leftGood = !!s.leftGood;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 90px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", gap: 32 }}>
          <Side side={s.left} good={leftGood} startAt={at(0)} at={(i) => at(i)} />
          <Side side={s.right} good={!leftGood} startAt={at(nl)} at={(i) => at(nl + i)} />
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const Intro = ({ v }) => {
  const p = useSlide(0.1);
  return (
    <AbsoluteFill style={{ backgroundColor: C.purple, fontFamily: BODY, color: C.white, padding: "0 110px", justifyContent: "center" }}>
      <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 26 }}>
          <Badge icon={v.icon || "headset"} size={84} bg={C.gold} color={C.ink} />
          <div style={{ fontSize: 26, letterSpacing: 5, color: C.gold, fontWeight: 700 }}>
            {v.label || `CUSTOMER SERVICE EXCELLENCE  |  VIDEO ${v.n} OF ${v.count}`}
          </div>
        </div>
        <div style={{ fontFamily: HEAD, fontSize: 70, fontWeight: 700, lineHeight: 1.1, maxWidth: 1050 }}>{v.title}</div>
        <div style={{ marginTop: 30, fontSize: 28, color: "#EDE3F8" }}>{v.tagline || "Mastering family support calls"}</div>
      </div>
    </AbsoluteFill>
  );
};

const OUTRO = [
  { icon: "ear", word: "Listen" },
  { icon: "lightbulb", word: "Understand" },
  { icon: "target", word: "Act" },
  { icon: "route", word: "Follow through" },
];

const OutroItem = ({ it, at }) => {
  const p = useSlide(at);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px) scale(${0.9 + 0.1 * p})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: 270, textAlign: "center" }}>
      <Badge icon={it.icon} size={110} bg={C.gold} color={C.ink} />
      <div style={{ fontFamily: HEAD, fontSize: 36, fontWeight: 700, whiteSpace: "nowrap" }}>{it.word}</div>
    </div>
  );
};

const Outro = ({ cues, items }) => (
  <AbsoluteFill style={{ backgroundColor: C.purple, fontFamily: BODY, color: C.white, justifyContent: "center", alignItems: "center" }}>
    <div style={{ display: "flex", gap: 10 }}>
      {(items || OUTRO).map((it, i) => (
        <OutroItem key={i} it={it} at={Math.max(0, LEAD_IN + (cues[i] ?? 0) - 0.12)} />
      ))}
    </div>
  </AbsoluteFill>
);

export const SCENES = { hero: Hero, icons: Icons, formula: Formula, flow: Flow, swap: Swap, dialogue: Dialogue, checklist: Checklist, compare: Compare };

// Subtitles for people who cannot hear the narration: the words of the voice-over, shown while they are spoken (video.captions, from customer-service/captions.cjs).
const Captions = ({ list }) => {
  const f = useCurrentFrame();
  const c = (list || []).find((x) => f >= x.from && f < x.to);
  if (!c) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 30, pointerEvents: "none" }}>
      <div style={{ maxWidth: 1040, background: "rgba(20,12,36,0.88)", color: "#fff", fontFamily: BODY, fontSize: 31, lineHeight: 1.3, fontWeight: 600, padding: "10px 24px", borderRadius: 12, textAlign: "center" }}>{c.text}</div>
    </AbsoluteFill>
  );
};

export const CsVideo = ({ video }) => {
  const { durationInFrames } = useVideoConfig();
  const nar = video.narration;
  // a recorded track (bgm.mp3) is already mastered loud, so it sits lower than the synthesized music
  const musicVolume = nar.music === "bgm.mp3" ? 0.12 : MUSIC_VOLUME;
  let at = 0;
  const parts = [];
  const intro = Math.round(video.intro * fps);
  parts.push({ from: at, dur: intro, el: <Intro v={video} />, audio: `${nar.folder}/intro.wav` });
  at += intro;
  video.scenes.forEach((s, i) => {
    const dur = Math.round(video.scenesSeconds[i] * fps);
    const Comp = SCENES[s.kind];
    if (!Comp) throw new Error("Unknown scene kind " + s.kind);
    const ns = nar.scenes[i];
    parts.push({ from: at, dur, el: <Comp s={s} cues={ns.cues} durs={ns.durs} />, audio: `${nar.folder}/s${i + 1}.wav` });
    at += dur;
  });
  const outro = Math.round(video.outro * fps);
  parts.push({ from: at, dur: outro, el: <Outro cues={nar.outroCues} items={video.outroItems} />, audio: `${nar.folder}/outro.wav` });
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      {/* the picture sits a little smaller so the subtitles have their own strip underneath and never cover a slide */}
      <div style={{ position: "absolute", top: 14, left: 0, width: 1280, height: 720, transform: "scale(0.855)", transformOrigin: "50% 0", borderRadius: 18, overflow: "hidden" }}>
      {parts.map((p, i) => (
        <Sequence key={i} from={p.from} durationInFrames={p.dur}>
          <Fade dur={p.dur}>{p.el}</Fade>
          <Sequence from={9}>
            <Audio src={staticFile(p.audio)} />
          </Sequence>
        </Sequence>
      ))}
      </div>
      <Audio src={staticFile(nar.music)} volume={(f) => interpolate(f, [0, 30, durationInFrames - 75, durationInFrames], [0, musicVolume, musicVolume, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      <Captions list={video.captions} />
      <Progress total={durationInFrames} />
    </AbsoluteFill>
  );
};

export const csTotalFrames = (v) => Math.round(v.intro * fps) + v.scenesSeconds.reduce((n, s) => n + Math.round(s * fps), 0) + Math.round(v.outro * fps);
