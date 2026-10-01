"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { fromZonedTime } from "date-fns-tz";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { formatInZone } from "@/lib/time";
import { openEvidence } from "../actions";
import { answerExtraHours, cancelExtraHours, decideExtraHours, fileExtraHoursFor, requestExtraEvidenceUpload, requestExtraHours } from "../extra-hours-actions";
import type { ExtraItem, MyExtraHours } from "../extra-hours-queries";
import type { FilablePerson } from "../queries";
import { formatDuration, MINUTE } from "../clock";

const LOCAL = "yyyy-MM-dd'T'HH:mm";
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5_000_000;
const STATUS_TEXT: Record<string, string> = { pending_lead: "Waiting for approval", pending_confirm: "Waiting for the VA", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };
const STATUS_VARIANT = new Map<string, "default" | "secondary" | "outline" | "destructive">([["pending_lead", "secondary"], ["pending_confirm", "secondary"], ["approved", "default"], ["declined", "destructive"], ["cancelled", "outline"]]);

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = <T,>(fn: () => Promise<{ ok: boolean; error?: string; data?: T }>, success: string | ((data: T | undefined) => string), after?: () => void) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        toast.success(typeof success === "function" ? success(result.data) : success);
        after?.();
        router.refresh();
      } catch {
        toast.error("No connection. Nothing was sent. Try again when you are back online.");
      }
    });
  return { run, pending };
}

type Uploader = (file: File) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;

/** Uploads each chosen screenshot to private storage and returns their ids. */
async function uploadAll(files: File[], upload: Uploader): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const ids: string[] = [];
  for (const f of files) {
    const done = await upload(f);
    if (!done.ok) return done;
    ids.push(done.id);
  }
  return { ok: true, ids };
}

const uploaderFor = (employeeId?: string): Uploader => async (file) => {
  const ticket = await requestExtraEvidenceUpload({ mime: file.type, size: file.size, employeeId });
  if (!ticket.ok) return { ok: false, error: ticket.error };
  const { error } = await createSupabaseBrowserClient().storage.from("employee-docs").uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
  return error ? { ok: false, error: "A screenshot did not upload. Try again." } : { ok: true, id: ticket.data.id };
};

function ProofPicker({ id, label, files, setFiles, required }: { id: string; label: string; files: File[]; setFiles: (f: File[]) => void; required: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? " (required)" : " (optional)"}
      </Label>
      <Input
        id={id}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).slice(0, MAX_FILES);
          if ((e.target.files?.length ?? 0) > MAX_FILES) toast.error(`Attach ${MAX_FILES} screenshots at most.`);
          if (picked.some((f) => f.size > MAX_FILE_BYTES)) {
            toast.error("Each screenshot must be 5 MB or smaller.");
            e.target.value = "";
            return setFiles([]);
          }
          setFiles(picked);
        }}
      />
      <p className="text-xs text-muted-foreground">
        A JPG or PNG up to 5 MB, three at most. <strong>Never include client or patient information.</strong> Only you, your leads and HR can open it, and it is deleted 90 days after the decision.
        {files.length > 0 ? ` ${files.length} chosen.` : ""}
      </p>
    </div>
  );
}

/** A VA asks to work extra hours for a client. The client's approval is shown as a screenshot; the lead decides. */
function RequestForm({ data }: { data: MyExtraHours }) {
  const { run, pending } = useRun();
  const [clientId, setClientId] = useState(data.clients[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [contact, setContact] = useState("");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  if (data.clients.length === 0) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">You are not assigned to a client yet, so there is nobody to work extra hours for. Ask HR.</p>;
  const maxHours = data.limits.maxExtraMinutesPerDay / 60;
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run<{ warning: string | null }>(
          async () => {
            const up = await uploadAll(files, uploaderFor());
            if (!up.ok) return up;
            return requestExtraHours({ clientId, windowStart: fromZonedTime(start, data.zone).toISOString(), windowEnd: fromZonedTime(end, data.zone).toISOString(), contactName: contact, reason, evidenceIds: up.ids });
          },
          (d) => (d?.warning ? `Sent to your lead. Note: ${d.warning}` : "Sent to your lead for approval."),
          () => {
            setStart("");
            setEnd("");
            setContact("");
            setReason("");
            setFiles([]);
          },
        );
      }}
    >
      <h3 className="font-semibold">Ask to work extra hours</h3>
      <p className="text-sm text-muted-foreground">
        Ask your client first. Then attach their approval here, and your team lead decides. Up to {maxHours} hours a day. Times are in {data.zone}. If the time has already passed, it is asked for after the fact and your lead sees that.
      </p>
      <SelectField id="eh-client" label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
        {data.clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="eh-start" label="From" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        <TextField id="eh-end" label="Until" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
      </div>
      <TextField id="eh-contact" label="Who at the client approved it?" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} required />
      <TextField id="eh-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
      <ProofPicker id="eh-files" label="Screenshot of the client's approval" files={files} setFiles={setFiles} required />
      <Button type="submit" disabled={pending || files.length === 0}>
        Send for approval
      </Button>
    </form>
  );
}

