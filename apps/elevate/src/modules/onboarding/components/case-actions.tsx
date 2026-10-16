"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { cancelOffboarding, completeOffboarding, completeOnboarding, issueCertificate, removeAccessNow, startOffboarding, startOnboarding, submitExitInterview } from "../actions";
import { PeoplePicker } from "./people-picker";
import { LEAVING_LABELS, LEAVING_REASONS, type LeavingReason } from "../constants";

export function CompleteOnboardingButton({ caseId, ready }: { caseId: string; ready: boolean }) {
  const { run, pending } = useRun();
  return (
    <div className="space-y-1">
      <Button disabled={pending || !ready} onClick={() => run(() => completeOnboarding({ caseId }), "Onboarding complete. The person is now active.")}>
        Complete onboarding
      </Button>
      {ready ? null : <p className="text-xs text-muted-foreground">Every required task has to be done first.</p>}
    </div>
  );
}

/** HR's controls on an offboarding: remove access now, cancel, complete, issue a certificate. */
export function OffboardingControls({ caseId, employeeId, accessRemoved, open, ready }: { caseId: string; employeeId: string; accessRemoved: boolean; open: boolean; ready: boolean }) {
  const { run, pending, router } = useRun();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">HR actions</h2>
      <div className="flex flex-wrap gap-2">
        {open && !accessRemoved ? (
          confirm ? (
            <>
              <Button variant="destructive" disabled={pending} onClick={() => run(() => removeAccessNow({ caseId }), "Access removed.", () => setConfirm(false))}>
                Yes, remove access now
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Never mind
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setConfirm(true)}>
              Remove access now
            </Button>
          )
        ) : null}
        {open && !accessRemoved ? (
          <Button variant="outline" disabled={pending} onClick={() => run(() => cancelOffboarding({ caseId }), "Offboarding cancelled.", () => router.push("/offboarding"))}>
            Cancel offboarding
          </Button>
        ) : null}
        {open && accessRemoved ? (
          <Button disabled={pending || !ready} onClick={() => run(() => completeOffboarding({ caseId }), "Offboarding complete.")}>
            Complete offboarding
          </Button>
        ) : null}
        <Button variant="outline" disabled={pending} onClick={() => run(() => issueCertificate({ employeeId }), (d) => `Certificate ${(d as { reference: string } | undefined)?.reference ?? ""} issued.`)}>
          Issue certificate of engagement
        </Button>
      </div>
      {confirm ? <p className="text-sm text-muted-foreground">They are marked separated, lose their client assignments and schedule, and can no longer sign in.</p> : null}
    </div>
  );
}

/** HR: open the onboarding checklist for a person who was added directly under People (not hired through Recruiting). */
type BatchResult = { id: string; name: string; ok: boolean; message: string; href?: string };

/** The outcome of starting several at once: who worked and who did not, and why. */
function BatchSummary({ results, kind }: { results: BatchResult[]; kind: "onboarding" | "offboarding" }) {
  const failed = results.filter((r) => !r.ok).length;
  return (
    <div role="status" className="space-y-2 rounded-xl border bg-card p-4 text-sm">
      <p className="font-medium">
        {results.length - failed} of {results.length} started{failed ? `, ${failed} could not be` : ""}.
      </p>
      <ul className="space-y-1">
        {results.map((r) => (
          <li key={r.id} className={r.ok ? undefined : "text-destructive"}>
            {r.ok && r.href ? (
              <Link href={r.href} className="text-primary underline-offset-2 hover:underline">
                {r.name}
              </Link>
            ) : (
              r.name
            )}
            : {r.message}
          </li>
        ))}
      </ul>
      {failed ? <p className="text-muted-foreground">The people who could not be started are still in the list. Fix the reason, then start them again ({kind}).</p> : null}
    </div>
  );
}

/** Starts the same thing for each chosen person, one at a time (each is checked and saved on its own), and reports every result. */
async function startEach(ids: string[], people: { id: string; name: string }[], start: (id: string) => Promise<{ ok: boolean; error?: string; data?: { caseId: string } }>, hrefFor: (caseId: string) => string): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  for (const id of ids) {
    const name = people.find((p) => p.id === id)?.name ?? "Someone";
    try {
      const r = await start(id);
      out.push(r.ok ? { id, name, ok: true, message: "started", href: r.data ? hrefFor(r.data.caseId) : undefined } : { id, name, ok: false, message: r.error ?? "Something went wrong." });
    } catch {
      out.push({ id, name, ok: false, message: "No connection. Try again." });
    }
  }
  return out;
}

