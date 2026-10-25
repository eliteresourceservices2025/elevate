"use client";

import { Download, File, FileImage, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/run-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/time";
import { CategorizeDocument, type CategorizeOptions } from "./categorize-document";
import { archiveDocument, bulkUpdateDocuments, getDownloadUrl, moveDocument, verifyDocument, type BulkDocumentsResult } from "../actions";
import { DocumentBulkBar } from "./document-bulk-bar";
import { bulkBoxProps } from "../bulk-box";
import { RenameDocument } from "./rename-document";
import type { ExpiryStatus } from "../expiry";
import { canPreview, formatBytes } from "../files";
import type { DocumentRow, FolderRow } from "../queries";
import { PreviewButton } from "./document-preview";
import { TypeBadge } from "./type-badge";

/** A small icon for the kind of file (PDF, picture, Word), so the file name line reads at a glance. */
function FileKindIcon({ mime }: { mime: string | null }) {
  const className = "size-3.5 shrink-0";
  if (mime?.startsWith("image/")) return <FileImage className={className} aria-hidden />;
  if (mime === "application/pdf") return <FileText className={className} aria-hidden />;
  return <File className={className} aria-hidden />;
}

export function ExpiryBadge({ status, expiresOn }: { status: ExpiryStatus; expiresOn: string | null }) {
  if (status === "none" || !expiresOn) return <span className="text-muted-foreground">No expiry</span>;
  const variant = status === "expired" ? "destructive" : status === "expiring" ? "default" : "secondary";
  const label = status === "expired" ? "Expired" : status === "expiring" ? "Expiring" : "Valid";
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <Badge variant={variant}>{label}</Badge>
      <span className="text-xs text-muted-foreground">{formatDateOnly(expiresOn)}</span>
    </span>
  );
}

export function DownloadButton({ documentId, label }: { documentId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={pending}
      aria-label={`Download ${label}`}
      onClick={() =>
        startTransition(async () => {
          const result = await getDownloadUrl({ documentId });
          if (!result.ok) return void toast.error(result.error);
          // The link is valid for 60 seconds and saves the file instead of opening it.
          window.location.assign(result.data.url);
        })
      }
    >
      <Download aria-hidden /> Download
    </Button>
  );
}

/** A person's or the company's documents, with the actions the viewer is allowed to take. */
export function DocumentList({
  rows,
  viewerIsHr,
  showAudience = false,
  emptyText = "No documents yet.",
  folders,
  categorize,
}: {
  rows: DocumentRow[];
  viewerIsHr: boolean;
  showAudience?: boolean;
  emptyText?: string;
  /** When given, each open document gets a "Move to" choice with these folders. */
  folders?: FolderRow[];
  /** When given, each open document gets a "Set type" / "Change type" button. */
  categorize?: CategorizeOptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formId = `docs-bulk-${useId()}`;
  /** A bulk call for one file: its single failure reason becomes the error. */
  const single = (r: ActionResult<BulkDocumentsResult>): { ok: boolean; error?: string } =>
    !r.ok ? r : r.data.failed.length > 0 ? { ok: false, error: r.data.failed[0].reason } : { ok: true };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      router.refresh();
    });

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <div className="space-y-3">
    {viewerIsHr ? <DocumentBulkBar formId={formId} /> : null}
    <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            {viewerIsHr ? <TableHead className="w-8"><span className="sr-only">Select</span></TableHead> : null}
            <TableHead>Type</TableHead>
            <TableHead>Document</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className={r.archived ? "opacity-60" : undefined}>
              {viewerIsHr ? (
                <TableCell>
                  <input {...bulkBoxProps(formId)} value={r.id} aria-label={`Select ${r.title}`} className="size-4 accent-primary" />
                </TableCell>
              ) : null}
              <TableCell>
                <TypeBadge slug={r.typeSlug} name={r.typeName} />
              </TableCell>
              <TableCell>
                <div className="font-medium">{r.title}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileKindIcon mime={r.mimeType} />
                  <span>
                    {r.clientName ? `${r.clientName} · ` : ""}
                    {r.fileName}
                    {r.sizeBytes ? ` (${formatBytes(r.sizeBytes)})` : ""}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <ExpiryBadge status={r.expiry} expiresOn={r.expiresOn} />
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {r.archived ? <Badge variant="outline">Archived</Badge> : null}
                  {showAudience ? (
                    <Badge variant="outline">{r.audience === "hr_only" ? "HR only" : "All staff"}</Badge>
                  ) : r.verified ? (
                    <Badge variant="secondary">Verified</Badge>
                  ) : (
                    <Badge variant="outline">Not verified</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  {folders && !r.archived ? (
                    <select
                      aria-label={`Move ${r.title} to a folder`}
                      className="h-6 max-w-44 rounded-md border bg-background px-1 text-xs"
                      value={r.folderId && folders.some((f) => f.id === r.folderId) ? r.folderId : ""}
                      disabled={pending}
                      onChange={(e) => run(() => moveDocument({ documentId: r.id, folderId: e.target.value || null }), "Document moved.")}
                    >
                      <option value="">No folder</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {categorize && !r.archived && (viewerIsHr || !r.verified) ? <CategorizeDocument row={r} options={categorize} /> : null}
                  {canPreview(r.mimeType, r.fileName) ? <PreviewButton documentId={r.id} title={r.title} /> : null}
                  <DownloadButton documentId={r.id} label={r.title} />
                  {viewerIsHr && !showAudience && !r.archived ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={pending}
                      onClick={() => run(() => verifyDocument({ documentId: r.id, verified: !r.verified }), r.verified ? "Verification removed." : "Marked as verified.")}
                    >
                      {r.verified ? "Unverify" : "Verify"}
                    </Button>
                  ) : null}
                  {viewerIsHr && !r.archived ? <RenameDocument row={r} /> : null}
                  {!r.archived && (viewerIsHr || !r.verified) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={pending}
                      onClick={() => window.confirm(`Archive "${r.title}"? It is hidden from lists. The file is kept.`) && run(() => archiveDocument({ documentId: r.id }), "Document archived.")}
                    >
                      Archive
                    </Button>
                  ) : null}
                  {viewerIsHr && r.archived ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={pending}
                      onClick={() => run(() => bulkUpdateDocuments({ action: "restore", documentIds: [r.id] }).then(single), "Document restored.")}
                    >
                      Restore
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    </div>
  );
}