/** A lead or HR files extra hours the client asked for. The VA then confirms or declines. */
function FileForm({ people, clients, zone }: { people: FilablePerson[]; clients: { id: string; name: string }[]; zone: string }) {
  const { run, pending } = useRun();
  const [who, setWho] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [contact, setContact] = useState("");
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  if (people.length === 0 || clients.length === 0) return null;
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          async () => {
            const up = await uploadAll(files, uploaderFor(who));
            if (!up.ok) return up;
            return fileExtraHoursFor({ employeeId: who, clientId, windowStart: fromZonedTime(start, zone).toISOString(), windowEnd: fromZonedTime(end, zone).toISOString(), contactName: contact, reason, confirmedByPhone: phone, evidenceIds: up.ids });
          },
          "Filed. The person was asked to confirm.",
          () => {
            setStart("");
            setEnd("");
            setContact("");
            setReason("");
            setFiles([]);
            setPhone(false);
          },
        );
      }}
    >
      <h3 className="font-semibold">File extra hours the client asked for</h3>
      <p className="text-sm text-muted-foreground">Your filing is the approval. The VA is told and confirms or declines; they can say no. Times are in {zone}.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField id="fe-who" label="Person" value={who} onChange={(e) => setWho(e.target.value)} required>
          <option value="">Choose a person</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField id="fe-client" label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField id="fe-start" label="From" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        <TextField id="fe-end" label="Until" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
      </div>
      <TextField id="fe-contact" label="Who at the client asked?" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} required />
      <TextField id="fe-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
      <ProofPicker id="fe-files" label="The client's request" files={files} setFiles={setFiles} required={!phone} />
      <label htmlFor="fe-phone" className="flex items-center gap-2 text-sm">
        <input id="fe-phone" type="checkbox" className="size-4 accent-primary" checked={phone} onChange={(e) => setPhone(e.target.checked)} />
        I confirmed this with the client by phone or in person (no screenshot)
      </label>
      <Button type="submit" disabled={pending || !who || (!phone && files.length === 0)}>
        File and ask them to confirm
      </Button>
    </form>
  );
}

function Window({ item, zone }: { item: ExtraItem; zone: string }) {
  return (
    <span>
      {formatInZone(item.windowStart, zone, "EEE MMM d, h:mm a")} to {formatInZone(item.windowEnd, zone, "h:mm a")} <span className="text-muted-foreground">({formatDuration(item.minutes * MINUTE)})</span>
    </span>
  );
}