export function StartOnboardingForm({ people, today }: { people: { id: string; name: string; position: string | null; startDate: string | null }[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ids, setIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(today);
  const [ownDates, setOwnDates] = useState(true);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const withOwn = ids.filter((id) => people.find((p) => p.id === id)?.startDate).length;
  return (
    <form
      className="max-w-2xl space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setResults(null);
        startTransition(async () => {
          const out = await startEach(ids, people, (id) => startOnboarding({ employeeId: id, startDate: ownDates ? (people.find((p) => p.id === id)?.startDate ?? startDate) : startDate }), (caseId) => `/onboarding/${caseId}`);
          if (out.length === 1 && out[0].ok && out[0].href) return void router.push(out[0].href);
          const started = out.filter((r) => r.ok).map((r) => r.id);
          setResults(out);
          setIds((prev) => prev.filter((id) => !started.includes(id)));
          if (started.length) toast.success(started.length === 1 ? "Onboarding started." : `Onboarding started for ${started.length} people.`);
          else toast.error("Nothing was started.");
          router.refresh();
        });
      }}
    >
      <PeoplePicker idPrefix="on" people={people} selected={ids} onChange={setIds} />
      <div className="space-y-1">
        <Label htmlFor="on-start">Start date</Label>
        <Input id="on-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Tasks are due relative to this day. The checklist comes from the template for their position, or the default one.</p>
      </div>
      {withOwn > 0 ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={ownDates} onChange={(e) => setOwnDates(e.target.checked)} />
          Use each person&apos;s own start date when they have one ({withOwn} of {ids.length})
        </label>
      ) : null}
      <Button type="submit" disabled={pending || ids.length === 0}>
        {ids.length > 1 ? `Start onboarding for ${ids.length} people` : "Start onboarding"}
      </Button>
      {results ? <BatchSummary results={results} kind="onboarding" /> : null}
    </form>
  );
}

export function StartOffboardingForm({ people, today }: { people: { id: string; name: string; position: string | null }[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ids, setIds] = useState<string[]>([]);
  const [lastWorkingDay, setLastWorkingDay] = useState(today);
  const [reason, setReason] = useState<LeavingReason>("resignation");
  const [note, setNote] = useState("");
  const [results, setResults] = useState<BatchResult[] | null>(null);
  return (
    <form
      className="max-w-2xl space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ids.length > 1 && !window.confirm(`Start offboarding for ${ids.length} people with the same last working day and reason?`)) return;
        setResults(null);
        startTransition(async () => {
          const out = await startEach(ids, people, (id) => startOffboarding({ employeeId: id, lastWorkingDay, reason, note }), (caseId) => `/offboarding/${caseId}`);
          if (out.length === 1 && out[0].ok && out[0].href) return void router.push(out[0].href);
          const started = out.filter((r) => r.ok).map((r) => r.id);
          setResults(out);
          setIds((prev) => prev.filter((id) => !started.includes(id)));
          if (started.length) toast.success(started.length === 1 ? "Offboarding started." : `Offboarding started for ${started.length} people.`);
          else toast.error("Nothing was started.");
          router.refresh();
        });
      }}
    >
      <PeoplePicker idPrefix="off" people={people} selected={ids} onChange={setIds} />
      <div className="space-y-1">
        <Label htmlFor="off-day">Last working day</Label>
        <Input id="off-day" type="date" value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Access is removed automatically when this day ends in their own time zone.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="off-reason">Reason</Label>
        <NativeSelect id="off-reason" value={reason} onChange={(e) => setReason(e.target.value as LeavingReason)}>
          {LEAVING_REASONS.map((r) => (
            <option key={r} value={r}>
              {/* eslint-disable-next-line security/detect-object-injection -- r comes from the fixed LEAVING_REASONS list */}
              {LEAVING_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor="off-note">Note (only HR sees it)</Label>
        <Textarea id="off-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
      <Button type="submit" disabled={pending || ids.length === 0}>
        {ids.length > 1 ? `Start offboarding for ${ids.length} people` : "Start offboarding"}
      </Button>
      {results ? <BatchSummary results={results} kind="offboarding" /> : null}
    </form>
  );
}

export function ExitInterviewForm({ caseId }: { caseId: string }) {
  const { run, pending } = useRun();
  const [reasonForLeaving, setReason] = useState("");
  const [wentWell, setWell] = useState("");
  const [toImprove, setImprove] = useState("");
  const [wouldReturn, setReturn] = useState<"yes" | "maybe" | "no">("maybe");
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => submitExitInterview({ caseId, reasonForLeaving, wentWell, toImprove, wouldReturn }), "Thank you. Your exit interview was sent to HR.");
      }}
    >
      <h2 className="text-lg font-semibold">Exit interview</h2>
      <p className="text-sm text-muted-foreground">Private: only HR reads it. Please do not include client or patient information.</p>
      <div className="space-y-1">
        <Label htmlFor="x-reason">Main reason for leaving</Label>
        <Textarea id="x-reason" value={reasonForLeaving} onChange={(e) => setReason(e.target.value)} maxLength={1000} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="x-well">What went well</Label>
        <Textarea id="x-well" value={wentWell} onChange={(e) => setWell(e.target.value)} maxLength={2000} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="x-improve">What could be better</Label>
        <Textarea id="x-improve" value={toImprove} onChange={(e) => setImprove(e.target.value)} maxLength={2000} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="x-return">Would you work with ERS again?</Label>
        <NativeSelect id="x-return" value={wouldReturn} onChange={(e) => setReturn(e.target.value as "yes" | "maybe" | "no")}>
          <option value="yes">Yes</option>
          <option value="maybe">Maybe</option>
          <option value="no">No</option>
        </NativeSelect>
      </div>
      <Button type="submit" disabled={pending || reasonForLeaving.trim().length < 3}>
        Submit
      </Button>
    </form>
  );
}
