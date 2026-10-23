import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, HEAD, fps, Shell, useSlide } from "./Recap.jsx";
import { Badge, Heading, Icon, mkAt, SCENES } from "./Cs.jsx";

// Animated diagrams for the HIPAA and Cybersecurity videos, drawn from the same pieces as the Customer Service scenes. Importing this
// file registers the scene kinds below in SCENES (src/Cs.jsx), so a storyboard can use them next to hero, icons, flow and the rest.
//   stat      { heading, items:[{value, unit?, label, icon?, say}] }     big numbers that count up
//   chain     { heading, items:[{icon, label, sub?, say}], highlightLast? }  nodes joined by lines that draw themselves
//   timeline  { heading, items:[{when, label, icon?, say}] }             a dated line that fills as each stop appears
//   stack     { heading, items:[{icon, label, sub?, say}] }              layers built from the top down; the last is the floor

/** A number that counts up when its words start. A value that is not a number just appears. */
const CountUp = ({ value, at, size }) => {
  const f = useCurrentFrame();
  const n = Number(String(value).replace(/,/g, ""));
  const t = Math.max(0, Math.min(1, (f / fps - at) / 0.9));
  const eased = 1 - Math.pow(1 - t, 3);
  const shown = Number.isFinite(n) && String(value).trim() !== "" ? Math.round(n * eased).toLocaleString("en-US") : value;
  return <div style={{ fontFamily: HEAD, fontSize: size, fontWeight: 800, color: C.gold, lineHeight: 1 }}>{shown}</div>;
};

const StatCard = ({ it, at, w }) => {
  const p = useSlide(at);
  return (
    <div style={{ width: w, opacity: p, transform: `translateY(${(1 - p) * 50}px) scale(${0.94 + 0.06 * p})`, background: C.card, borderRadius: 26, padding: "34px 18px 30px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
      {it.icon ? <Icon name={it.icon} size={46} color={C.lilac} /> : null}
      <CountUp value={it.value} at={at + 0.1} size={String(it.value).length > 4 ? 84 : 120} />
      {it.unit ? <div style={{ fontSize: 30, fontWeight: 700, color: C.white }}>{it.unit}</div> : null}
      <div style={{ fontSize: 24, color: C.muted, lineHeight: 1.2 }}>{it.label}</div>
    </div>
  );
};

const Stat = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  const n = s.items.length;
  const gap = 26;
  const w = (1100 - (n - 1) * gap) / n;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 90px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", gap, justifyContent: "center" }}>
          {s.items.map((it, i) => (
            <StatCard key={i} it={it} at={at(i)} w={w} />
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const ChainNode = ({ it, at, w, last }) => {
  const p = useSlide(at);
  return (
    <div style={{ width: w, opacity: p, transform: `scale(${0.8 + 0.2 * p})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
      <Badge icon={it.icon} size={118} bg={last ? C.gold : C.purple} color={last ? C.ink : C.white} ring={last ? "rgba(226,190,43,0.4)" : "rgba(201,178,238,0.25)"} />
      <div style={{ fontFamily: HEAD, fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{it.label}</div>
      {it.sub ? <div style={{ fontSize: 22, color: C.muted, lineHeight: 1.2 }}>{it.sub}</div> : null}
    </div>
  );
};

/** A line that draws itself just before the next node appears. */
const ChainLink = ({ at }) => {
  const p = useSlide(Math.max(0, at - 0.35));
  return (
    <div style={{ flex: "none", width: 56, height: 118, display: "flex", alignItems: "center" }}>
      <div style={{ height: 6, width: `${p * 100}%`, background: C.gold, borderRadius: 3 }} />
    </div>
  );
};

const Chain = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  const n = s.items.length;
  const w = (1120 - (n - 1) * 56) / n;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 70px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
          {s.items.map((it, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <ChainLink at={at(i)} /> : null}
              <ChainNode it={it} at={at(i)} w={w} last={i === n - 1 && s.highlightLast !== false} />
            </React.Fragment>
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const TimelineStop = ({ it, at, w }) => {
  const p = useSlide(at);
  return (
    <div style={{ width: w, opacity: p, transform: `translateY(${(1 - p) * 40}px)`, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
      <div style={{ fontFamily: HEAD, fontSize: 40, fontWeight: 800, color: C.gold }}>{it.when}</div>
      <div style={{ width: 22, height: 22, borderRadius: 11, background: C.gold, boxShadow: "0 0 0 8px rgba(226,190,43,0.25)" }} />
      <div style={{ background: C.card, borderRadius: 20, padding: "20px 14px", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {it.icon ? <Icon name={it.icon} size={40} color={C.lilac} /> : null}
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{it.label}</div>
      </div>
    </div>
  );
};

const Timeline = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  const n = s.items.length;
  const gap = 18;
  const w = (1120 - (n - 1) * gap) / n;
  const f = useCurrentFrame();
  const line = Math.max(0, Math.min(1, (f / fps - 0.3) / Math.max(0.5, at(n - 1) + 0.6 - 0.3)));
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 70px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: w / 2, right: w / 2, top: 62, height: 6, background: "rgba(255,255,255,0.12)", borderRadius: 3 }} />
          <div style={{ position: "absolute", left: w / 2, top: 62, height: 6, width: `calc((100% - ${w}px) * ${line})`, background: C.gold, borderRadius: 3 }} />
          <div style={{ display: "flex", gap, position: "relative" }}>
            {s.items.map((it, i) => (
              <TimelineStop key={i} it={it} at={at(i)} w={w} />
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

const StackBar = ({ it, at, floor, widthPct }) => {
  const p = useSlide(at);
  return (
    <div style={{ width: `${widthPct}%`, alignSelf: "center", opacity: p, transform: `translateY(${(1 - p) * -36}px)`, background: floor ? C.purple : C.card, border: `3px solid ${floor ? "#8B45D6" : "#6B5A8F"}`, borderRadius: 18, padding: "16px 28px", display: "flex", alignItems: "center", gap: 22 }}>
      <Badge icon={it.icon} size={64} bg={floor ? C.gold : C.purple} color={floor ? C.ink : C.white} />
      <div>
        <div style={{ fontFamily: HEAD, fontSize: 32, fontWeight: 700 }}>{it.label}</div>
        {it.sub ? <div style={{ fontSize: 22, color: C.muted, lineHeight: 1.2 }}>{it.sub}</div> : null}
      </div>
    </div>
  );
};

/** Layers listed top to bottom. They appear in that order, and the wider bottom layer is the floor everything stands on. */
const Stack = ({ s, cues }) => {
  const at = mkAt(cues, s.lead ? 1 : 0);
  const n = s.items.length;
  return (
    <Shell>
      <AbsoluteFill style={{ padding: "50px 120px 60px", justifyContent: "center" }}>
        <Heading text={s.heading} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {s.items.map((it, i) => (
            <StackBar key={i} it={it} at={at(i)} floor={i === n - 1} widthPct={Math.min(100, 58 + (42 * i) / Math.max(1, n - 1))} />
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
};

Object.assign(SCENES, { stat: Stat, chain: Chain, timeline: Timeline, stack: Stack });