/** One list of requests. As the person: confirm or decline what a client asked for, and cancel. As a lead or HR: decide, with the window editable. */
function Items({ items, zone, mode, empty }: { items: ExtraItem[]; zone: string; mode: "mine" | "queue"; empty: string }) {
  const { run, pending } = useRun();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<Record<string, { start: string; end: string }>>({});
  const paged = usePaged(items, "", 10);
  const open = async (evidenceId: string) => {
    const result = await openEvidence({ evidenceId });
    if (!result.ok) return void toast.error(result.error);
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  };
  if (items.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-3">
    <ul className="space-y-3">
      {paged.rows.map((r) => {
        const e = edit[r.id];
        return (
          <li key={r.id} className="space-y-2 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              {mode === "queue" ? <span className="font-semibold">{r.employeeName}</span> : null}
              <Badge variant={STATUS_VARIANT.get(r.status) ?? "outline"}>{STATUS_TEXT[r.status] ?? r.status}</Badge>
              <Badge variant="outline">{r.clientName}</Badge>
              {r.afterTheFact ? <Badge variant="secondary">After the fact</Badge> : null}
              {r.hrOnly && r.status === "pending_lead" ? <Badge variant="secondary">HR decides</Badge> : null}
            </div>
            <p className="text-sm">
              <Window item={r} zone={zone} />
            </p>
            {r.originalWindowStart && r.originalWindowEnd ? (
              <p className="text-xs text-muted-foreground">
                The reviewer changed the time. First asked: {formatInZone(r.originalWindowStart, zone, "EEE MMM d, h:mm a")} to {formatInZone(r.originalWindowEnd, zone, "h:mm a")}.
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {r.source === "client" ? `The client asked (${r.contactName}). Filed by ${r.filedByName}.` : `Approved by the client: ${r.contactName}.`} {r.reason}
              {r.confirmedByPhone ? " Confirmed with the client by phone." : ""}
            </p>
            {r.decisionNote ? <p className="text-sm">Note: {r.decisionNote}</p> : null}
            {r.evidence.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {r.evidence.map((ev, i) =>
                  ev.purged ? (
                    <span key={ev.id} className="text-xs text-muted-foreground">
                      Screenshot {i + 1} was deleted after 90 days
                    </span>
                  ) : (
                    <Button key={ev.id} size="sm" variant="outline" onClick={() => void open(ev.id)}>
                      View screenshot {i + 1}
                    </Button>
                  ),
                )}
              </div>
            ) : null}

            {r.needsMyAnswer ? (
              <div className="flex flex-wrap items-end gap-2">
                <Button size="sm" disabled={pending} onClick={() => run(() => answerExtraHours({ requestId: r.id, answer: "confirm" }), "Confirmed. It is approved.")}>
                  Confirm
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => answerExtraHours({ requestId: r.id, answer: "decline" }), "Declined. The person who filed it was told.")}>
                  Decline
                </Button>
              </div>
            ) : null}

            {mode === "queue" && r.canDecide ? (
              <div className="space-y-2">
                {e ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`ex-s-${r.id}`} className="text-xs">
                        From (change if needed)
                      </Label>
                      <Input id={`ex-s-${r.id}`} type="datetime-local" value={e.start} onChange={(ev) => setEdit((m) => ({ ...m, [r.id]: { ...e, start: ev.target.value } }))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`ex-e-${r.id}`} className="text-xs">
                        Until (change if needed)
                      </Label>
                      <Input id={`ex-e-${r.id}`} type="datetime-local" value={e.end} onChange={(ev) => setEdit((m) => ({ ...m, [r.id]: { ...e, end: ev.target.value } }))} />
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setEdit((m) => ({ ...m, [r.id]: { start: formatInZone(r.windowStart, zone, LOCAL), end: formatInZone(r.windowEnd, zone, LOCAL) } }))}>
                    Change the time
                  </Button>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`ex-n-${r.id}`} className="text-xs">
                      Note (needed to decline)
                    </Label>
                    <Input id={`ex-n-${r.id}`} className="w-64" maxLength={300} value={notes[r.id] ?? ""} onChange={(ev) => setNotes((n) => ({ ...n, [r.id]: ev.target.value }))} />
                  </div>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          decideExtraHours({
                            requestId: r.id,
                            decision: "approve",
                            note: notes[r.id],
                            windowStart: e ? fromZonedTime(e.start, zone).toISOString() : undefined,
                            windowEnd: e ? fromZonedTime(e.end, zone).toISOString() : undefined,
                          }),
                        "Approved.",
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideExtraHours({ requestId: r.id, decision: "decline", note: notes[r.id] }), "Declined.")}>
                    Decline
                  </Button>
                </div>
              </div>
            ) : null}

            {r.canCancel ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelExtraHours({ requestId: r.id }), "Cancelled.")}>
                Cancel request
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
    <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="requests" />
    </div>
  );
}

export function ExtraHoursPanel({
  mine,
  queue,
  filable,
  clients,
  queueZone,
}: {
  mine: MyExtraHours | null;
  queue: { pending: ExtraItem[]; recent: ExtraItem[]; scope: "all" | "team" } | null;
  filable: FilablePerson[] | null;
  clients: { id: string; name: string }[] | null;
  queueZone: string;
}) {
  const waitingForMe = mine?.items.filter((i) => i.needsMyAnswer) ?? [];
  return (
    <div className="space-y-8">
      {waitingForMe.length > 0 ? (
        <section aria-label="Waiting for your answer" className="space-y-2">
          <h2 className="text-lg font-semibold">Your client asked for extra hours</h2>
          <Items items={waitingForMe} zone={mine!.zone} mode="mine" empty="" />
        </section>
      ) : null}

      {queue ? (
        <section aria-label="Extra hours queue" className="space-y-3">
          <h2 className="text-lg font-semibold">Requests to review</h2>
          <p className="text-sm text-muted-foreground">{queue.scope === "team" ? "From people on your team." : "Everyone's. HR decides when nobody above the person can, or when it was asked for more than 7 days late."} Times are in {queueZone}.</p>
          {filable && clients ? <FileForm people={filable} clients={clients} zone={queueZone} /> : null}
          <Items items={queue.pending} zone={queueZone} mode="queue" empty="Nothing is waiting." />
          {queue.recent.length > 0 ? (
            <details className="rounded-xl border bg-card p-4">
              <summary className="cursor-pointer text-sm font-medium">Decided in the last two weeks ({queue.recent.length})</summary>
              <div className="mt-3">
                <Items items={queue.recent} zone={queueZone} mode="queue" empty="" />
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {mine ? (
        <>
          <RequestForm data={mine} />
          <section aria-label="My extra hours" className="space-y-2">
            <h2 className="text-lg font-semibold">My extra hours</h2>
            <Items items={mine.items.filter((i) => !i.needsMyAnswer)} zone={mine.zone} mode="mine" empty="You have not asked for any extra hours." />
          </section>
        </>
      ) : (
        <p className="text-muted-foreground">Extra hours need a people record. Set up your profile in My time first.</p>
      )}
    </div>
  );
}
