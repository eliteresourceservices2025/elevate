"use client";

import { useState } from "react";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFormDialog } from "@/components/form-dialog";
import { useWarnWhenEdited } from "@/components/unsaved-changes";
import { deleteOpening, saveOpening, saveRetention, setOpeningStatus } from "../actions";
import type { OpeningStatus } from "../constants";
import type { PersonChoice } from "../queries";
import { useRun } from "./use-run";
import { useAsk } from "@/components/confirm-dialog";

type OpeningValues = { id?: string; title: string; slug: string; description: string; location: string; payNote: string; teamId: string; sendAck: boolean; sendRejection: boolean; keywordsRequired: string; keywordsNice: string; hiringTeamUserIds: string[] };

export function OpeningForm({ initial, teams, people, status }: { initial?: Partial<OpeningValues>; teams: { id: string; name: string }[]; people: PersonChoice[]; /** The job's status; its web address can only change while it is a draft. */ status?: OpeningStatus }) {
  const { run, pending, router } = useRun();
  const [v, setV] = useState<OpeningValues>({ title: "", slug: "", description: "", location: "Remote", payNote: "", teamId: "", sendAck: true, sendRejection: true, keywordsRequired: "", keywordsNice: "", hiringTeamUserIds: [], ...initial });
  useWarnWhenEdited(v);
  const set = <K extends keyof OpeningValues>(k: K, value: OpeningValues[K]) => setV((s) => ({ ...s, [k]: value }));

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run<{ id: string }>(() => saveOpening(v), "Job saved.", (data) => data && router.push(`/recruiting/${data.id}`));
      }}
    >
      <TextField id="op-title" label="Job title" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={120} required />
      <TextField
        id="op-slug"
        label="Web address"
        value={v.slug}
        onChange={(e) => set("slug", e.target.value.toLowerCase())}
        maxLength={60}
        disabled={Boolean(v.id) && status !== undefined && status !== "draft"}
        hint={`/careers/${v.slug || "made-from-the-title"}. Leave blank to make it from the title. Lower-case letters, numbers and dashes. It can only be changed while the job is a draft, because the link may already be shared.`}
      />
      <div className="space-y-1.5">
        <Label htmlFor="op-desc">Description (shown on the public careers page)</Label>
        <Textarea id="op-desc" value={v.description} onChange={(e) => set("description", e.target.value)} rows={10} maxLength={10000} required aria-describedby="op-desc-hint" />
        <p id="op-desc-hint" className="text-xs text-muted-foreground">
          Formatting: **bold**, *italic*, # heading, - bullet list, [link text](https://example.com). These are contractor roles: please do not promise salary or benefits here.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="op-location" label="Location" value={v.location} onChange={(e) => set("location", e.target.value)} maxLength={120} />
        <TextField id="op-pay" label="Pay note (optional, shown publicly)" value={v.payNote} onChange={(e) => set("payNote", e.target.value)} maxLength={200} hint="For example: Hourly rate agreed per client." />
        <SelectField id="op-team" label="Team (optional)" value={v.teamId} onChange={(e) => set("teamId", e.target.value)}>
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
      </div>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Resume keywords (optional)</legend>
        <p className="text-xs text-muted-foreground">
          List words to look for in resumes, separated by commas or on separate lines. Each applicant then shows a &quot;keyword match&quot; percentage with the words found and missing. It is only a reading aid: people always decide, and it never rejects anyone. Resume text is read on our own server and is not kept.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="op-kw-req">Must have</Label>
            <Textarea id="op-kw-req" value={v.keywordsRequired} onChange={(e) => set("keywordsRequired", e.target.value)} rows={4} maxLength={2000} placeholder="Medical billing, Excel" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="op-kw-nice">Nice to have</Label>
            <Textarea id="op-kw-nice" value={v.keywordsNice} onChange={(e) => set("keywordsNice", e.target.value)} rows={4} maxLength={2000} placeholder="HIPAA, Spanish" />
          </div>
        </div>
      </fieldset>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Hiring team</legend>
        <p className="text-xs text-muted-foreground">Team leads added here can see this job&apos;s candidates and fill in scorecards. HR and recruiters always see everything.</p>
        <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.userId} htmlFor={`ht-${p.userId}`} className="flex items-center gap-2 text-sm">
              <input
                id={`ht-${p.userId}`}
                type="checkbox"
                className="size-4 accent-primary"
                checked={v.hiringTeamUserIds.includes(p.userId)}
                onChange={(e) => set("hiringTeamUserIds", e.target.checked ? [...v.hiringTeamUserIds, p.userId] : v.hiringTeamUserIds.filter((id) => id !== p.userId))}
              />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <label htmlFor="op-ack" className="flex items-center gap-2 text-sm">
          <input id="op-ack" type="checkbox" className="size-4 accent-primary" checked={v.sendAck} onChange={(e) => set("sendAck", e.target.checked)} />
          Email applicants a short &quot;we received your application&quot;
        </label>
        <label htmlFor="op-rej" className="flex items-center gap-2 text-sm">
          <input id="op-rej" type="checkbox" className="size-4 accent-primary" checked={v.sendRejection} onChange={(e) => set("sendRejection", e.target.checked)} />
          Allow sending a rejection email (you choose each time)
        </label>
      </div>
      <Button type="submit" disabled={pending}>
        {v.id ? "Save job" : "Create job (draft)"}
      </Button>
    </form>
  );
}

