"use client";

import { useState } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { confirmRunLine, dismissPayItem, savePayItem } from "../actions";
import { PAY_ITEM_LABELS, PAY_ITEM_TYPES, REASON_REQUIRED_TYPES, type PayItemType } from "../constants";
import { ITEM_UNIT_HINTS, itemUnit } from "../items";
import type { WorksheetLine } from "../runs";

// Amounts for one line of a draft run. Reasons are kept in the change history, never in notices.

function ItemForm({ runId, line }: { runId: string; line: WorksheetLine }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [type, setType] = useState<PayItemType>("late_minutes");
  const current = line.items.find((i) => i.type === type && i.state !== "dismissed");
  const suggested = current?.state === "suggested";
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const needsReason = REASON_REQUIRED_TYPES.includes(type) || suggested;

  return (
    <div className="space-y-4">
      {line.items.filter((i) => i.state !== "dismissed").length > 0 ? (
        <ul className="space-y-2" aria-label="Amounts on this line">
          {line.items
            .filter((i) => i.state !== "dismissed")
            .map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <span>
                  <span className="font-medium">{PAY_ITEM_LABELS[i.type]}</span>: {i.value}
                  {i.state === "suggested" ? <span className="ml-2 text-xs text-muted-foreground">Suggested, not yet confirmed</span> : null}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if ((REASON_REQUIRED_TYPES.includes(i.type) || i.state === "suggested") && reason.trim() === "") return void toast.error("Write the reason in the Reason box first.");
                    run(() => dismissPayItem({ runId, itemId: i.id, reason }), "Amount removed.");
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
        </ul>
      ) : null}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => savePayItem({ runId, employeeId: line.employeeId, runLineId: line.runLineId, type, value, reason }), "Amount saved.", () => {
            setValue("");
            setReason("");
            dialog?.close(true);
          });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`item-type-${line.runLineId}`}>What to enter</Label>
          <NativeSelect id={`item-type-${line.runLineId}`} value={type} onChange={(e) => setType(e.target.value as PayItemType)}>
            {PAY_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAY_ITEM_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`item-value-${line.runLineId}`}>Amount</Label>
          <Input id={`item-value-${line.runLineId}`} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} required />
          <p className="text-xs text-muted-foreground">{ITEM_UNIT_HINTS[itemUnit(type)]} A reduction is entered as a loan or other deduction, never as a negative amount.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`item-reason-${line.runLineId}`}>{needsReason ? "Reason" : "Reason (optional)"}</Label>
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

export function ItemDialog({ runId, line }: { runId: string; line: WorksheetLine }) {
  return (
    <FormDialog label="Amounts" title={`Amounts for ${line.name}`} description="Saving recomputes this person's pay and asks for a new check of the line." variant="outline" triggerSize="sm" size="lg" disabled={line.unreadable} hint="This line can't be read, so it can't be changed from here.">
      <ItemForm runId={runId} line={line} />
    </FormDialog>
  );
}

export function ConfirmLineButton({ line }: { line: WorksheetLine }) {
  const { run, pending } = useRun();
  if (line.isOwn) return <span className="text-xs text-muted-foreground">Your own line. Another Preparer checks it.</span>;
  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={pending || line.unreadable || line.confirmedByMe} onClick={() => run(() => confirmRunLine({ runLineId: line.runLineId }), "Line checked.")}>
        {line.confirmedByName ? "Check again" : "Mark as checked"}
      </Button>
    </>
  );
}
