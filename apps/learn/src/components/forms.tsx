"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./api-client";

/** Starts (or resumes) the exam and opens it. The server enforces the order, the tries and the wait. */
export function StartExamButton({ assignmentId, label }: { assignmentId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setMessage(null);
    const r = await post("startExam", { assignmentId });
    if (r.ok && typeof r.attemptId === "string") {
      router.push(`/exam/${r.attemptId}`);
      return;
    }
    setBusy(false);
    const when = typeof r.retryAt === "string" ? ` You can try again at ${new Date(r.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "";
    setMessage(`${r.error ?? "Please try again."}${when}`);
  };
  return (
    <div>
      <button type="button" onClick={() => void start()} disabled={busy}>
        {busy ? "Opening the exam..." : label}
      </button>
      {message ? (
        <p className="feedback bad" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Starts (or resumes) the graded mock call and opens it. The server enforces the order, the tries and the wait. */
export function StartCallButton({ assignmentId, label }: { assignmentId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setMessage(null);
    const r = await post("startCall", { assignmentId });
    if (r.ok && typeof r.attemptId === "string") {
      window.location.assign(`/call/${r.attemptId}`);
      return;
    }
    setBusy(false);
    const when = typeof r.retryAt === "string" ? ` You can try again at ${new Date(r.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "";
    setMessage(`${r.error ?? "Please try again."}${when}`);
  };
  return (
    <div>
      <button type="button" onClick={() => void start()} disabled={busy}>
        {busy ? "Opening the call..." : label}
      </button>
      {message ? (
        <p className="feedback bad" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** The responsibility statement, accepted by typing the person's full name. Issues the certificate once. */
export function AcceptForm({ assignmentId, statementVersion, statement }: { assignmentId: string; statementVersion: string; statement: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const r = await post("accept", { assignmentId, statementVersion, typedName: name });
    if (r.ok) {
      router.refresh();
      return;
    }
    setBusy(false);
    setMessage(r.error ?? "Please try again.");
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="card">
      <h2>Your responsibility statement</h2>
      <blockquote>{statement}</blockquote>
      <label htmlFor="typed-name">Type your full name to accept</label>
      <input id="typed-name" name="typedName" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
      <p className="muted">It must match your name in ELEVATE.</p>
      <button type="submit" disabled={busy || name.trim().length < 2}>
        {busy ? "Saving..." : "I accept and get my certificate"}
      </button>
      {message ? (
        <p className="feedback bad" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}

/** The public check: a reference and the full name; the answer is valid, expired, revoked or not found. */
export function VerifyForm() {
  const [reference, setReference] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference, name }), cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; status?: string; issuedOn?: string; endsOn?: string; error?: string };
      if (!data.ok) setResult(data.error ?? "Please try again.");
      else if (data.status === "valid") setResult(`Valid. Issued ${data.issuedOn}, valid until ${data.endsOn}.`);
      else if (data.status === "expired") setResult(`This certificate was issued ${data.issuedOn} and expired on ${data.endsOn}.`);
      else if (data.status === "revoked") setResult("This certificate was revoked.");
      else setResult("No certificate matches that reference and name.");
    } catch {
      setResult("Something went wrong. Please try again.");
    }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="card">
      <label htmlFor="ref">Certificate reference</label>
      <input id="ref" placeholder="ERSHC-2026-ABC234" value={reference} onChange={(e) => setReference(e.target.value)} required maxLength={30} autoComplete="off" />
      <label htmlFor="holder">Full name on the certificate</label>
      <input id="holder" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="off" />
      <button type="submit" disabled={busy || reference.trim().length < 5 || name.trim().length < 2}>
        {busy ? "Checking..." : "Check certificate"}
      </button>
      <p role="status" aria-live="polite">
        {result}
      </p>
    </form>
  );
}

/** Opens the browser's print dialog. */
export function PrintButton() {
  return (
    <button type="button" className="secondary" onClick={() => window.print()}>
      Print
    </button>
  );
}

/** One micro-drill: pick an answer, then see the better answer and why. Nothing here is graded or blocks anything. */
export function DrillForm({
  course,
  options,
  best,
  explanation,
  answered,
}: {
  course: string;
  options: readonly { id: string; text: string }[];
  best: string | null;
  explanation: string | null;
  answered: { choice: string; correct: boolean } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ choice: string; correct: boolean; best: string; explanation: string } | null>(
    answered && best && explanation ? { ...answered, best, explanation } : null,
  );
  const pick = async (choice: string) => {
    setBusy(true);
    setMessage(null);
    const r = await post("drill", { course, choice });
    setBusy(false);
    if (r.ok && typeof r.best === "string" && typeof r.explanation === "string") {
      setResult({ choice, correct: r.correct === true, best: r.best, explanation: r.explanation });
      router.refresh();
      return;
    }
    setMessage(r.error ?? "Please try again.");
  };
  return (
    <div>
      <ul className="plain">
        {options.map((o) => (
          <li key={o.id}>
            <button type="button" className={result && o.id === result.best ? "" : "secondary"} onClick={() => void pick(o.id)} disabled={busy || result !== null}>
              {o.text}
            </button>
          </li>
        ))}
      </ul>
      {result ? (
        <p className={`feedback ${result.correct ? "good" : ""}`} role="status">
          {result.correct ? "Good choice. " : "A better answer is highlighted. "}
          {result.explanation}
        </p>
      ) : null}
      {message ? (
        <p className="feedback bad" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
