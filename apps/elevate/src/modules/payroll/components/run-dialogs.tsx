"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRun } from "@/modules/recruiting/components/use-run";
import { createPayRun, setRunUsdRate } from "../actions";
import { WORKSHEET_LABELS as L } from "../constants";

function NewRunForm({ suggestedStart, suggestedEnd }: { suggestedStart: string; suggestedEnd: string }) {
  const { run, pending } = useRun();
  const router = useRouter();
  const dialog = useFormDialog();
  const [periodStart, setStart] = useState(suggestedStart);
  const [periodEnd, setEnd] = useState(suggestedEnd);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createPayRun({ periodStart, periodEnd }),
          "Run created.",
          (data) => {
            dialog?.close(true);
            if (data?.runId) router.push(`/payroll/${data.runId}`);
          },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">One line is made for each pay line in force during the period. A period can&apos;t overlap another run.</p>
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

function UsdRateForm({ runId, current }: { runId: string; current: string | null }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [rate, setRate] = useState(current ?? "");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setRunUsdRate({ runId, rate }), "Dollar rate saved.", () => dialog?.close(true));
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="usd-rate">Pesos for one dollar</Label>
        <Input id="usd-rate" inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="58.50" />
        <p className="text-xs text-muted-foreground">Used for every dollar allowance on this run. Leave blank to clear it.</p>
      </div>
      <Button type="submit" disabled={pending}>
        Save rate
      </Button>
    </form>
  );
}

export function UsdRateDialog({ runId, current }: { runId: string; current: string | null }) {
  return (
    <FormDialog label={`${L.dollarRate}: ${current ?? L.noRate}`} title="Dollar rate for this run" variant="outline">
      <UsdRateForm runId={runId} current={current} />
    </FormDialog>
  );
}