export function OpeningStatusButtons({ id, status }: { id: string; status: OpeningStatus }) {
  const { run, pending } = useRun();
  const ask = useAsk();
  const set = (next: OpeningStatus, message: string) => run(() => setOpeningStatus({ id, status: next }), message);
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "open" ? (
        <Button size="sm" disabled={pending} onClick={() => set("open", "The job is open and listed on the careers page.")}>
          {status === "closed" ? "Reopen job" : "Publish job"}
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={async () => (await ask("Close this job? It disappears from the careers page.")) && set("closed", "Job closed.")}>
          Close job
        </Button>
      )}
    </div>
  );
}

/** Removes the job ad. A job with applications is hidden instead of erased, and the message says which happened. */
export function DeleteOpeningButton({ id, applications }: { id: string; applications: number }) {
  const { run, pending, router } = useRun();
  const ask = useAsk();
  const warning = applications > 0 ? `Delete this job? It has ${applications} application${applications === 1 ? "" : "s"}, so it is hidden from every list and the applications are kept under the retention rules.` : "Delete this job for good? Nobody has applied to it.";
  return (
    <Button size="sm" variant="outline" className="text-destructive" disabled={pending} onClick={async () => (await ask(warning)) && run(() => deleteOpening({ id }), (d) => (d?.erased ? "Job deleted." : "Job removed from the lists."), () => router.push("/recruiting"))}>
      Delete job
    </Button>
  );
}

export function RetentionForm({ initial }: { initial: { enabled: boolean; rejectedMonths: number; withdrawnMonths: number } }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [rejected, setRejected] = useState(String(initial.rejectedMonths));
  const [withdrawn, setWithdrawn] = useState(String(initial.withdrawnMonths));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveRetention({ enabled, rejectedMonths: Number(rejected), withdrawnMonths: Number(withdrawn) }), "Retention settings saved.", () => dialog?.close(true));
      }}
    >
      <p className="text-sm text-muted-foreground">Removes the personal data of applicants who were not hired, once their last application closed longer ago than these periods. The periods need counsel&apos;s approval before you switch this on. Hired people are never touched.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="rt-rej" label="Rejected: months to keep" type="number" min={1} max={120} value={rejected} onChange={(e) => setRejected(e.target.value)} />
        <TextField id="rt-wd" label="Withdrawn: months to keep" type="number" min={1} max={120} value={withdrawn} onChange={(e) => setWithdrawn(e.target.value)} />
      </div>
      <label htmlFor="rt-on" className="flex items-center gap-2 text-sm">
        <input id="rt-on" type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Run the nightly removal
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
    </form>
  );
}
