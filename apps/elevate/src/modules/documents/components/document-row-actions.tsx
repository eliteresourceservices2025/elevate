"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RowActions } from "@/components/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { useAsk } from "@/components/confirm-dialog";
import { archiveDocument, bulkUpdateDocuments, moveDocument, verifyDocument } from "../actions";
import type { DocumentRow, FolderRow } from "../queries";
import { canPreview } from "../files";
import { PreviewButton } from "./document-preview";
import { DownloadButton } from "./download-button";
import { CategorizeDocument, type CategorizeOptions } from "./categorize-document";
import { RenameDocument } from "./rename-document";

export function DocumentRowActions({
  row,
  viewerIsHr,
  showAudience,
  folders,
  categorize,
}: {
  row: DocumentRow;
  viewerIsHr: boolean;
  showAudience: boolean;
  folders?: FolderRow[];
  categorize?: CategorizeOptions;
}) {
  const [dialog, setDialog] = useState<"rename" | "type" | "move" | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ask = useAsk();
  const editable = !row.archived && (viewerIsHr || !row.verified);
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    start(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Could not change the document.");
        toast.success(message);
        router.refresh();
      } catch {
        toast.error("Could not reach ELEVATE. Try again.");
      }
    });
  }
  const more = editable || (viewerIsHr && row.archived) || (folders && !row.archived);
  return (
    <>
      <RowActions
        label={row.title}
        disabled={pending}
        primary={
          <>
            {canPreview(row.mimeType, row.fileName) ? (
              <PreviewButton documentId={row.id} title={row.title} />
            ) : null}
            <DownloadButton documentId={row.id} label={row.title} />
          </>
        }
      >
        {more ? (
          <>
            {folders && !row.archived ? (
              <DropdownMenuItem onClick={() => setDialog("move")}>Move to folder</DropdownMenuItem>
            ) : null}
            {categorize && editable ? (
              <DropdownMenuItem onClick={() => setDialog("type")}>
                {row.typeSlug.startsWith("unsorted_") ? "Set type" : "Change type"}
              </DropdownMenuItem>
            ) : null}
            {viewerIsHr && !row.archived ? (
              <DropdownMenuItem onClick={() => setDialog("rename")}>Rename</DropdownMenuItem>
            ) : null}
            {viewerIsHr && !showAudience && !row.archived ? (
              <DropdownMenuItem
                onClick={() =>
                  run(
                    () => verifyDocument({ documentId: row.id, verified: !row.verified }),
                    row.verified ? "Verification removed." : "Marked as verified.",
                  )
                }
              >
                {row.verified ? "Unverify" : "Verify"}
              </DropdownMenuItem>
            ) : null}
            {editable ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    if (
                      await ask(
                        `Archive "${row.title}"? It is hidden from lists. The file is kept.`,
                      )
                    )
                      run(() => archiveDocument({ documentId: row.id }), "Document archived.");
                  }}
                >
                  Archive
                </DropdownMenuItem>
              </>
            ) : null}
            {viewerIsHr && row.archived ? (
              <DropdownMenuItem
                onClick={() =>
                  run(async () => {
                    const result = await bulkUpdateDocuments({
                      action: "restore",
                      documentIds: [row.id],
                    });
                    return !result.ok
                      ? result
                      : result.data.failed.length
                        ? { ok: false, error: result.data.failed[0].reason }
                        : { ok: true };
                  }, "Document restored.")
                }
              >
                Restore
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </RowActions>
      {viewerIsHr && !row.archived ? (
        <RenameDocument
          row={row}
          open={dialog === "rename"}
          onOpenChange={(open) => setDialog(open ? "rename" : null)}
        />
      ) : null}
      {categorize && editable ? (
        <CategorizeDocument
          row={row}
          options={categorize}
          open={dialog === "type"}
          onOpenChange={(open) => setDialog(open ? "type" : null)}
        />
      ) : null}
      {folders && !row.archived ? (
        <FormDialog
          label="Move to folder"
          title="Move to folder"
          description={row.title}
          open={dialog === "move"}
          onOpenChange={(open) => setDialog(open ? "move" : null)}
          hideTrigger
        >
          <MoveForm key={`${row.id}-${row.folderId}`} row={row} folders={folders} />
        </FormDialog>
      ) : null}
    </>
  );
}

function MoveForm({ row, folders }: { row: DocumentRow; folders: FolderRow[] }) {
  const [folderId, setFolderId] = useState(
    folders.some((f) => f.id === row.folderId) ? (row.folderId ?? "") : "",
  );
  const [pending, start] = useTransition();
  const dialog = useFormDialog();
  const router = useRouter();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const result = await moveDocument({ documentId: row.id, folderId: folderId || null });
            if (!result.ok) return void toast.error(result.error);
            toast.success("Document moved.");
            await dialog?.close(true);
            router.refresh();
          } catch {
            toast.error("Could not reach ELEVATE. Try again.");
          }
        });
      }}
    >
      <SelectField
        id={`move-${row.id}`}
        label="Folder"
        value={folderId}
        onChange={(e) => setFolderId(e.target.value)}
        disabled={pending}
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </SelectField>
      <Button type="submit" disabled={pending}>
        {pending ? "Moving…" : "Move document"}
      </Button>
    </form>
  );
}
