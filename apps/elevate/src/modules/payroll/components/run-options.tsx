"use client";

import { Archive, ArchiveRestore, ChevronDown, FlaskConical, Undo2 } from "lucide-react";
import { useState } from "react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { archivePayRun, markRunAsTest, restorePayRun } from "../actions";
import type { RunStatus } from "../constants";

// Test runs: a run can be marked as a practice run until it is paid, a test run can be archived (even once approved or paid) so the same
// pay cycle can be rehearsed again, and an archived one can be restored. A real run can never be archived. Every change needs a short
// reason, which is kept in the change history.

function ReasonForm({ explain, confirmLabel, destructive = false, act }: { explain: string; confirmLabel: string; destructive?: boolean; act: (reason: string) => Promise<{ ok: boolean; error?: string }> }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => act(reason), "Done.", () => dialog?.close(true));
      }}
    >
      <p className="text-sm text-muted-foreground">{explain}</p>
      <div className="space-y-1">
        <Label htmlFor="run-option-reason">Reason</Label>
        <Textarea id="run-option-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required />
        <p className="text-xs text-muted-foreground">Kept in the change history. Don&apos;t write client or patient details.</p>
      </div>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
        {confirmLabel}
      </Button>
    </form>
  );
}

export function RunOptionsMenu({ runId, status, isTest, archived }: { runId: string; status: RunStatus; isTest: boolean; archived: boolean }) {
  const { run, pending } = useRun();
  const [open, setOpen] = useState<"mark" | "real" | "archive" | null>(null);

  const canMark = !isTest && status !== "paid" && status !== "cancelled";
  const canUnmark = isTest && !archived && status === "draft";
  const canArchive = isTest && !archived;
  if (!canMark && !canUnmark && !canArchive && !archived) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" disabled={pending} />}>
          Run options
          <ChevronDown className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {canMark ? (
            <DropdownMenuItem onClick={() => setOpen("mark")}>
              <FlaskConical aria-hidden /> Mark as a test run
            </DropdownMenuItem>
          ) : null}
          {canUnmark ? (
            <DropdownMenuItem onClick={() => setOpen("real")}>
              <Undo2 aria-hidden /> Make this a real run
            </DropdownMenuItem>
          ) : null}
          {archived ? (
            <DropdownMenuItem onClick={() => run(() => restorePayRun({ runId }), "Run restored.")}>
              <ArchiveRestore aria-hidden /> Restore this run
            </DropdownMenuItem>
          ) : null}
          {canArchive ? (
            <>
              {canMark || canUnmark ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem variant="destructive" onClick={() => setOpen("archive")}>
                <Archive aria-hidden /> Archive this test run
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <FormDialog label="Mark as a test run" title="Mark this run as a test run" open={open === "mark"} onOpenChange={(o) => setOpen(o ? "mark" : null)} hideTrigger>
        <ReasonForm
          explain="A test run is kept apart from real runs: it may repeat a period that already has a run, nobody sees a payment statement from it, and invoices made from it are numbered TEST. You can archive it afterwards. A paid run can't be marked."
          confirmLabel="Mark as a test run"
          act={(reason) => markRunAsTest({ runId, test: true, reason })}
        />
      </FormDialog>
      <FormDialog label="Make this a real run" title="Make this a real run again" open={open === "real"} onOpenChange={(o) => setOpen(o ? "real" : null)} hideTrigger>
        <ReasonForm
          explain="Only a draft can go back to being a real run, and only if no other real run covers the same period."
          confirmLabel="Make this a real run"
          act={(reason) => markRunAsTest({ runId, test: false, reason })}
        />
      </FormDialog>
      <FormDialog label="Archive" title="Archive this test run" open={open === "archive"} onOpenChange={(o) => setOpen(o ? "archive" : null)} hideTrigger>
        <ReasonForm
          explain="The run leaves the list and its period is free for another run. It stays on record and you can restore it later. Nothing is deleted."
          confirmLabel="Archive this test run"
          destructive
          act={(reason) => archivePayRun({ runId, reason })}
        />
      </FormDialog>
    </>
  );
}
