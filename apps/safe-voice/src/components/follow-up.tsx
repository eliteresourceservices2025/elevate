"use client";

import { useState } from "react";
import { LIMITS, OUTCOME_LABELS, STATUS_LABELS } from "@/lib/constants";
import type { CaseView } from "@/lib/service";

// No account and no cookie: the case code and passphrase are sent with every request and kept only in this component's memory.
// Closing the tab or reloading the page forgets them. Nothing is written to storage or the address bar.

type Creds = { caseCode: string; passphrase: string };

async function readJson(response: Response) {
  return (await response.json().catch(() => null)) as { ok?: boolean; error?: string; case?: CaseView } | null;
}

export function FollowUp() {
  const [creds, setCreds] = useState<Creds | null>(null);
  const [view, setView] = useState<CaseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function open(next: Creds) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/case/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      const body = await readJson(response);
      if (body?.ok && body.case) {
        setCreds(next);
        setView(body.case);
      } else setError(body?.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("We could not reach Safe Voice. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function reply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creds) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("caseCode", creds.caseCode);
    data.set("passphrase", creds.passphrase);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/case/reply", { method: "POST", body: data, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      const body = await readJson(response);
      if (body?.ok && body.case) {
        setView(body.case);
        form.reset();
      } else setError(body?.error ?? "Something went wrong. Nothing was sent.");
    } catch {
      setError("We could not reach Safe Voice. Nothing was sent. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (!creds || !view) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void open({ caseCode: String(data.get("caseCode") ?? ""), passphrase: String(data.get("passphrase") ?? "") });
        }}
        noValidate
      >
        <label htmlFor="caseCode">Case code</label>
        <input id="caseCode" name="caseCode" type="text" required autoComplete="off" spellCheck={false} placeholder="SV-XXXX-XXXX-XXXX" />
        <label htmlFor="passphrase">Passphrase</label>
        <input id="passphrase" name="passphrase" type="password" required autoComplete="off" spellCheck={false} />
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? "Opening..." : "Open my case"}
        </button>
        <p className="muted">Your code and passphrase are only held on this page while it is open. Closing it forgets them.</p>
      </form>
    );
  }

  const closed = view.status === "closed";
  return (
    <section>
      <div className="card" aria-live="polite">
        <p>
          <strong>Status:</strong> {STATUS_LABELS[view.status] ?? view.status}
        </p>
        {closed && view.outcome ? (
          <p>
            <strong>Outcome:</strong> {OUTCOME_LABELS[view.outcome] ?? view.outcome}
          </p>
        ) : null}
        <p className="muted">
          Sent on {view.createdDay} (UTC date){closed && view.closedDay ? `, closed on ${view.closedDay}` : ""}. Only the day is recorded.
          {view.reportAttachments > 0 ? ` ${view.reportAttachments} file(s) came with your report.` : ""}
        </p>
        <button type="button" className="secondary" disabled={pending} onClick={() => void open(creds)}>
          Refresh
        </button>
        <button
          type="button"
          className="secondary"
          style={{ marginLeft: "0.5rem" }}
          onClick={() => {
            setCreds(null);
            setView(null);
          }}
        >
          Close this case view
        </button>
      </div>

      <h2>Messages</h2>
      {view.messages.length === 0 ? <p className="muted">No messages yet. A handler will reply here.</p> : null}
      {view.messages.map((m, i) => (
        <div key={i} className={`msg ${m.author}`}>
          <small>
            {m.author === "handler" ? "Safe Voice handler" : "You"} · {m.day}
            {m.attachments > 0 ? ` · ${m.attachments} file(s)` : ""}
          </small>
          {m.body}
        </div>
      ))}

      {closed ? (
        <p className="muted">This case is closed. If you have more to say, a handler can reopen it, but you cannot write here any more.</p>
      ) : (
        <form onSubmit={reply} encType="multipart/form-data" noValidate>
          <label htmlFor="message">Write a reply or add something</label>
          <textarea id="message" name="message" required maxLength={LIMITS.messageMax} style={{ minHeight: "7rem" }} />
          <label htmlFor="files">Attach files (optional)</label>
          <input id="files" name="files" type="file" multiple accept="image/jpeg,image/png,application/pdf" />
          <p className="muted">Up to {LIMITS.maxFiles} files, 4 MB in total. Do not include client or patient information.</p>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={pending}>
            {pending ? "Sending..." : "Send"}
          </button>
        </form>
      )}
      {closed && error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
