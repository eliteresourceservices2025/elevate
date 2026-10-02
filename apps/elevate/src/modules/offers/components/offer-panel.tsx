"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/markdown";
import { formatInZone } from "@/lib/time";
import { useRun } from "@/modules/recruiting/components/use-run";
import { hireCandidate, makeOffer, previewOffer, resendOfferLink, sendOffer, withdrawOffer } from "../actions";
import type { OfferRow } from "../queries";
import type { OfferStatus } from "../service";

type Panel = {
  stage: string;
  offers: OfferRow[];
  templates: { id: string; name: string }[];
  counterSigners: { userId: string; name: string }[];
  canMake: boolean;
  canHire: boolean;
  hiredEmployeeId: string | null;
  hasSignedOffer: boolean;
  positions: { id: string; title: string }[];
  teams: { id: string; name: string }[];
  hireDefaults: { legalFirstName: string; legalLastName: string; workEmail: string };
};

const STATUS_LABEL: Record<OfferStatus, string> = { draft: "Draft", sent: "Sent", signed: "Signed", declined: "Declined", expired: "Expired", withdrawn: "Withdrawn" };
const STATUS_VARIANT: Record<OfferStatus, "default" | "secondary" | "outline" | "destructive"> = { draft: "outline", sent: "default", signed: "secondary", declined: "destructive", expired: "outline", withdrawn: "outline" };

