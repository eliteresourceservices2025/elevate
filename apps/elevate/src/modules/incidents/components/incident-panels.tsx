"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { useFormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWarnWhenEdited } from "@/components/unsaved-changes";
import { replyIncident, reportIncident, setIncidentStatus, setPrivacyOfficer } from "../actions";
import { INCIDENT_KINDS, LIMITS, NO_PATIENT_DATA_WARNING, kindLabel, statusLabel } from "../constants";
import type { IncidentDetail, IncidentRow } from "../queries";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const todayIso = () => new Date().toISOString().slice(0, 10);

const blank = { kind: "wrong_recipient", happenedOn: "", ongoing: false, howFound: "", whatHappened: "", clientId: "", whoElseKnows: "", actionsTaken: "" };

export function StatusBadge({ status, ongoing }: { status: string; ongoing?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={status === "closed" ? "outline" : "default"}>{statusLabel(status)}</Badge>
      {ongoing ? <Badge variant="destructive">Ongoing</Badge> : null}
    </span>
  );
}

/** The report form. Everyone signed in may use it. */
export function IncidentForm({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ ...blank, happenedOn: todayIso() });
  const { markSaved } = useWarnWhenEdited({ howFound: v.howFound, whatHappened: v.whatHappened, whoElseKnows: v.whoElseKnows, actionsTaken: v.actionsTaken });
  const dialog = useFormDialog();
  const [done, setDone] = useState<{ id: string; reference: string } | null>(null);
  const set = (k: keyof typeof blank, value: string | boolean) => setV((s) => ({ ...s, [k]: value }));

  if (done) {
    return (
      <div role="status" className="space-y-3">
        <h2 className="text-lg font-semibold">Thank you. Your report was sent.</h2>
        <p className="text-sm text-muted-foreground">
          Reference <strong>{done.reference}</strong>. HR and the Privacy Officer were told. You will see updates and any questions on the report. Reporting quickly is the right thing to do, and nobody is punished for reporting in good faith.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/incidents/${done.id}`} className={buttonVariants({ size: "sm" })}>
            Open the report
          </Link>
          <Button variant="outline" size="sm" onClick={() => { setDone(null); setV({ ...blank, happenedOn: todayIso() }); }}>
            Report something else
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const result = await reportIncident({ ...v, clientId: v.clientId || "" });
            if (!result.ok) return void toast.error(result.error);
            markSaved();
            setDone(result.data);
            dialog?.markClean();
            router.refresh();
          } catch {
            toast.error("No connection. Try again.");
          }
        });
      }}
    >
      <div role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <strong>No patient information.</strong> {NO_PATIENT_DATA_WARNING}
      </div>
      <SelectField id="in-kind" label="What happened?" value={v.kind} onChange={(e) => set("kind", e.target.value)}>
        {INCIDENT_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </SelectField>
      <TextField id="in-date" type="date" label="Day it happened (or the day you noticed)" value={v.happenedOn} onChange={(e) => set("happenedOn", e.target.value)} max={todayIso()} required />
      <label htmlFor="in-ongoing" className="flex items-start gap-2 text-sm">
        <input id="in-ongoing" type="checkbox" className="mt-0.5 size-4 accent-primary" checked={v.ongoing} onChange={(e) => set("ongoing", e.target.checked)} />
        <span>It may still be happening, or the information may still be exposed (the privacy team will look at it first).</span>
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="in-what">What happened, in your own words?</Label>
        <Textarea id="in-what" value={v.whatHappened} onChange={(e) => set("whatHappened", e.target.value)} rows={7} maxLength={LIMITS.whatHappened} required />
        <p className="text-xs text-muted-foreground">{v.whatHappened.length} / {LIMITS.whatHappened}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="in-found">How did you find out?</Label>
        <Textarea id="in-found" value={v.howFound} onChange={(e) => set("howFound", e.target.value)} rows={3} maxLength={LIMITS.howFound} required />
      </div>
      <SelectField id="in-client" label="Which client is involved? (leave blank if none or not sure)" value={v.clientId} onChange={(e) => set("clientId", e.target.value)}>
        <option value="">No client or not sure</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <div className="space-y-1.5">
        <Label htmlFor="in-who">Who else knows? (optional)</Label>
        <Textarea id="in-who" value={v.whoElseKnows} onChange={(e) => set("whoElseKnows", e.target.value)} rows={2} maxLength={LIMITS.whoElse} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="in-done">What have you already done about it? (optional)</Label>
        <Textarea id="in-done" value={v.actionsTaken} onChange={(e) => set("actionsTaken", e.target.value)} rows={3} maxLength={LIMITS.actionsTaken} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send the report"}
      </Button>
    </form>
  );
}

/** A list of reports as links. The privacy team's version also shows who filed it and the client. */
export function IncidentList({ rows, empty }: { rows: IncidentRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/incidents/${r.id}`} className="block space-y-1 rounded-lg border bg-card p-3 text-sm hover:bg-secondary/40">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.reference}</span>
              <span>{kindLabel(r.kind)}</span>
              <StatusBadge status={r.status} ongoing={r.ongoing && r.status !== "closed"} />
            </span>
            <span className="block text-xs text-muted-foreground">
              Happened {r.happenedOn} · filed {when(r.createdAt)}
              {r.from ? ` · ${r.from}` : ""}
              {r.client ? ` · ${r.client}` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The thread and its controls. Handlers also get the status and resolution controls. */
export function IncidentThread({ incident, canHandleThis }: { incident: IncidentDetail; canHandleThis: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [resolution, setResolution] = useState("");
  const { markSaved } = useWarnWhenEdited({ body, resolution });
  const closed = incident.status === "closed";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        markSaved();
        toast.success(ok);
        after?.();
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  return (
    <div className="space-y-6">
      <section aria-label="Messages" className="space-y-3">
        <h2 className="text-lg font-semibold">Messages</h2>
        {incident.messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet.</p> : null}
        <ul className="space-y-2">
          {incident.messages.map((m) => (
            <li key={m.id} className="rounded-lg border bg-card p-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {m.by === "handler" ? "Privacy team" : incident.isOwner ? "You" : "Reporter"} · {when(m.at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
        {closed ? (
          <p className="text-sm text-muted-foreground">This report is closed. The privacy team can reopen it if more is needed.</p>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => replyIncident({ id: incident.id, body }), "Sent.", () => setBody(""));
            }}
          >
            <Label htmlFor="in-reply">{incident.isHandler && !incident.isOwner ? "Ask a question or answer" : "Add a message"}</Label>
            <Textarea id="in-reply" rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={LIMITS.message} required />
            <p className="text-xs text-muted-foreground">No patient names or details, please.</p>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sending..." : "Send message"}
            </Button>
          </form>
        )}
      </section>

      {incident.isHandler ? (
        <section aria-label="Handling" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Handling</h2>
          {!canHandleThis ? (
            <p className="text-sm text-muted-foreground">You filed this report, so another person on the privacy team has to handle it.</p>
          ) : (
            <>
              {incident.resolution ? <p className="text-sm"><strong>Resolution note:</strong> {incident.resolution}</p> : null}
              <div className="flex flex-wrap gap-2">
                {incident.status !== "in_review" ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setIncidentStatus({ id: incident.id, status: "in_review" }), "Marked as in review.")}>
                    {closed ? "Reopen (in review)" : "Mark as in review"}
                  </Button>
                ) : null}
              </div>
              {!closed ? (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => setIncidentStatus({ id: incident.id, status: "closed", resolution }), "Closed.");
                  }}
                >
                  <Label htmlFor="in-resolution">How was it resolved? (only the privacy team reads this note)</Label>
                  <Textarea id="in-resolution" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={LIMITS.resolution} required />
                  <Button type="submit" size="sm" disabled={pending}>
                    Close the report
                  </Button>
                </form>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** The form that names a Privacy Officer (HR and Super Admin), for a modal. */
export function AddPrivacyOfficerForm() {
  const router = useRouter();
  const dialog = useFormDialog();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const result = await setPrivacyOfficer({ email, enabled: true });
            if (!result.ok) return void toast.error(result.error);
            toast.success("Privacy Officer added.");
            dialog?.close(true);
            router.refresh();
          } catch {
            toast.error("No connection. Try again.");
          }
        });
      }}
    >
      <TextField id="po-email" type="email" label="Their sign-in email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Button type="submit" disabled={pending}>
        Add Privacy Officer
      </Button>
    </form>
  );
}

/** HR and Super Admin name Privacy Officers here. */
export function PrivacyOfficerCard({ officers }: { officers: { id: string; email: string; name: string | null }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (target: string, enabled: boolean) =>
    startTransition(async () => {
      try {
        const result = await setPrivacyOfficer({ email: target, enabled });
        if (!result.ok) return void toast.error(result.error);
        toast.success(enabled ? "Privacy Officer added." : "Privacy Officer removed.");
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return (
    <section aria-label="Privacy Officers" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Privacy Officers</h2>
      <p className="text-sm text-muted-foreground">HR and Super Admin always see reports. A Privacy Officer is someone else you name who reads and handles them too.</p>
      {officers.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is named yet.</p> : null}
      <ul className="space-y-1 text-sm">
        {officers.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2">
            <span>{o.name ? `${o.name} (${o.email})` : o.email}</span>
            <Button size="xs" variant="outline" disabled={pending} onClick={() => change(o.email, false)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
