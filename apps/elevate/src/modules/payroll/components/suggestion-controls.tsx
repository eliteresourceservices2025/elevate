"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useRun } from "@/modules/recruiting/components/use-run";
import { assignSuggestion, confirmSuggestion, refreshSuggestions } from "../actions";
import { PAY_ITEM_LABELS, SUGGESTION_LABELS as S } from "../constants";
import type { Worksheet, WorksheetLine } from "../runs";

// Suggestions come from approved hours and never change pay until a Preparer confirms them.

export function RefreshSuggestionsButton({ runId }: { runId: string }) {
  const { run, pending } = useRun();
  return (
    <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => refreshSuggestions({ runId }), S.refreshed)}>
      <RefreshCw className="size-4" aria-hidden />
      {S.refresh}
    </Button>
  );
}

export function ConfirmSuggestionButton({ runId, itemId, runLineId }: { runId: string; itemId: string; runLineId: string }) {
  const { run, pending } = useRun();
  return (
    <Button type="button" size="sm" disabled={pending} onClick={() => run(() => confirmSuggestion({ runId, itemId, runLineId }), S.confirmed)}>
      {S.confirm}
    </Button>
  );
}

function AssignRow({ runId, item, lines }: { runId: string; item: Worksheet["unassigned"][number]["items"][number]; lines: WorksheetLine[] }) {
  const { run, pending } = useRun();
  const [lineId, setLineId] = useState("");
  const selectId = `assign-${item.id}`;
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-56 font-medium">
        {PAY_ITEM_LABELS[item.type] ?? "Amount"}: {item.value}
      </span>
      <label htmlFor={selectId} className="sr-only">
        {S.chooseLine}
      </label>
      <NativeSelect id={selectId} value={lineId} onChange={(e) => setLineId(e.target.value)} className="w-56">
        <option value="">{S.chooseLine}</option>
        {lines.map((l) => (
          <option key={l.runLineId} value={l.runLineId}>
            {l.alias ?? l.clientName ?? S.thisLine}
          </option>
        ))}
      </NativeSelect>
      <Button type="button" size="sm" variant="outline" disabled={pending || lineId === ""} onClick={() => run(() => assignSuggestion({ runId, itemId: item.id, runLineId: lineId }), S.assigned)}>
        {S.assign}
      </Button>
      <Button type="button" size="sm" disabled={pending || lineId === ""} onClick={() => run(() => confirmSuggestion({ runId, itemId: item.id, runLineId: lineId }), S.confirmed)}>
        {S.assignAndConfirm}
      </Button>
    </li>
  );
}

/** Suggestions for a person with two or more pay lines: a line must be chosen before the run can be sent for review. */
export function UnassignedSuggestions({ sheet, canPrepare }: { sheet: Worksheet; canPrepare: boolean }) {
  if (sheet.unassigned.length === 0) return null;
  return (
    <Alert variant="warning" className="space-y-3 rounded-lg p-3 text-sm">
      <p className="font-medium">{S.unassignedTitle}</p>
      {sheet.unassigned.map((u) => {
        const own = sheet.lines.filter((l) => l.employeeId === u.employeeId);
        return (
          <div key={u.employeeId} className="space-y-2">
            <p>{u.name}</p>
            {canPrepare && sheet.run.status === "draft" ? (
              <ul className="space-y-2">
                {u.items.map((i) => (
                  <AssignRow key={i.id} runId={sheet.run.id} item={i} lines={own} />
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </Alert>
  );
}
