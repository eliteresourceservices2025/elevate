"use client";

import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, LIMITS } from "@/lib/constants";

// The credentials live only in this component's memory. Nothing is written to cookies, localStorage, sessionStorage or the address bar.

type Done = { caseCode: string; passphrase: string };

export function ReportForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/report", { method: "POST", body: new FormData(event.currentTarget), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; caseCode?: string; passphrase?: string } | null;
      if (body?.ok && body.caseCode && body.passphrase) setDone({ caseCode: body.caseCode, passphrase: body.passphrase });
      else setError(body?.error ?? "Something went wrong. Nothing was saved. Please try again.");
    } catch {
      setError("We could not reach Safe Voice. Nothing was saved. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <section aria-live="polite" className="card">
        <h2 style={{ marginTop: 0 }}>Your report was sent</h2>
        <p>
          <strong>Write these two down now.</strong> They are the only way to read replies or add to your report, and they are shown only this
          once. We cannot recover them or tell who you are.
        </p>
        <label>Case code</label>
        <div className="secret" data-testid="case-code">{done.caseCode}</div>
        <label>Passphrase</label>
        <div className="secret" data-testid="passphrase">{done.passphrase}</div>
        <p className="muted">
          Keep them somewhere private, away from work devices if you can. Anyone who has both can read your case. To check for replies, use
          &ldquo;Check a case&rdquo; at the top of the page.
        </p>
        <button type="button" className="secondary" onClick={() => window.print()}>
          Print this page
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} encType="multipart/form-data" noValidate>
      <label htmlFor="category">What is this about?</label>
      <select id="category" name="category" required defaultValue="">
        <option value="" disabled>
          Choose one
        </option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {/* eslint-disable-next-line security/detect-object-injection -- `c` is from the fixed CATEGORIES list */}
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>

      <label htmlFor="description">What happened?</label>
      <textarea id="description" name="description" required minLength={LIMITS.descriptionMin} maxLength={LIMITS.descriptionMax} aria-describedby="description-hint" />
      <p id="description-hint" className="muted">
        What, roughly when and where, and who was involved if you are comfortable saying. Up to {LIMITS.descriptionMax.toLocaleString("en-US")} characters.
      </p>

      <label htmlFor="files">Attach files (optional)</label>
      <input id="files" name="files" type="file" multiple accept="image/jpeg,image/png,application/pdf" aria-describedby="files-hint" />
      <p id="files-hint" className="muted">
        Up to {LIMITS.maxFiles} files (JPG, PNG or PDF), 4 MB in total. Hidden details such as camera, place, author and dates are removed.
        Words and images that are visible on the page itself stay, so check them first.
      </p>

      {/* A hidden field only automated senders fill in. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send report"}
      </button>
    </form>
  );
}