function MakeOfferForm({ applicationId, panel }: { applicationId: string; panel: Panel }) {
  const { run, pending } = useRun();
  const [templateId, setTemplateId] = useState(panel.templates[0]?.id ?? "");
  const [roleTitle, setRoleTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [clientName, setClientName] = useState("");
  const [payNote, setPayNote] = useState("");
  const [counter, setCounter] = useState("");
  const [expiryDays, setExpiryDays] = useState("7");
  const [preview, setPreview] = useState<string | null>(null);

  const input = (send: boolean) => ({ applicationId, templateId, roleTitle, startDate, clientName, payNote, counterSignerUserId: counter, expiryDays: Number(expiryDays), send });

  if (panel.templates.length === 0) return <p className="text-sm text-muted-foreground">There is no offer template yet. HR creates one under Offer templates on the Recruiting page.</p>;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run<{ offerId: string; emailed: boolean | null }>(
          () => makeOffer(input(true)),
          (d) => (d?.emailed === false ? "Offer made, but the email could not be sent. Use Send link again on the offer." : "Offer sent. The applicant has an emailed link to sign."),
          () => setPreview(null),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField id="of-template" label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {panel.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <TextField id="of-role" label="Role" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} maxLength={120} required />
        <TextField id="of-start" label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        <TextField id="of-client" label="Client (optional)" value={clientName} onChange={(e) => setClientName(e.target.value)} maxLength={120} />
        <TextField id="of-pay" label="Pay note (free text, shown in the letter)" value={payNote} onChange={(e) => setPayNote(e.target.value)} maxLength={500} hint="For example: hourly rate agreed per client. Pay is not calculated or stored anywhere else." />
        <SelectField id="of-counter" label="Countersigner (optional, signs after the applicant)" value={counter} onChange={(e) => setCounter(e.target.value)}>
          <option value="">No countersigner</option>
          {panel.counterSigners.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <TextField id="of-expiry" label="Days to accept" type="number" min={1} max={30} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending || !roleTitle || !startDate}
          onClick={async () => {
            const r = await previewOffer(input(false));
            if (!r.ok) return void toast.error(r.error);
            setPreview(r.data.text);
          }}
        >
          Preview the letter
        </Button>
        <Button type="submit" disabled={pending || !roleTitle || !startDate}>
          Send offer
        </Button>
        <Button type="button" variant="outline" disabled={pending || !roleTitle || !startDate} onClick={() => run(() => makeOffer(input(false)), "Saved as a draft.", () => setPreview(null))}>
          Save as draft
        </Button>
      </div>
      {preview ? (
        <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
          <Label>Preview</Label>
          <Markdown source={preview} />
        </div>
      ) : null}
    </form>
  );
}

function OfferRowView({ o }: { o: OfferRow }) {
  const { run, pending } = useRun();
  return (
    <li className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{o.roleTitle || o.templateName}</span>
        <Badge variant={STATUS_VARIANT[o.status]}>{STATUS_LABEL[o.status]}</Badge>
        {o.status === "sent" ? <span className="text-xs text-muted-foreground">{o.applicantOpened ? "Opened by the applicant" : "Not opened yet"}</span> : null}
        {o.hasCounterSigner && o.status === "sent" ? <span className="text-xs text-muted-foreground">{o.counterSigned ? "Countersigned" : "Countersigner has not signed"}</span> : null}
        <span className="text-xs text-muted-foreground">{formatInZone(o.createdAt, undefined, "MMM d, yyyy")}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {o.status === "draft" ? (
          <Button size="sm" disabled={pending} onClick={() => run<{ emailed: boolean }>(() => sendOffer({ offerId: o.id }), (d) => (d?.emailed ? "Sent. The applicant has an emailed link." : "Sent, but the email could not be delivered. Use Send link again."))}>
            Send
          </Button>
        ) : null}
        {o.status === "sent" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run<{ emailed: boolean }>(() => resendOfferLink({ offerId: o.id }), (d) => (d?.emailed ? "A new link was emailed. The earlier link no longer works." : "The email could not be sent."))}>
            Send link again
          </Button>
        ) : null}
        {o.status === "draft" || o.status === "sent" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Withdraw this offer? The applicant's link stops working.") && run(() => withdrawOffer({ offerId: o.id }), "Offer withdrawn.")}>
            Withdraw
          </Button>
        ) : null}
        {o.envelopeId ? (
          <Link href={`/signing/${o.envelopeId}`} className="inline-flex h-7 items-center text-xs text-primary underline-offset-4 hover:underline">
            Open in Signing (HR)
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function HireForm({ applicationId, panel }: { applicationId: string; panel: Panel }) {
  const { run, pending, router } = useRun();
  const [first, setFirst] = useState(panel.hireDefaults.legalFirstName);
  const [last, setLast] = useState(panel.hireDefaults.legalLastName);
  const [email, setEmail] = useState(panel.hireDefaults.workEmail);
  const [positionId, setPositionId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [reason, setReason] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm("Hire this person? This creates their people record and invites them to ELEVATE.")) return;
        run<{ employeeId: string; invited: boolean; emailed: boolean }>(
          () => hireCandidate({ applicationId, legalFirstName: first, legalLastName: last, workEmail: email, positionId, teamId, startDate, withoutOfferReason: panel.hasSignedOffer ? undefined : reason }),
          (d) => `Hired. ${d?.invited ? (d.emailed ? "An invitation was emailed." : "They are invited, but the email could not be sent: tell them to use Accept an invite on the sign-in page.") : "They already have an ELEVATE account, which was linked."}`,
          (d) => d && router.push(`/people/${d.employeeId}`),
        );
      }}
    >
      <p className="text-sm text-muted-foreground">Creates their people record (a contractor, onboarding), marks the application hired, and invites them to create their ELEVATE account.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="hr-first" label="Legal first name" value={first} onChange={(e) => setFirst(e.target.value)} required />
        <TextField id="hr-last" label="Legal last name" value={last} onChange={(e) => setLast(e.target.value)} required />
        <TextField id="hr-email" label="Work email (they sign in with it)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField id="hr-start" label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        <SelectField id="hr-position" label="Position (optional)" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
          <option value="">No position yet</option>
          {panel.positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </SelectField>
        <SelectField id="hr-team" label="Team (optional)" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">No team yet</option>
          {panel.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
      </div>
      {!panel.hasSignedOffer ? <TextField id="hr-reason" label="Why hire without a signed offer? (recorded)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required hint="There is no signed offer yet. HR can hire anyway with a reason, for example the agreement was signed on paper." /> : null}
      <Button type="submit" disabled={pending}>
        Hire
      </Button>
    </form>
  );
}

/** Offers and hiring on the applicant page. */
export function OfferPanel({ applicationId, panel }: { applicationId: string; panel: Panel }) {
  const open = panel.stage !== "hired" && panel.stage !== "rejected";
  return (
    <section aria-label="Offers and hiring" className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Offer and hiring</h2>
      {panel.offers.length === 0 ? <p className="text-sm text-muted-foreground">No offer yet.</p> : null}
      <ul className="space-y-2">
        {panel.offers.map((o) => (
          <OfferRowView key={o.id} o={o} />
        ))}
      </ul>

      {panel.hiredEmployeeId ? (
        <p className="rounded-lg border border-green-600/40 bg-green-600/10 p-3 text-sm">
          Hired.{" "}
          {panel.canHire ? (
            <Link href={`/people/${panel.hiredEmployeeId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              Open their people record
            </Link>
          ) : null}
        </p>
      ) : null}

      {panel.canMake && open && panel.stage === "offer" && !panel.offers.some((o) => o.status === "draft" || o.status === "sent") ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-primary">Make an offer</summary>
          <div className="mt-3">
            <MakeOfferForm applicationId={applicationId} panel={panel} />
          </div>
        </details>
      ) : panel.canMake && open && panel.stage !== "offer" && panel.offers.length === 0 ? (
        <p className="text-xs text-muted-foreground">Move the applicant to the Offer stage to make an offer.</p>
      ) : null}

      {panel.canHire && open && !panel.hiredEmployeeId ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-primary">Hire</summary>
          <div className="mt-3">
            <HireForm applicationId={applicationId} panel={panel} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
