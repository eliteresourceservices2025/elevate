"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { cancelPayRun, createPayRun, removePersonFromRun, restorePersonToRun } from "../actions";
import { WORKSHEET_LABELS as L } from "../constants";

function NewRunForm({ suggestedStart, suggestedEnd }: { suggestedStart: string; suggestedEnd: string }) {
  const { run, pending } = useRun();
  const router = useRouter();
  const dialog = useFormDialog();
  const [periodStart, setStart] = useState(suggestedStart);
  const [periodEnd, setEnd] = useState(suggestedEnd);
  const [test, setTest] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createPayRun({ periodStart, periodEnd, test }),
          "Run created.",
          (data) => {
            dialog?.close(true);
            if (data?.runId) router.push(`/payroll/${data.runId}`);
          },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">
        A run covers one cutoff: the 1st to the 15th, or the 16th to the last day of the month (a test run can cover any dates). One line is made for each pay line in force during it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="run-start">First day</Label>
          <Input id="run-start" type="date" value={periodStart} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="run-end">Last day</Label>
          <Input id="run-end" type="date" value={periodEnd} onChange={(e) => setEnd(e.target.value)} required />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <input id="run-test" type="checkbox" className="mt-1 size-4 accent-primary" checked={test} onChange={(e) => setTest(e.target.checked)} />
        <div>
          <Label htmlFor="run-test">This is a test run</Label>
          <p className="text-xs text-muted-foreground">A practice run can repeat a period that already has a run, and nobody sees a payment statement from it. You can archive it later.</p>
          {test ? <p className="mt-1 text-xs text-muted-foreground">A test run can cover any dates, up to 31 days: part of a cutoff, or the dates of a Jibble file. Its base pay is still a full cutoff unless you enter the days worked as amounts.</p> : null}
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Create run
      </Button>
    </form>
  );
}

export function NewRunDialog({ suggestedStart, suggestedEnd }: { suggestedStart: string; suggestedEnd: string }) {
  return (
    <FormDialog label={L.newRun} title="Start a pay run" icon={<Plus className="size-4" aria-hidden />}>
      <NewRunForm suggestedStart={suggestedStart} suggestedEnd={suggestedEnd} />
    </FormDialog>
  );
}

function CancelRunForm({ runId }: { runId: string }) {
  const { run, pending } = useRun();
  const router = useRouter();
  const dialog = useFormDialog();
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => cancelPayRun({ runId, reason }), "Run cancelled.", () => {
          dialog?.close(true);
          router.push("/payroll");
        });
      }}
    >
      <p className="text-sm text-muted-foreground">The run stays on record but can no longer be changed or sent. Its period is free for a new run.</p>
      <div className="space-y-1">
        <Label htmlFor="cancel-reason">Reason</Label>
        <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required />
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        Cancel this run
      </Button>
    </form>
  );
}

export function CancelRunDialog({ runId }: { runId: string }) {
  return (
    <FormDialog label="Cancel run" title="Cancel this run" variant="outline">
      <CancelRunForm runId={runId} />
    </FormDialog>
  );
}

function RemovePersonForm({ runId, runLineId, name }: { runId: string; runLineId: string; name: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => removePersonFromRun({ runId, runLineId, reason }), `${name} taken off the run.`, () => dialog?.close(true));
      }}
    >
      <p className="text-sm text-muted-foreground">
        The line and any amounts you entered stay on record but are ignored: this person is not in the totals, the Remitly list or the approval. You can put them back from the list under the worksheet.
      </p>
      <div className="space-y-1">
        <Label htmlFor={`remove-reason-${runLineId}`}>Reason</Label>
        <Textarea id={`remove-reason-${runLineId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required />
        <p className="text-xs text-muted-foreground">Kept in the change history, never in notices. Don&apos;t write client or patient details.</p>
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        Take off this run
      </Button>
    </form>
  );
}

export function RemovePersonDialog({ runId, runLineId, name, open, onOpenChange, hideTrigger }: { runId: string; runLineId: string; name: string; open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean }) {
  return (
    <FormDialog label="Remove" title={`Take ${name} off this run`} variant="outline" triggerSize="sm" open={open} onOpenChange={onOpenChange} hideTrigger={hideTrigger}>
      <RemovePersonForm runId={runId} runLineId={runLineId} name={name} />
    </FormDialog>
  );
}

/** People taken off this draft run, each with a button to put them back. */
export function RemovedPeople({ runId, removed }: { runId: string; removed: { runLineId: string; name: string; alias: string | null }[] }) {
  const { run, pending } = useRun();
  if (removed.length === 0) return null;
  return (
    <section aria-label="People taken off this run" className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">Taken off this run ({removed.length})</h2>
      <ul className="space-y-1">
        {removed.map((r) => (
          <li key={r.runLineId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {r.name}
              {r.alias ? <span className="text-muted-foreground"> ({r.alias})</span> : null}
            </span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => restorePersonToRun({ runId, runLineId: r.runLineId }), `${r.name} is back on the run.`)}>
              Put back
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
