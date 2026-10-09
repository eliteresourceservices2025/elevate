"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { completeTour } from "@/modules/dashboard/tour-actions";
import { START_TOUR_EVENT } from "./tour-events";
import { TOUR_STEPS, placeCard, usableSteps, type Rect, type ResolvedStep } from "./tour-steps";

/**
 * The quick tour: a short walk through the header and the menu, one tooltip at a time, with a spotlight on what it points at.
 * It starts by itself for a new account (autoStart) and can be replayed by anyone: from the account menu (an event) or from
 * Settings (the address ?tour=1). Skipping or finishing records that it was seen, so it stops starting by itself. It respects
 * "reduce motion", works with the keyboard (arrows, Enter, Escape) and holds focus inside the tooltip while it is open.
 */
export function QuickTour({ autoStart }: { autoStart: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const [steps, setSteps] = useState<ResolvedStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState({ width: 340, height: 200 });
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const autoStarted = useRef(false);

  const step = steps?.[index] ?? null;
  const open = steps !== null;

  const start = useCallback(() => {
    const onScreen = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    setIndex(0);
    setSteps(usableSteps(TOUR_STEPS, onScreen));
  }, []);

  const finish = useCallback(() => {
    setSteps(null);
    void completeTour();
  }, []);

  // Three ways in: by itself for a new account, from the account menu, and from Settings (?tour=1, which is then taken off the address).
  useEffect(() => {
    if (!autoStart) return;
    // Let the page settle first. The guard is inside the timer so a development double-run of this effect cannot cancel the start.
    const t = window.setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      start();
    }, 900);
    return () => window.clearTimeout(t);
  }, [autoStart, start]);
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, [start]);
  useEffect(() => {
    if (params.get("tour") !== "1") return;
    const rest = new URLSearchParams(params.toString());
    rest.delete("tour");
    router.replace(rest.size > 0 ? `${pathname}?${rest}` : pathname, { scroll: false });
    const t = window.setTimeout(start, 500);
    return () => window.clearTimeout(t);
  }, [params, pathname, router, start]);

  // Follow the thing being pointed at (it can move: a scroll, a resized window, the menu opening).
  useLayoutEffect(() => {
    if (!step) return;
    const el = step.selector ? document.querySelector(step.selector) : null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setViewport({ width: window.innerWidth, height: window.innerHeight });
        if (cardRef.current) setCard({ width: cardRef.current.offsetWidth, height: cardRef.current.offsetHeight });
        if (!el) return setRect(null);
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // Focus goes to the main button of each step; the keyboard drives the tour.
  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open, index]);
  useEffect(() => {
    if (!open) return;
    const last = (steps?.length ?? 1) - 1;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, last));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      else if (e.key === "Tab" && cardRef.current) {
        const items = [...cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
        if (items.length === 0) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !cardRef.current.contains(active))) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && (active === lastItem || !cardRef.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, steps, finish]);

  if (!open || !step || !steps || typeof document === "undefined") return null;

  const isLast = index === steps.length - 1;
  const place = placeCard(rect, viewport, card);
  const pad = 6;
  const spot = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  const move = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 320, damping: 34 };
  const cardStyle = place.docked ? { position: "fixed" as const, left: 12, right: 12, bottom: 12 } : { position: "fixed" as const, top: place.top, left: place.left, width: Math.min(340, viewport.width - 24) };

  return createPortal(
    <div className="fixed inset-0 z-[80]" data-quick-tour>
      {/* Catches every click so nothing behind the tour can be pressed while it is open */}
      <div className="absolute inset-0" aria-hidden />
      {spot ? (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed rounded-xl ring-2 ring-white/90"
          style={{ boxShadow: "0 0 0 9999px rgb(18 10 36 / 0.62)" }}
          initial={false}
          animate={spot}
          transition={move}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[rgb(18_10_36/0.62)]" />
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          className="rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl"
          style={cardStyle}
          initial={reduce ? false : { opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6, transition: { duration: 0.12 } }}
          transition={reduce ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
        >
          <p className="text-xs font-medium text-muted-foreground">
            Step {index + 1} of {steps.length}
          </p>
          <h2 id="tour-title" className="mt-1 font-heading text-lg font-bold">
            {step.title}
          </h2>
          <p id="tour-body" className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {step.body}
          </p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={finish}>
              {isLast ? "Close" : "Skip tour"}
            </Button>
            <div className="flex gap-2">
              {index > 0 ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setIndex((i) => i - 1)}>
                  Back
                </Button>
              ) : null}
              <Button ref={primaryRef} type="button" size="sm" onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}>
                {isLast ? "Done" : index === 0 ? "Start" : "Next"}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}
