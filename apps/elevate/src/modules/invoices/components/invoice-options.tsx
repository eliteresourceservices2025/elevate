"use client";

import { Archive, ArchiveRestore, ChevronDown, FilePenLine, Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { archiveInvoice, createInvoice, restoreInvoice, voidInvoice } from "../actions";

// What can be done with an invoice that was already made. It never changes: a mistake is fixed by a corrected version (the next -R number,
// which replaces it), a TEST invoice can be archived out of the list, and a REAL invoice is voided with a reason (kept, stamped VOID).

type State = "active" | "archived" | "voided" | "superseded";

function ReasonForm({ explain, confirmLabel, required, destructive, act }: { explain: string; confirmLabel: string; required: boolean; destructive?: boolean; act: (reason: string) => Promise<{ ok: boolean; error?: string }> }) {
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
        <Label htmlFor="invoice-reason">{required ? "Reason" : "Reason (optional)"}</Label>
        <Textarea id="invoice-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required={required} />
        <p className="text-xs text-muted-foreground">Kept with the invoice, never in notices. Don&apos;t write client or patient details.</p>
      </div>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
        {confirmLabel}
      </Button>
    </form>
  );
}

export function InvoiceOptionsMenu({ invoiceId, runId, clientId, isTest, state, canManage, canCreate }: { invoiceId: string; runId: string; clientId: string; isTest: boolean; state: State; canManage: boolean; canCreate: boolean }) {
  const { run, pending } = useRun();
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState<"archive" | "void" | null>(null);

  const canRevise = canCreate && state === "active";
  const canArchive = canManage && isTest && state === "active";
  const canRestore = canManage && isTest && state === "archived";
  const canVoid = canManage && !isTest && state === "active";
  if (!canRevise && !canArchive && !canRestore && !canVoid) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" disabled={pending} />}>
          Invoice options
          <ChevronDown className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {canRevise ? (
            <DropdownMenuItem
              onClick={async () => {
                const ok = await confirm({
                  title: "Make a corrected version?",
                  description: "A new version is made from the pay run's current hours and today's rates, with the next -R number. This invoice is then marked replaced. Nothing is deleted.",
                  confirmLabel: "Make corrected version",
                  cancelLabel: "Go back",
                });
                if (ok)
                  run(
                    () => createInvoice({ runId, clientId }),
                    (d) => (d ? `Invoice ${d.number} made.` : "Invoice made."),
                    (d) => {
                      if (d?.invoiceId) router.push(`/invoices/${d.invoiceId}`);
                    },
                  );
              }}
            >
              <FilePenLine aria-hidden /> Make a corrected version
            </DropdownMenuItem>
          ) : null}
          {canRestore ? (
            <DropdownMenuItem onClick={() => run(() => restoreInvoice({ invoiceId }), "Invoice restored.")}>
              <ArchiveRestore aria-hidden /> Restore this test invoice
            </DropdownMenuItem>
          ) : null}
          {canArchive || canVoid ? <DropdownMenuSeparator /> : null}
          {canArchive ? (
            <DropdownMenuItem variant="destructive" onClick={() => setOpen("archive")}>
              <Archive aria-hidden /> Archive this test invoice
            </DropdownMenuItem>
          ) : null}
          {canVoid ? (
            <DropdownMenuItem variant="destructive" onClick={() => setOpen("void")}>
              <Ban aria-hidden /> Void this invoice
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <FormDialog label="Archive" title="Archive this test invoice" open={open === "archive"} onOpenChange={(o) => setOpen(o ? "archive" : null)} hideTrigger>
        <ReasonForm
          explain="The test invoice leaves the list. It stays on record and you can restore it later. Nothing is deleted."
          confirmLabel="Archive this test invoice"
          required={false}
          destructive
          act={(reason) => archiveInvoice({ invoiceId, reason })}
        />
      </FormDialog>
      <FormDialog label="Void" title="Void this invoice" open={open === "void"} onOpenChange={(o) => setOpen(o ? "void" : null)} hideTrigger>
        <ReasonForm
          explain="A voided invoice is withdrawn: it stays on record, is stamped VOID on the page and the PDF, leaves the main list, and its number is never used again. This can't be undone."
          confirmLabel="Void this invoice"
          required
          destructive
          act={(reason) => voidInvoice({ invoiceId, reason })}
        />
      </FormDialog>
    </>
  );
}
