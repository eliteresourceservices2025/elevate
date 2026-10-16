"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DocumentViewer } from "@/components/document-viewer";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";
import { declineEnvelope, getDocumentLink, signEnvelope } from "../actions";
import { CONSENT_TEXT, SIGNEE_DETAIL_FIELDS, detailProblem, isSigneeDetailKey, isValidInitials, suggestInitials } from "../constants";
import { InitialsStepper } from "./initials-stepper";
import { SignaturePad } from "./signature-pad";

/** Downloads the document (a 60-second signed link that saves the file). Reading it in the page is the viewer below. */
export function OpenDocumentButton({ envelopeId, label = "Download" }: { envelopeId: string; label?: string }) {
  const { run, pending } = useRun();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        run<{ url: string; sealed: boolean }>(
          () => getDocumentLink({ envelopeId }),
          "Download started.",
          (data) => data && window.open(data.url, "_blank", "noopener,noreferrer"),
        )
      }
    >
      {label}
    </Button>
  );
}

/** The document, shown inside the page, with a separate download button. Opening it is recorded for a signer: signing needs it. */
export function EnvelopeDocument({ envelopeId, title, openLabel, sealed = false, defaultOpen = false }: { envelopeId: string; title: string; openLabel: string; sealed?: boolean; defaultOpen?: boolean }) {
  const router = useRouter();
  return (
    <DocumentViewer src={`/api/signing/${envelopeId}/document`} title={title} openLabel={openLabel} defaultOpen={defaultOpen} onFirstLoad={() => router.refresh()}>
      <OpenDocumentButton envelopeId={envelopeId} label={sealed ? "Download the signed copy" : "Download"} />
    </DocumentViewer>
  );
}

/** What a signer does: open and read, agree, type or draw, sign. Or decline with a reason. */
export function SignPanel({ envelopeId, viewed, defaultName, initialPages = null, detailKeys = [] }: { envelopeId: string; viewed: boolean; defaultName: string; initialPages?: number | null; detailKeys?: string[] }) {
  const { run, pending } = useRun();
  const [kind, setKind] = useState<"typed" | "drawn">("typed");
  const [typed, setTyped] = useState(defaultName);
  const [png, setPng] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [initials, setInitials] = useState(() => suggestInitials(defaultName));
  const [initialed, setInitialed] = useState<number[]>([]);
  const fields = SIGNEE_DETAIL_FIELDS.filter((f) => detailKeys.includes(f.key));
  const [details, setDetails] = useState<Record<string, string>>({});
  const detailsOk = fields.every((f) => detailProblem(f.key, details[f.key] ?? "") === null);
  const needInitials = initialPages !== null;
  const initialsOk = !needInitials || (isValidInitials(initials) && initialed.length === initialPages);

  const ready = viewed && initialsOk && detailsOk && consent && (kind === "typed" ? typed.trim().length > 1 : Boolean(png));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="font-semibold">{needInitials ? "1. Read and initial each page" : "1. Read the document"}</h3>
        {needInitials ? (
          <InitialsStepper envelopeId={envelopeId} pages={initialPages} viewed={viewed} initials={initials} onInitials={setInitials} done={initialed} onDone={setInitialed} />
        ) : (
          <EnvelopeDocument envelopeId={envelopeId} title="The document to sign" openLabel="Read the document" />
        )}
        {needInitials ? null : viewed ? <p className="text-sm text-green-700">You opened it. You can sign now.</p> : <p className="text-sm text-muted-foreground">Open and read it first. Signing is available after you have opened it.</p>}
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          run(() => signEnvelope({ envelopeId, consent: true, kind, typedText: kind === "typed" ? typed : undefined, pngBase64: kind === "drawn" ? (png ?? undefined) : undefined, ...(needInitials ? { initials: initials.trim().toUpperCase(), initialedPages: initialed } : {}), ...(fields.length ? { details: Object.fromEntries(fields.filter((f) => isSigneeDetailKey(f.key)).map((f) => [f.key, (details[f.key] ?? "").trim()])) } : {}) }), "Signed. Thank you.");
        }}
      >
        {fields.length > 0 ? (
          <div className="space-y-3">
            <h3 className="font-semibold">2. Your details</h3>
            <p className="text-sm text-muted-foreground">These are part of the agreement. They are kept encrypted and printed on the signed copy, which only you, HR and the Company can open.</p>
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <TextField id={`detail-${f.key}`} label={f.label} value={details[f.key] ?? ""} onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))} maxLength={f.max} autoComplete="off" />
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <h3 className="font-semibold">{fields.length > 0 ? "3. Sign" : "2. Sign"}</h3>
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
        {!viewed || !initialsOk || !detailsOk ? <p className="text-xs text-muted-foreground">{needInitials && !initialsOk ? "Initial every page above to enable signing." : !viewed ? "Read the document above to enable signing." : "Fill in your details above to enable signing."}</p> : null}
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
