"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CourseModule } from "@/content/schema";
import { HEARTBEAT_SECONDS, ACTIVITY_PROMPT_SECONDS } from "@/lib/constants";
import { clock, post } from "./api-client";
import { RecapPanel, type RecapView } from "./recap-panel";
import { LessonStage } from "./lesson-stage";
import { celebrate } from "@/lib/celebrate";
import { ChevronRight } from "lucide-react";

/**
 * The module player: one screen at a time. The page tells the server which screens were opened and sends a heartbeat every 30
 * seconds while it is visible and there was recent activity. The SERVER decides what time counts; the clock on this page is only a
 * display. After 5 minutes with no activity the person is asked if they are still there, and the time stops counting meanwhile.
 */
export function ModulePlayer(props: {
  assignmentId: string;
  module: CourseModule;
  seenScreens: number[];
  seconds: number;
  minSeconds: number;
  completed: boolean;
  nextModule: { key: string; title: string } | null;
  /** The optional recap video for this module, when one exists. */
  recap?: RecapView | null;
}) {
  const { assignmentId, module, minSeconds } = props;
  const router = useRouter();
  const total = module.screens.length;
  // Start at the first screen not yet seen (or the last one when everything was seen).
  const firstUnseen = Array.from({ length: total }, (_, i) => i).find((i) => !props.seenScreens.includes(i)) ?? total - 1;
  const [index, setIndex] = useState(firstUnseen);
  // the furthest slide reached, so the step journey lets the person jump back to any slide up to here
  const [reached, setReached] = useState(Math.max(firstUnseen, ...props.seenScreens));
  if (index > reached) setReached(index);
  const [seconds, setSeconds] = useState(props.seconds);
  const [message, setMessage] = useState<string | null>(null);
  const [idle, setIdle] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const seen = useRef(new Set(props.seenScreens));
  const lastInput = useRef(0);
  const idleRef = useRef(false);

  // Mark a screen as seen on the server the first time it is shown.
  const open = useCallback(
    async (i: number) => {
      if (seen.current.has(i)) return;
      seen.current.add(i);
      const r = await post("screen", { assignmentId, moduleKey: module.key, screen: i });
      if (!r.ok) {
        seen.current.delete(i);
        setMessage(r.error ?? "Something went wrong.");
      }
    },
    [assignmentId, module.key],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tells the server this screen was shown; state is only set after the call returns
    void open(index);
  }, [index, open]);

  // Activity: anything the person does resets the idle clock.
  useEffect(() => {
    lastInput.current = Date.now();
    const bump = () => {
      if (!idleRef.current) lastInput.current = Date.now();
    };
    const events = ["pointermove", "pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, []);

  // The heartbeat and the idle check.
  useEffect(() => {
    if (props.completed) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || idleRef.current) return;
      if (Date.now() - lastInput.current > ACTIVITY_PROMPT_SECONDS * 1000) {
        idleRef.current = true;
        setIdle(true);
        return;
      }
      const r = await post("time", { assignmentId, moduleKey: module.key, seconds: HEARTBEAT_SECONDS });
      if (r.ok && typeof r.totalSeconds === "number") setSeconds(r.totalSeconds);
      else if (r.code === "signed_out") setMessage(r.error ?? null);
    }, HEARTBEAT_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [assignmentId, module.key, props.completed]);

  const stillHere = () => {
    idleRef.current = false;
    lastInput.current = Date.now();
    setIdle(false);
  };

  const enough = seconds >= minSeconds;
  const onLast = index === total - 1;
  const screen = module.screens[index];
  const remaining = Math.max(0, minSeconds - seconds);

  const finish = async () => {
    setFinishing(true);
    setMessage(null);
    const r = await post("complete", { assignmentId, moduleKey: module.key });
    setFinishing(false);
    if (r.ok) {
      void celebrate();
      window.setTimeout(() => {
        router.push(`/course/${assignmentId}`);
        router.refresh();
      }, 900);
      return;
    }
    if (typeof r.remainingSeconds === "number") setSeconds(Math.max(seconds, minSeconds - r.remainingSeconds));
    setMessage(r.error ?? "Please try again.");
  };

  const finalAction = props.completed ? (
    <Link className="button stage-btn" href={props.nextModule ? `/course/${assignmentId}/${props.nextModule.key}` : `/course/${assignmentId}`}>
      {props.nextModule ? "Next module" : "Back to the course"} <ChevronRight size={18} aria-hidden="true" />
    </Link>
  ) : (
    <button type="button" className="stage-btn" onClick={() => void finish()} disabled={!enough || finishing}>
      {finishing ? "Saving..." : "Finish this module"}
    </button>
  );

  return (
    <>
      <LessonStage
        title={module.title}
        screens={module.screens}
        index={index}
        onIndex={setIndex}
        reachedIndex={reached}
        backHref={`/course/${assignmentId}`}
        finalAction={finalAction}
        keyPoints={module.keyPoints}
        topExtra={props.recap ? <RecapPanel recap={props.recap} title={module.title} /> : null}
        notes={
          <>
            {!props.completed ? (
              <p className="muted" role="status" aria-live="polite">
                {enough ? "You have spent enough time on this module." : `Reading time: ${clock(seconds)} of ${clock(minSeconds)} needed. Take your time: about ${Math.ceil(remaining / 60)} more minute${Math.ceil(remaining / 60) === 1 ? "" : "s"}.`}
              </p>
            ) : null}
            {message ? (
              <p className="feedback bad" role="alert">
                {message}
              </p>
            ) : null}
          </>
        }
      />
      {idle ? (
        <div className="modal-back">
          <div role="dialog" aria-modal="true" aria-labelledby="idle-title" className="modal">
            <h2 id="idle-title">Are you still there?</h2>
            <p>You have not done anything for 5 minutes, so the timer paused. Your progress is saved.</p>
            <button type="button" autoFocus onClick={stillHere}>
              Yes, continue
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
