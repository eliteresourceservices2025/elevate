"use client";

import { useState } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HintedLabel } from "@/components/field-hint";
import { PAYROLL_HINTS } from "../hints";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { dismissPayItem, savePayItem } from "../actions";
import { APPROVAL_LABELS, CORRECTION_TYPES, isItemized, ITEM_NAME_SUGGESTIONS, PAY_ITEM_LABELS, PAY_ITEM_TYPES, REASON_REQUIRED_TYPES, WORKSHEET_LABELS, type PayItemType } from "../constants";
import { ITEM_UNIT_HINTS, itemUnit, MAX_ITEM_LABEL, parseItemValue } from "../items";
import type { WorksheetLine } from "../runs";
import { ConfirmSuggestionButton } from "./suggestion-controls";

// Amounts for one line of a draft run. Reasons are kept in the change history, never in notices.

function ExistingItem({ runId, runLineId, item }: { runId: string; runLineId: string; item: WorksheetLine["items"][number] }) {
  const { run, pending } = useRun();
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const needsWhy = REASON_REQUIRED_TYPES.includes(item.type) || item.state === "suggested";
  return (
    <li className="space-y-2 rounded-lg border p-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-medium">{item.label ? `${PAY_ITEM_LABELS[item.type] ?? "Amount"}: ${item.label}` : (PAY_ITEM_LABELS[item.type] ?? "Amount")}</span>: {item.value}
          {item.state === "suggested" ? <span className="ml-2 text-xs text-muted-foreground">Suggested, not yet confirmed</span> : null}
        </span>
        {asking ? null : (
          <span className="flex gap-2">
            {item.state === "suggested" ? <ConfirmSuggestionButton runId={runId} itemId={item.id} runLineId={runLineId} /> : null}
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setAsking(true)}>
              Remove
            </Button>
          </span>
        )}
      </div>
      {asking ? (
        <div className="space-y-2">
          <Label htmlFor={`remove-reason-${item.id}`}>{needsWhy ? "Reason for removing" : "Reason for removing (optional)"}</Label>
          <Input id={`remove-reason-${item.id}`} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} autoComplete="off" />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (needsWhy && why.trim() === "") return void toast.error("Give a reason for removing this amount.");
                run(() => dismissPayItem({ runId, itemId: item.id, reason: why }), "Amount removed.");
              }}
            >
              Remove amount
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAsking(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

type CorrectableRun = { id: string; label: string };

function ItemForm({ runId, line, correctableRuns }: { runId: string; line: WorksheetLine; correctableRuns: CorrectableRun[] }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [type, setType] = useState<PayItemType>("late_minutes");
  const itemized = isItemized(type);
  // An itemized type (allowance, reimbursement, bonus, adjustment) can have many named lines, so there is no single current one.
  const current = itemized ? undefined : line.items.find((i) => i.type === type && i.state !== "dismissed");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  // Times (overtime, holiday pay, late, part cutoff) can be typed as hours or minutes: hours for overtime and holiday pay, minutes for late.
  const timed = itemUnit(type) === "minutes";
  const [pickedUnit, setPickedUnit] = useState<"h" | "m" | null>(null);
  const unit = pickedUnit ?? (type === "late_minutes" ? "m" : "h");
  const sentValue = timed && /^\d+(\.\d+)?$/.test(value.trim()) ? `${value.trim()} ${unit}` : value;
  const [reason, setReason] = useState("");
  const [corrects, setCorrects] = useState("");
  const canCorrect = CORRECTION_TYPES.includes(type);
  const correction = canCorrect ? corrects : "";
  // The same rule as the server: a reason for a deduction, a correction, or when the amount differs from a suggestion.
  const typed = parseItemValue(type, sentValue);
  const suggestedValue = current?.state === "suggested" ? parseItemValue(type, current.value) : null;
  const needsReason = REASON_REQUIRED_TYPES.includes(type) || correction !== "" || (suggestedValue !== null && typed !== suggestedValue);

  return (
    <div className="space-y-4">
      {line.items.some((i) => i.state !== "dismissed") ? (
        <ul className="space-y-2" aria-label="Amounts on this line">
          {line.items
            .filter((i) => i.state !== "dismissed")
            .map((i) => (
              <ExistingItem key={i.id} runId={runId} runLineId={line.runLineId} item={i} />
            ))}
        </ul>
      ) : null}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => savePayItem({ runId, employeeId: line.employeeId, runLineId: line.runLineId, type, value: sentValue, label: itemized ? name : "", reason, correctsRunId: correction }), "Amount saved.", () => {
            setName("");
            setValue("");
            setReason("");
            setCorrects("");
            dialog?.close(true);
          });
        }}
      >
        <div className="space-y-1">
          <HintedLabel htmlFor={`item-type-${line.runLineId}`} hint={PAYROLL_HINTS.itemType}>What to enter</HintedLabel>
          <NativeSelect id={`item-type-${line.runLineId}`} value={type} onChange={(e) => setType(e.target.value as PayItemType)}>
            {PAY_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAY_ITEM_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {itemized ? (
          <div className="space-y-1">
            <HintedLabel htmlFor={`item-name-${line.runLineId}`} hint={PAYROLL_HINTS.itemName}>Name of this {PAY_ITEM_LABELS[type].toLowerCase()}</HintedLabel>
            <Input id={`item-name-${line.runLineId}`} list={`item-names-${line.runLineId}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_ITEM_LABEL} autoComplete="off" required />
            <datalist id={`item-names-${line.runLineId}`}>
              {ITEM_NAME_SUGGESTIONS[type as keyof typeof ITEM_NAME_SUGGESTIONS].map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">It appears under this name on the contractor payment statement. Add as many as you need, one at a time.</p>
          </div>
        ) : null}
        <div className="space-y-1">
          <HintedLabel htmlFor={`item-value-${line.runLineId}`} hint={PAYROLL_HINTS.itemValue}>Amount</HintedLabel>
          <div className="flex gap-2">
            <Input id={`item-value-${line.runLineId}`} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} required />
            {timed ? (
              <NativeSelect aria-label="Hours or minutes" className="w-32 shrink-0" value={unit} onChange={(e) => setPickedUnit(e.target.value as "h" | "m")}>
                <option value="h">hours</option>
                <option value="m">minutes</option>
              </NativeSelect>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{ITEM_UNIT_HINTS[itemUnit(type)]} A reduction is entered as a loan or other deduction, never as a negative amount.</p>
        </div>
        {canCorrect && correctableRuns.length > 0 ? (
          <div className="space-y-1">
            <HintedLabel htmlFor={`item-corrects-${line.runLineId}`} hint={PAYROLL_HINTS.itemCorrects}>{WORKSHEET_LABELS.corrects}</HintedLabel>
            <NativeSelect id={`item-corrects-${line.runLineId}`} value={corrects} onChange={(e) => setCorrects(e.target.value)}>
              <option value="">{APPROVAL_LABELS.correctionNone}</option>
              {correctableRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{APPROVAL_LABELS.correctionHint}</p>
          </div>
        ) : null}
        <div className="space-y-1">
          <HintedLabel htmlFor={`item-reason-${line.runLineId}`} hint={PAYROLL_HINTS.itemReason}>{needsReason ? "Reason" : "Reason (optional)"}</HintedLabel>
          <Textarea id={`item-reason-${line.runLineId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required={needsReason} />
          <p className="text-xs text-muted-foreground">Kept in the change history, never in notices. Don&apos;t write client or patient details.</p>
        </div>
        <Button type="submit" disabled={pending}>
          Save amount
        </Button>
      </form>
    </div>
  );
}

type Controlled = { open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean };

export function ItemDialog({ runId, line, correctableRuns = [], open, onOpenChange, hideTrigger }: { runId: string; line: WorksheetLine; correctableRuns?: CorrectableRun[] } & Controlled) {
  return (
    <FormDialog label="Amounts" title={`Amounts for ${line.name}`} description="Saving recomputes this person's pay and asks for a new check of the line." variant="outline" triggerSize="sm" size="lg" disabled={line.unreadable} hint="This line can't be read, so it can't be changed from here." open={open} onOpenChange={onOpenChange} hideTrigger={hideTrigger}>
      <ItemForm runId={runId} line={line} correctableRuns={correctableRuns} />
    </FormDialog>
  );
}
