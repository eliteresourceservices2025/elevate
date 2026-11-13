"use client";

import { Trash2 } from "lucide-react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";

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

/** A destructive button that asks first, then deletes archived test data for good through `act`, and says what was deleted. */
export function PurgeArchivedButton<T>({
  label,
  title,
  explain,
  act,
  done,
}: {
  label: string;
  title: string;
  explain: string;
  act: () => Promise<{ ok: boolean; error?: string; data?: T }>;
  done: (data: T | undefined) => string;
}) {
  return (
    <FormDialog label={label} title={title} variant="outline" icon={<Trash2 className="size-4" aria-hidden />} triggerSize="sm">
      <Confirm explain={explain} confirmLabel={label} act={act} done={done} />
    </FormDialog>
  );
}
