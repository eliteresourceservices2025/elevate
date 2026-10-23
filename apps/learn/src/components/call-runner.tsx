"use client";

import { useState } from "react";
import type { CallScenarioView, CallView } from "@/lib/queries";
import { post } from "./api-client";
import { Inline } from "./inline";
import { Meter } from "./interactive-blocks";
import { ListenButton } from "./listen-button";
import { Workstation } from "./workstation";

/**
 * The graded mock call. One step at a time: the caller speaks, the person picks a reply, the server records it and answers with what
 * the caller says next and the new mood. The score and the key never reach this page (docs/learn/14-mock-call.md); leaving and coming
 * back resumes at the next unanswered step because every pick is saved as it is made.
 */
type Progress = Record<string, { answered: number; mood: number }>;
type Pending = { reply: string; callDone: boolean; attemptDone: boolean; optionId: string };

function start(view: CallView): Progress {
  return Object.fromEntries(view.scenarios.map((s) => [s.id, { answered: s.answered.length, mood: s.answered.at(-1)?.moodAfter ?? s.startMood }]));
}

export function CallRunner({ view }: { view: CallView }) {
  const [progress, setProgress] = useState<Progress>(() => start(view));
  const firstOpen = view.scenarios.findIndex((s) => s.answered.length < s.steps.length);
  const [index, setIndex] = useState(firstOpen === -1 ? view.scenarios.length : firstOpen);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const total = view.scenarios.length;
  const allAnswered = view.scenarios.every((s) => (progress[s.id]?.answered ?? 0) >= s.steps.length);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const r = await post("submitCall", { attemptId: view.id });
    if (r.ok) {
      window.location.reload(); // the page now shows the result
      return;
    }
    setBusy(false);
    setMessage(r.error ?? "Please try again.");
  };

  if (index >= total || (allAnswered && !pending)) {
    return (
      <section className="card" aria-label="Finish the mock call">
        <h2>All calls finished</h2>
        <p>You have answered every step. Submit to see your result.</p>
        <button type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? "Scoring..." : "See my result"}
        </button>
        {message ? (
          <p className="feedback bad" role="alert">
            {message}
          </p>
        ) : null}
      </section>
    );
  }

  const scenario: CallScenarioView = view.scenarios[index];
  const state = progress[scenario.id];
  // while a reply is showing, the step just answered stays on screen
  const stepIndex = pending ? state.answered - 1 : state.answered;
  const step = scenario.steps[stepIndex];

  const pick = async (optionId: string) => {
    if (pending || busy) return;
    setBusy(true);
    setMessage(null);
    const r = await post("answerCall", { attemptId: view.id, scenarioId: scenario.id, stepId: step.id, optionId });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "step_out_of_order") {
        window.location.reload();
        return;
      }
      setMessage(r.error ?? "Please try again.");
      return;
    }
    setProgress((p) => ({ ...p, [scenario.id]: { answered: p[scenario.id].answered + 1, mood: Number(r.mood) } }));
    setPending({ reply: String(r.reply), callDone: Boolean(r.callDone), attemptDone: Boolean(r.attemptDone), optionId });
  };

  const next = () => {
    if (pending?.callDone && !pending.attemptDone) setIndex((i) => i + 1);
    setPending(null);
  };

  return (
    <section aria-label={scenario.title}>
      <p className="muted">{`Call ${index + 1} of ${total}`}</p>
      <h2>{scenario.title}</h2>
      {stepIndex === 0 && !pending ? (
        <p>
          <Inline text={scenario.intro} />
        </p>
      ) : null}
      <Workstation kind={step.kind === "note" ? "note" : "phone"} title={scenario.title} record={scenario.record ?? undefined}>
        <Meter label="Caller mood" value={state.mood} />
        {step.kind === "caller" ? (
          <>
            <blockquote key={step.id} className="caller">
              <Inline text={step.text} />
            </blockquote>
            <ListenButton text={step.text} />
          </>
        ) : (
          <p>
            <strong>Call note: </strong>
            {step.text}
          </p>
        )}
        <div role="group" aria-label={step.kind === "caller" ? "Your reply" : "Your note"} className="choices">
          {step.choices.map((c) => (
            <button key={c.id} type="button" className={`choice${pending?.optionId === c.id ? " good" : ""}`} aria-pressed={pending?.optionId === c.id} disabled={busy || pending !== null} onClick={() => void pick(c.id)}>
              {c.text}
            </button>
          ))}
        </div>
        <div role="status" aria-live="polite">
          {pending ? (
            <>
              <blockquote className="caller reply">
                <Inline text={pending.reply} />
              </blockquote>
              <button type="button" onClick={next}>
                {pending.attemptDone ? "Finish the calls" : pending.callDone ? "Next call" : "Continue"}
              </button>
            </>
          ) : null}
        </div>
      </Workstation>
      {message ? (
        <p className="feedback bad" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
