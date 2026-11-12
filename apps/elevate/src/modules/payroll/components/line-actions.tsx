"use client";

import { CheckCheck, ChevronDown, PencilLine, UserMinus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRun } from "@/modules/recruiting/components/use-run";
import { confirmRunLine } from "../actions";
import type { WorksheetLine } from "../runs";
import { ItemDialog } from "./item-dialog";
import { RemovePersonDialog } from "./run-dialogs";

// One menu per row instead of three buttons, so the actions column stays narrow. The two dialogs live outside the menu (a menu closes
// as soon as an item is picked, which would close a dialog that sat inside it) and are opened from the items.

export function LineActions({ runId, line, correctableRuns }: { runId: string; line: WorksheetLine; correctableRuns: { id: string; label: string }[] }) {
  const { run, pending } = useRun();
  const [amountsOpen, setAmountsOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" disabled={pending} aria-label={`Actions for ${line.name}`} className="pointer-coarse:h-10 pointer-coarse:px-4" />}>
          Actions
          <ChevronDown className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem disabled={line.unreadable} onClick={() => setAmountsOpen(true)}>
            <PencilLine aria-hidden /> Amounts
          </DropdownMenuItem>
          {line.isOwn ? (
            <DropdownMenuItem disabled>
              <CheckCheck aria-hidden /> Your own line: another Preparer checks it
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={line.unreadable || line.confirmedByMe} onClick={() => run(() => confirmRunLine({ runLineId: line.runLineId }), "Line checked.")}>
              <CheckCheck aria-hidden /> {line.confirmedByName ? "Check again" : "Mark as checked"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setRemoveOpen(true)}>
            <UserMinus aria-hidden /> Remove from this run
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ItemDialog runId={runId} line={line} correctableRuns={correctableRuns} open={amountsOpen} onOpenChange={setAmountsOpen} hideTrigger />
      <RemovePersonDialog runId={runId} runLineId={line.runLineId} name={line.name} open={removeOpen} onOpenChange={setRemoveOpen} hideTrigger />
    </>
  );
}
