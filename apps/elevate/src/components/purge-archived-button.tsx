"use client";

import { Trash2 } from "lucide-react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { purgeArchivedInvoices } from "@/modules/invoices/actions";
import { purgeArchivedPayRuns } from "@/modules/payroll/actions";
import { useRun } from "@/modules/recruiting/components/use-run";

// Deleting archived test data for good. Each button asks first, says it cannot be undone, then says what was deleted. The pages pass only
// plain values (a count); the actions are imported here, because a function can't be handed from a server page to a client component.

function Confirm<T>({ explain, confirmLabel, act, done }: { explain: string; confirmLabel: string; act: () => Promise<{ ok: boolean; error?: string; data?: T }>; done: (data: T | undefined) => string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  return (
    <div className="space-y-3">
      <Alert variant="destructive">This cannot be undone. The deleted records are gone for good.</Alert>
      <p className="text-sm text-muted-foreground">{explain}</p>
      <Button type="button" variant="destructive" disabled={pending} onClick={() => run(act, done, () => dialog?.close(true))}>
        {confirmLabel}
      </Button>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function PurgeArchivedRunsButton() {
  const label = "Delete archived runs for good";
  return (
    <FormDialog label={label} title={label} variant="outline" icon={<Trash2 className="size-4" aria-hidden />} triggerSize="sm">
      <Confirm
        explain="Deletes every archived test run and every archived cancelled run, with their lines, payments, history and test invoices. Real runs that were approved or paid are never deleted. A run stays if it has a real invoice or an invoice that is not archived yet."
        confirmLabel={label}
        act={purgeArchivedPayRuns}
        done={(d) => (d ? `Deleted ${plural(d.runsDeleted, "run", "runs")} and ${plural(d.invoicesDeleted, "invoice", "invoices")}.${d.runsKept > 0 ? ` ${d.runsKept} stayed (check their invoices).` : ""}` : "Done.")}
      />
    </FormDialog>
  );
}

export function PurgeArchivedInvoicesButton({ count }: { count: number }) {
  const label = "Delete archived test invoices for good";
  return (
    <FormDialog label={label} title={label} variant="outline" icon={<Trash2 className="size-4" aria-hidden />} triggerSize="sm">
      <Confirm
        explain={`Deletes the ${plural(count, "archived test invoice", "archived test invoices")}. Real invoices (including void ones) and test invoices that are not archived are never deleted.`}
        confirmLabel={label}
        act={purgeArchivedInvoices}
        done={(d) => (d ? `Deleted ${plural(d.deleted, "test invoice", "test invoices")}.${d.kept > 0 ? ` ${d.kept} stayed because a newer invoice replaced them.` : ""}` : "Done.")}
      />
    </FormDialog>
  );
}
