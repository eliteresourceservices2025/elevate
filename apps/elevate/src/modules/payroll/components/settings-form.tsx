"use client";

import { useState } from "react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { savePaySettings } from "../actions";
import { formatPesos } from "../money";
import type { PaySettingsView, SettingsVersion } from "../queries";

// Labels for the five rates the sheet owner supplies. Copy says "extra hours", never "overtime".
const RATE_FIELDS = [
  { key: "regular", form: "extraRegular", label: "Extra hours, regular day" },
  { key: "holiday", form: "extraHoliday", label: "Extra hours, holiday" },
  { key: "restDay", form: "extraRestDay", label: "Extra hours, rest day" },
  { key: "restDayOver8", form: "extraRestDayOver8", label: "Extra hours, rest day past 8 hours" },
  { key: "holidayPay", form: "holiday", label: "Holiday pay" },
] as const;

/** Basis points as a percent of the normal rate: 12500 -> "125". */
const percentOf = (bp: number | null) => (bp === null ? "" : formatPesos(BigInt(bp)).replace(/\.00$/, ""));

function ChangeSettingsForm({ current, today }: { current: SettingsVersion; today: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [divisor, setDivisor] = useState(String(current.cutoffDivisor));
  const [warn, setWarn] = useState(String(current.changeWarnBp / 100));
  const [rates, setRates] = useState<Record<string, string>>(Object.fromEntries(RATE_FIELDS.map((f) => [f.form, percentOf(current.multipliersBp[f.key])])));
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => savePaySettings({ effectiveFrom, cutoffDivisor: Number(divisor), changeWarnPercent: Number(warn), ...rates, reason }),
          "Settings saved.",
          () => dialog?.close(true),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="set-from">Starts on</Label>
          <Input id="set-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="set-divisor">Cutoff divisor</Label>
          <Input id="set-divisor" type="number" inputMode="numeric" min={1} max={31} step={1} value={divisor} onChange={(e) => setDivisor(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="set-warn">Warn when net pay changes by more than (percent)</Label>
          <Input id="set-warn" type="number" inputMode="numeric" min={1} max={100} step={1} value={warn} onChange={(e) => setWarn(e.target.value)} required />
        </div>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Rates, as a percent of the normal hourly rate</legend>
        {RATE_FIELDS.map((f) => (
          <div key={f.form} className="space-y-1">
            <Label htmlFor={`set-${f.form}`}>{f.label}</Label>
            <Input
              id={`set-${f.form}`}
              inputMode="decimal"
              value={rates[f.form]}
              onChange={(e) => setRates({ ...rates, [f.form]: e.target.value })}
              placeholder="Not set"
              autoComplete="off"
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground sm:col-span-2">125 means 1.25 times the normal rate. Leave blank until the figure is confirmed: a run that needs a missing rate is flagged, not guessed.</p>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="set-reason">Reason (optional)</Label>
        <Textarea id="set-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
      </div>
      <Button type="submit" disabled={pending}>
        Save settings
      </Button>
    </form>
  );
}

const cell = (bp: number | null) => (bp === null ? "Not set" : `${percentOf(bp)}%`);

export function SettingsView({ view, today }: { view: PaySettingsView; today: string }) {
  const { current, history, canManage } = view;
  const missing = RATE_FIELDS.filter((f) => current.multipliersBp[f.key] === null);
  return (
    <div className="space-y-4">
      {missing.length > 0 ? (
        <Alert variant="warning" role="note" className="rounded-lg p-3 text-sm">
          Not set yet: {missing.map((f) => f.label.toLowerCase()).join(", ")}. A pay run that needs one of these cannot be calculated until it is set.
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          In force today: version starting {current.effectiveFrom}. Changes apply from their start date and old versions stay on record.
        </p>
        {canManage ? (
          <FormDialog label="Change settings" title="Change pay settings" description="Saved as a new version with its own start date." size="lg">
            <ChangeSettingsForm current={current} today={today} />
          </FormDialog>
        ) : null}
      </div>
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>Starts</TableHead>
            <TableHead>Cutoff divisor</TableHead>
            <TableHead>Warn at</TableHead>
            {RATE_FIELDS.map((f) => (
              <TableHead key={f.key}>{f.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((h) => (
            <TableRow key={`${h.effectiveFrom}-${h.cutoffDivisor}-${h.changeWarnBp}-${RATE_FIELDS.map((f) => h.multipliersBp[f.key]).join("-")}`}>
              <TableCell label="Starts" className="font-medium">
                {h.effectiveFrom}
                {h.effectiveFrom === current.effectiveFrom ? <span className="block text-xs text-muted-foreground">In force</span> : null}
              </TableCell>
              <TableCell label="Cutoff divisor">{h.cutoffDivisor}</TableCell>
              <TableCell label="Warn at">{h.changeWarnBp / 100}%</TableCell>
              {RATE_FIELDS.map((f) => (
                <TableCell key={f.key} label={f.label}>
                  {cell(h.multipliersBp[f.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
