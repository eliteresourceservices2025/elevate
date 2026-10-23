"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExamItem } from "@/lib/queries";
import { clock, post } from "./api-client";
import { ListenButton } from "./listen-button";

const LETTER = ["A", "B", "C", "D", "E", "F"];
/** What the browser reads when there are no recorded clips: the question, then each choice in the order shown. Never the answer or the reason. */
const examSpeech = (item: ExamItem) =>
  [item.stem, item.type === "multiple" ? "Select all that apply." : "Choose one answer.", ...item.options.map((o, i) => `Option ${LETTER[i]}. ${o.text}`)].join(" ");
/** The recorded clips, in reading order, only when every one of them exists (otherwise the browser reads it). */
const examClips = (item: ExamItem): string[] => {
  const all = [item.audio.stem, ...item.audio.options.flatMap((o) => [o.letter, o.text])];
  return all.every(Boolean) ? (all as string[]) : [];
};

/**
 * The exam: one question at a time, each answer saved as it is chosen. The countdown is only a display (the server has the real
 * deadline and refuses answers after it). The answer key is not on this page at all.
 */
export function ExamRunner({ attemptId, items, deadlineAt, serverNow }: { attemptId: string; items: ExamItem[]; deadlineAt: string | null; serverNow: string }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => Object.fromEntries(items.map((i) => [i.questionId, i.selected])));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Remaining time from the server's clock at page load, so a wrong device clock does not matter.
  const offset = useRef(0);
  const [remaining, setRemaining] = useState<number | null>(() => (deadlineAt ? Math.max(0, Math.floor((Date.parse(deadlineAt) - Date.parse(serverNow)) / 1000)) : null));
  const submitted = useRef(false);

  const item = items[index];
  const answered = useMemo(() => items.filter((i) => (answers[i.questionId] ?? []).length > 0).length, [items, answers]);

  const submit = async () => {
    if (submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    const r = await post("submit", { attemptId });
    if (r.ok) {
      router.refresh();
      return;
    }
    submitted.current = false;
    setSubmitting(false);
    setError(r.error ?? "Please try again.");
  };

  useEffect(() => {
    if (!deadlineAt) return;
    offset.current = Date.parse(serverNow) - Date.now();
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.floor((Date.parse(deadlineAt) - (Date.now() + offset.current)) / 1000));
      setRemaining(left);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt, serverNow]);

  // Time is up: the server grades what was saved before the deadline.
  useEffect(() => {
    if (remaining === 0 && deadlineAt && !submitted.current) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- submit is stable enough; this must run only when the countdown reaches zero
  }, [remaining]);

  const choose = async (optionId: string) => {
    const current = answers[item.questionId] ?? [];
    const multiple = item.type === "multiple";
    const next = multiple ? (current.includes(optionId) ? current.filter((x) => x !== optionId) : [...current, optionId]) : [optionId];
    setAnswers((a) => ({ ...a, [item.questionId]: next }));
    setSaveState("saving");
    const r = await post("answer", { attemptId, questionId: item.questionId, selected: next });
    setSaveState(r.ok ? "saved" : "failed");
    if (!r.ok) setError(r.error ?? null);
    else setError(null);
  };

  const low = remaining !== null && remaining <= 120;

  return (
    <div className="player">
      <div className="exam-bar">
        <span>
          Question {index + 1} of {items.length}
        </span>
        {remaining !== null ? (
          <span className={low ? "timer low" : "timer"} role="timer" aria-label={`Time left ${clock(remaining)}`}>
            {clock(remaining)} left
          </span>
        ) : (
          <span className="muted">No time limit: take your time</span>
        )}
        <span className="muted" role="status" aria-live="polite">
          {saveState === "saving" ? "Saving..." : saveState === "failed" ? "Not saved" : "Saved"}
        </span>
      </div>

      <article className="screen">
        <h2 className="q-stem">{item.stem}</h2>
        <ListenButton key={item.questionId} text={examSpeech(item)} clips={examClips(item)} label="Listen to this question" />
        <p className="muted">{item.type === "multiple" ? "Select all that apply." : "Choose one answer."}</p>
        <div role="group" aria-label="Answer choices" className="choices">
          {item.options.map((o) => {
            const on = (answers[item.questionId] ?? []).includes(o.id);
            return (
              <label key={o.id} className={`option${on ? " picked" : ""}`}>
                <input type={item.type === "multiple" ? "checkbox" : "radio"} name={`q-${item.questionId}`} checked={on} onChange={() => void choose(o.id)} />
                <span>{o.text}</span>
              </label>
            );
          })}
        </div>
      </article>

      <div className="nav-row">
        <button type="button" className="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          Previous
        </button>
        {index < items.length - 1 ? (
          <button type="button" onClick={() => setIndex((i) => i + 1)}>
            Next
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>
            Review and submit
          </button>
        )}
      </div>

      <nav aria-label="Question map" className="qmap">
        {items.map((it, i) => (
          <button key={it.questionId} type="button" className={`qdot${i === index ? " here" : ""}${(answers[it.questionId] ?? []).length ? " done" : ""}`} aria-label={`Question ${i + 1}${(answers[it.questionId] ?? []).length ? ", answered" : ", not answered"}`} aria-current={i === index} onClick={() => setIndex(i)}>
            {i + 1}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="feedback bad" role="alert">
          {error}
        </p>
      ) : null}

      {confirming ? (
        <div className="modal-back">
          <div role="dialog" aria-modal="true" aria-labelledby="submit-title" className="modal">
            <h2 id="submit-title">Submit your exam?</h2>
            <p>
              You answered {answered} of {items.length} questions.
              {answered < items.length ? ` ${items.length - answered} unanswered will count as wrong.` : ""} You cannot change answers after you submit.
            </p>
            <div className="nav-row">
              <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
                Keep working
              </button>
              <button type="button" onClick={() => void submit()} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit exam"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
