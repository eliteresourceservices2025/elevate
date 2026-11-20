"use client";

import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldHint, HintedLabel } from "@/components/field-hint";
import { PAYROLL_HINTS } from "../hints";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { savePaySettings } from "../actions";
import { DEFAULT_OT_BP, HOLIDAY_BP } from "../calculate";
import { formatPesos } from "../money";
import { EXTRA_KEY_FORM, EXTRA_KEY_ITEM, OT_SETTING_KEYS, PAY_ITEM_LABELS, SETTINGS_LABELS as S } from "../constants";
import type { PaySettingsView, SettingsVersion } from "../queries";

// The three overtime (OT) rates the sheet owner supplies, with the label each one has on a pay run (one source: constants.ts). Holiday pay is always one to one.
const RATE_FIELDS = OT_SETTING_KEYS.map((key) => ({ key, form: EXTRA_KEY_FORM[key], label: PAY_ITEM_LABELS[EXTRA_KEY_ITEM[key]] }));

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
          <HintedLabel htmlFor="set-from" hint={PAYROLL_HINTS.settingsStartsOn}>{S.startsOn}</HintedLabel>
          <Input id="set-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <HintedLabel htmlFor="set-divisor" hint={PAYROLL_HINTS.settingsDivisor}>{S.divisor}</HintedLabel>
          <Input id="set-divisor" type="number" inputMode="numeric" min={1} max={31} step={1} value={divisor} onChange={(e) => setDivisor(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <HintedLabel htmlFor="set-warn" hint={PAYROLL_HINTS.settingsWarn}>{S.warn}</HintedLabel>
          <Input id="set-warn" type="number" inputMode="numeric" min={1} max={100} step={1} value={warn} onChange={(e) => setWarn(e.target.value)} required />
        </div>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
          {S.ratesLegend}
          <FieldHint label="Standard overtime rates">{PAYROLL_HINTS.settingsOt}</FieldHint>
        </legend>
        {RATE_FIELDS.map((f) => (
          <div key={f.form} className="space-y-1">
            <Label htmlFor={`set-${f.form}`}>{f.label}</Label>
            <Input
              id={`set-${f.form}`}
              inputMode="decimal"
              value={rates[f.form]}
              onChange={(e) => setRates({ ...rates, [f.form]: e.target.value })}
              placeholder={`Standard ${DEFAULT_OT_BP[f.key] / 100}`}
              autoComplete="off"
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground sm:col-span-2">This is the standard for everyone. 125 means 1.25 times the person&apos;s own hourly rate. A person who is paid differently gets their own percents on their pay line (Rates tab); a blank box there uses these. Leave a box here blank to use the built-in standard (125 regular, 130 rest day, 169 rest day past 8 hours).</p>
      </fieldset>
      <div className="space-y-1">
        <HintedLabel htmlFor="set-reason" hint={PAYROLL_HINTS.settingsReason}>{S.reasonOptional}</HintedLabel>
        <Textarea id="set-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
      </div>
      <Button type="submit" disabled={pending}>
        Save settings
      </Button>
    </form>
  );
}

const cell = (bp: number | null, key: keyof typeof DEFAULT_OT_BP) => (bp === null ? `Standard ${DEFAULT_OT_BP[key] / 100}%` : `${percentOf(bp)}%`);

export function SettingsView({ view, today }: { view: PaySettingsView; today: string }) {
  const { current, history, canManage } = view;
  if (!current) {
    // No version is dated today or earlier (the first one is normally added by the migration).
    const starter: SettingsVersion = { effectiveFrom: today, cutoffDivisor: 11, changeWarnBp: 1000, multipliersBp: { regular: null, restDay: null, restDayOver8: null, holiday: HOLIDAY_BP } };
    return (
      <EmptyState
        title={S.noneTitle}
        description={S.noneDescription}
        action={
          canManage ? (
            <FormDialog label={S.changeButton} title={S.changeTitle} size="lg">
              <ChangeSettingsForm current={starter} today={today} />
            </FormDialog>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          In force today: version starting {current.effectiveFrom}. Changes apply from their start date and old versions stay on record.
        </p>
        {canManage ? (
          <FormDialog label={S.changeButton} title={S.changeTitle} description="Saved as a new version with its own start date." size="lg">
            <ChangeSettingsForm current={current} today={today} />
          </FormDialog>
        ) : null}
      </div>
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>{S.startsOn}</TableHead>
            <TableHead>{S.divisor}</TableHead>
            <TableHead>{S.warnShort}</TableHead>
            {RATE_FIELDS.map((f) => (
              <TableHead key={f.key}>{f.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((h) => (
            <TableRow key={`${h.effectiveFrom}-${h.cutoffDivisor}-${h.changeWarnBp}-${RATE_FIELDS.map((f) => h.multipliersBp[f.key]).join("-")}`}>
              <TableCell label={S.startsOn} className="font-medium">
                {h.effectiveFrom}
                {h.effectiveFrom === current.effectiveFrom ? <span className="block text-xs text-muted-foreground">In force</span> : null}
              </TableCell>
              <TableCell label={S.divisor}>{h.cutoffDivisor}</TableCell>
              <TableCell label={S.warnShort}>{h.changeWarnBp / 100}%</TableCell>
              {RATE_FIELDS.map((f) => (
                <TableCell key={f.key} label={f.label}>
                  {cell(h.multipliersBp[f.key], f.key)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
