"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentViewer } from "@/components/document-viewer";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { CONSENT_TEXT } from "../constants";
import { SignaturePad } from "./signature-pad";

type Answer = { ok: boolean; error?: string; needCode?: boolean };

async function post(path: string, body?: unknown): Promise<Answer> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    return ((await response.json().catch(() => null)) as Answer | null) ?? { ok: false, error: "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: "No connection. Please try again." };
  }
}

/** Step one for an outside signer: confirm it is them with a code emailed to the address the link went to. */
function CodeStep({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const r = await post(`/api/sign/${token}/code`);
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(r.error ?? "We could not send a code.");
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post(`/api/sign/${token}/verify`, { code });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error ?? "That code is not right.");
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">First, confirm it is you</h2>
      <p className="text-sm text-muted-foreground">We will email a 6-digit code to {email}. Enter it here to read and sign the document.</p>
      {!sent ? (
        <Button type="button" onClick={send} disabled={busy}>
          Email me a code
        </Button>
      ) : (
        <form onSubmit={verify} className="max-w-xs space-y-3">
          <TextField id="ext-code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={send} disabled={busy}>
              Send a new code
            </Button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Read the document, agree, sign (type or draw), or decline. */
function SignStep({ token, defaultName }: { token: string; defaultName: string }) {
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [kind, setKind] = useState<"typed" | "drawn">("typed");
  const [typed, setTyped] = useState(defaultName);
  const [png, setPng] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const ready = opened && consent && (kind === "typed" ? typed.trim().length > 1 : Boolean(png));

  async function sign(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const r = await post(`/api/sign/${token}/sign`, { consent: true, kind, typedText: kind === "typed" ? typed : undefined, pngBase64: kind === "drawn" ? png : undefined });
    setBusy(false);
    if (r.ok) router.refresh();
    else if (r.needCode) router.refresh();
    else setError(r.error ?? "Something went wrong.");
  }
  async function decline(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm("Decline to sign? This stops the document.")) return;
    setBusy(true);
    const r = await post(`/api/sign/${token}/decline`, { reason });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error ?? "Something went wrong.");
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">1. Read the document</h2>
        <DocumentViewer src={`/api/sign/${token}/document`} title="The document to sign" openLabel="Read the document" onFirstLoad={() => setOpened(true)}>
          <a href={`/api/sign/${token}/document?download=1`} className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-secondary/50">
            Download
          </a>
        </DocumentViewer>
        <p className={`text-sm ${opened ? "text-green-700" : "text-muted-foreground"}`}>{opened ? "You opened it. You can sign now." : "Open and read it first. Signing is available after you have opened it."}</p>
      </section>

      <form onSubmit={sign} className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">2. Sign</h2>
        <div role="tablist" aria-label="How to sign" className="flex gap-2">
          {(["typed", "drawn"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-lg border px-3 py-1.5 text-sm ${kind === k ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary/50"}`}>
              {k === "typed" ? "Type my name" : "Draw it"}
            </button>
          ))}
        </div>
        {kind === "typed" ? (
          <div className="max-w-md space-y-2">
            <TextField id="ext-typed" label="Your full name" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={60} autoComplete="name" />
            <p className="font-serif text-3xl italic" aria-label="Preview of your signature">
              {typed || " "}
            </p>
          </div>
        ) : (
          <SignaturePad onChange={setPng} />
        )}
        <label htmlFor="ext-consent" className="flex items-start gap-2 text-sm">
          <input id="ext-consent" type="checkbox" className="mt-1 size-4 accent-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{CONSENT_TEXT}</span>
        </label>
        <Button type="submit" disabled={busy || !ready}>
          Sign document
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>

      <div className="border-t pt-4">
        {!declining ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDeclining(true)}>
            I do not want to sign this
          </Button>
        ) : (
          <form onSubmit={decline} className="max-w-md space-y-2">
            <TextField id="ext-decline" label="Why are you declining?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={busy}>
                Decline
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDeclining(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function ExternalFlow({ token, step, email, name }: { token: string; step: "code" | "sign" | "view"; email: string; name: string }) {
  if (step === "code") return <CodeStep token={token} email={email} />;
  if (step === "sign") return <SignStep token={token} defaultName={name} />;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <DocumentViewer src={`/api/sign/${token}/document`} title="The signed document" openLabel="View the signed document" defaultOpen>
        <a href={`/api/sign/${token}/document?download=1`} className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-secondary/50">
          Download the signed copy
        </a>
      </DocumentViewer>
    </section>
  );
}
