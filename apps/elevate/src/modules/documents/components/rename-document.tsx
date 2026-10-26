"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { TextField } from "@/components/form-fields";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { renameDocument } from "../actions";
import type { DocumentRow } from "../queries";

/** HR: edit the file name. The extension (.pdf, .docx ...) always follows the real file type. */
export function RenameDocument({ row, open, onOpenChange }: { row: DocumentRow; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <FormDialog label="Rename" title="Rename the file" description={row.fileName} variant="outline" open={open} onOpenChange={onOpenChange} hideTrigger={open !== undefined}>
      <RenameForm row={row} />
    </FormDialog>
  );
}

function RenameForm({ row }: { row: DocumentRow }) {
  const router = useRouter();
  const dialog = useFormDialog();
  const dot = row.fileName.lastIndexOf(".");
  const [name, setName] = useState(dot > 0 ? row.fileName.slice(0, dot) : row.fileName);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const result = await renameDocument({ documentId: row.id, name });
        setPending(false);
        if (!result.ok) return void toast.error(result.error);
        toast.success("File renamed.");
        dialog?.close(true);
        router.refresh();
      }}
    >
      <TextField id={`rn-${row.id}`} label="File name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} hint={dot > 0 ? `The ending ${row.fileName.slice(dot)} stays the same.` : undefined} required />
      <Button type="submit" disabled={pending || name.trim().length === 0}>
        Save
      </Button>
    </form>
  );
}
