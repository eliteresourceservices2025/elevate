"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ChevronLeft, ChevronRight, ListChecks, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Screen } from "@/content/schema";
import { GATED_TYPES, GateProvider, useGateState } from "./block-gate";
import { ContentBlocks } from "./content-blocks";
import { ThemeToggle } from "./theme-toggle";

/**
 * The lesson stage: a full-screen frame with one slide at a time, a step journey along the top and Previous / Next fixed at the
 * bottom. It only shows and moves; what counts as read time or completion stays in the module player and on the server.
 * A slide that is still too long for the screen scrolls inside its own card, never the page. All motion follows the device's
 * "reduce motion" setting.
 */
export function LessonStage(props: {
  title: string;
  screens: Screen[];
  index: number;
  onIndex: (i: number) => void;
  /** The furthest slide the person has reached; the journey lets them jump back to any slide up to here. */
  reachedIndex: number;
  backHref: string;
  /** Shown instead of Next on the last slide (finish / next module). */
  finalAction: React.ReactNode;
  /** Key points, shown under the last slide. */
  keyPoints?: string[];
  /** Under the header (the recap video, for example). */
  topExtra?: React.ReactNode;
  /** Under the footer buttons (reading time, messages). */
  notes?: React.ReactNode;
  /** False when a finished course is read again: Next does not wait for answers. */
  gated?: boolean;
}) {
  const { screens, index, onIndex, reachedIndex } = props;
  const total = screens.length;
  const screen = screens[index];
  const onLast = index === total - 1;
  // which way the person moved, so the slide enters from the right going forward and from the left going back
  const [prev, setPrev] = useState(index);
  const [direction, setDirection] = useState<1 | -1>(1);
  if (prev !== index) {
    setDirection(index > prev ? 1 : -1);
    setPrev(index);
  }
  const bodyRef = useRef<HTMLDivElement>(null);
  // The outline: every step by name, with where you are and which ones you can open.
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Next waits for every quiz, game or sort on the slide to be answered. A slide the person already finished stays open if they come back.
  const { pending, total: blockCount, gate } = useGateState(screen.id);
  const [finished, setFinished] = useState<string[]>([]);
  const answered = finished.includes(screen.id);
  // a slide with gated blocks waits until they have mounted and been answered (blockCount is 0 while the old slide is still fading out)
  const hasGated = screen.blocks.some((b) => GATED_TYPES.has(b.type));
  const waiting = props.gated !== false && hasGated && !answered && (blockCount === 0 || pending > 0);
  if (blockCount > 0 && pending === 0 && !answered) setFinished([...finished, screen.id]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [index]);

  // Arrow keys move between slides, except while someone is typing or using a control that needs them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t?.closest("[role='dialog'], [data-dnd-handle]")) return;
      if (e.key === "ArrowRight" && index < total - 1 && !waiting) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, total, onIndex, waiting]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="stage" role="region" aria-label={props.title}>
        <header className="stage-head">
          <Link href={props.backHref} className="stage-close" aria-label="Back to the course">
            <X size={20} aria-hidden="true" />
          </Link>
          <div className="stage-title">
            <h1 title={props.title}>{props.title}</h1>
            <span className="muted">
              Step {index + 1} of {total}
            </span>
          </div>
          <button type="button" className="secondary outline-toggle" aria-expanded={outlineOpen} aria-controls="lesson-outline" onClick={() => setOutlineOpen((o) => !o)}>
            <ListChecks size={16} aria-hidden="true" /> <span>Steps</span>
          </button>
          <ThemeToggle />
        </header>
        {outlineOpen ? (
          <nav id="lesson-outline" className="outline" aria-label="All steps in this module">
            <ol>
              {screens.map((s, i) => {
                const reachable = i <= Math.max(reachedIndex, index);
                const state = i === index ? "You are here" : i <= reachedIndex ? "Seen" : "Opens after the steps before it";
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`outline-item${i === index ? " here" : ""}`}
                      disabled={!reachable}
                      aria-current={i === index ? "step" : undefined}
                      onClick={() => {
                        onIndex(i);
                        setOutlineOpen(false);
                      }}
                    >
                      <span className="outline-num">{i + 1}</span>
                      <span className="outline-title">{s.title}</span>
                      <span className="outline-state muted small">{state}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}
        <nav className="journey" aria-label="Steps in this module">
          {screens.map((s, i) => {
            const reachable = i <= Math.max(reachedIndex, index);
            return (
              <button
                key={s.id}
                type="button"
                className={`journey-step${i === index ? " here" : ""}${i < index ? " done" : ""}`}
                aria-label={`Step ${i + 1} of ${total}: ${s.title}`}
                title={s.title}
                aria-current={i === index ? "step" : undefined}
                disabled={!reachable}
                onClick={() => onIndex(i)}
              />
            );
          })}
        </nav>
        {props.topExtra ? <div className="stage-extra">{props.topExtra}</div> : null}
        <div className="stage-body" ref={bodyRef}>
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.article
              key={screen.id}
              className="slide"
              aria-live="polite"
              custom={direction}
              initial={{ opacity: 0, x: direction * 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -48 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <h2>{screen.title}</h2>
              <GateProvider value={gate}>
                <ContentBlocks blocks={screen.blocks} />
              </GateProvider>
              {onLast && props.keyPoints?.length ? (
                <aside className="block callout tip">
                  <strong>Key points</strong>
                  <ul>
                    {props.keyPoints.map((k) => (
                      <li key={k}>{k}</li>
                    ))}
                  </ul>
                </aside>
              ) : null}
            </motion.article>
          </AnimatePresence>
        </div>
        <footer className="stage-foot">
          <div className="stage-nav">
            <button type="button" className="secondary stage-btn" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0}>
              <ChevronLeft size={18} aria-hidden="true" /> Previous
            </button>
            {onLast ? (
              <div inert={waiting} className={waiting ? "stage-final waiting" : "stage-final"}>
                {props.finalAction}
              </div>
            ) : (
              <button type="button" className="stage-btn" disabled={waiting} onClick={() => onIndex(Math.min(total - 1, index + 1))}>
                Next <ChevronRight size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="muted small stage-hint" role="status" aria-live="polite">
            {waiting ? (pending <= 1 ? "Answer the question or finish the activity above to continue." : "Answer the questions or finish the activities above to continue.") : ""}
          </p>
          {props.notes ? <div className="stage-notes">{props.notes}</div> : null}
        </footer>
      </div>
    </MotionConfig>
  );
}
