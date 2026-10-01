"use client";

import { useState } from "react";
import { toast } from "sonner";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";
import { declineEnvelope, getDocumentLink, signEnvelope } from "../actions";
import { CONSENT_TEXT } from "../constants";
import { SignaturePad } from "./signature-pad";

/** Opens the document (a short signed link). Opening it is recorded: signing needs it. */
export function OpenDocumentButton({ envelopeId, label = "Open the document" }: { envelopeId: string; label?: string }) {
  const { run, pending } = useRun();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        run<{ url: string; sealed: boolean }>(
          () => getDocumentLink({ envelopeId }),
          "Opened in a new tab.",
          (data) => data && window.open(data.url, "_blank", "noopener,noreferrer"),
        )
      }
    >
      {label}
    </Button>
  );
}

/** What a signer does: open and read, agree, type or draw, sign. Or decline with a reason. */
export function SignPanel({ envelopeId, viewed, defaultName }: { envelopeId: string; viewed: boolean; defaultName: string }) {
  const { run, pending } = useRun();
  const [kind, setKind] = useState<"typed" | "drawn">("typed");
  const [typed, setTyped] = useState(defaultName);
  const [png, setPng] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const ready = viewed && consent && (kind === "typed" ? typed.trim().length > 1 : Boolean(png));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="font-semibold">1. Read the document</h3>
        <OpenDocumentButton envelopeId={envelopeId} />
        {viewed ? <p className="text-sm text-green-700">You opened it. You can sign now.</p> : <p className="text-sm text-muted-foreground">Open and read it first. Signing is available after you have opened it.</p>}
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          run(() => signEnvelope({ envelopeId, consent: true, kind, typedText: kind === "typed" ? typed : undefined, pngBase64: kind === "drawn" ? (png ?? undefined) : undefined }), "Signed. Thank you.");
        }}
      >
        <h3 className="font-semibold">2. Sign</h3>
        <div role="tablist" aria-label="How to sign" className="flex gap-2">
          {(["typed", "drawn"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-lg border px-3 py-1.5 text-sm ${kind === k ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary/50"}`}>
              {k === "typed" ? "Type my name" : "Draw it"}
            </button>
          ))}
        </div>
        {kind === "typed" ? (
          <div className="max-w-md space-y-2">
            <TextField id="sig-typed" label="Your full name" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={60} autoComplete="name" />
            <p className="font-serif text-3xl italic" aria-label="Preview of your signature">
              {typed || " "}
            </p>
          </div>
        ) : (
          <SignaturePad onChange={setPng} />
        )}
        <label htmlFor="sig-consent" className="flex items-start gap-2 text-sm">
          <input id="sig-consent" type="checkbox" className="mt-1 size-4 accent-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{CONSENT_TEXT}</span>
        </label>
        <Button type="submit" disabled={pending || !ready}>
          Sign document
        </Button>
        {!viewed ? <p className="text-xs text-muted-foreground">Open the document above to enable signing.</p> : null}
      </form>

      <div className="border-t pt-4">
        {!declining ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDeclining(true)}>
            I do not want to sign this
          </Button>
        ) : (
          <form
            className="max-w-md space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 3) return void toast.error("Give a short reason.");
              if (!window.confirm("Decline to sign? This stops the document for everyone.")) return;
              run(() => declineEnvelope({ envelopeId, reason }), "You declined. HR was told.");
            }}
          >
            <TextField id="decline-reason" label="Why are you declining?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={pending}>
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
