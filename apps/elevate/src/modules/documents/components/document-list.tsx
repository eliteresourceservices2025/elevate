"use client";

import { File, FileImage, FileText } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/time";
import { type CategorizeOptions } from "./categorize-document";
import { DocumentBulkBar } from "./document-bulk-bar";
import { bulkBoxProps } from "../bulk-box";
import type { ExpiryStatus } from "../expiry";
import { formatBytes } from "../files";
import type { DocumentRow, FolderRow } from "../queries";
import { DocumentRowActions } from "./document-row-actions";
import { TypeBadge } from "./type-badge";
export { DownloadButton } from "./download-button";

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

/** A person's or the company's documents, with the actions the viewer is allowed to take. */
export function DocumentList({
  rows,
  viewerIsHr,
  showAudience = false,
  emptyText = "No documents yet.",
  folders,
  categorize,
  bulkFormId,
}: {
  bulkFormId?: string;
  rows: DocumentRow[];
  viewerIsHr: boolean;
  showAudience?: boolean;
  emptyText?: string;
  /** When given, each open document gets a "Move to" choice with these folders. */
  folders?: FolderRow[];
  /** When given, each open document gets a "Set type" / "Change type" button. */
  categorize?: CategorizeOptions;
}) {
  const localFormId = `docs-bulk-${useId()}`;
  const formId = bulkFormId ?? localFormId;

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <div key={rows.map((r) => r.id).join(",")} className="space-y-3">
    {viewerIsHr && !bulkFormId ? <DocumentBulkBar formId={formId} /> : null}
    <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
      <Table stack className="table-fixed">
        <TableHeader>
          <TableRow>
            {viewerIsHr ? <TableHead className="w-8"><span className="sr-only">Select</span></TableHead> : null}
            <TableHead className="w-[18%]">Type</TableHead>
            <TableHead>Document</TableHead>
            <TableHead className="w-28">Expiry</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-56 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className={r.archived ? "opacity-60" : undefined}>
              {viewerIsHr ? (
                <TableCell data-select>
                  <input {...bulkBoxProps(formId)} value={r.id} aria-label={`Select ${r.title}`} className="size-4 accent-primary" />
                </TableCell>
              ) : null}
              <TableCell label="Type" className="whitespace-normal max-md:pr-7 [&_span]:whitespace-normal">
                <TypeBadge slug={r.typeSlug} name={r.typeName} />
              </TableCell>
              <TableCell className="whitespace-normal [overflow-wrap:anywhere] max-md:pr-7">
                <div className="min-w-0">
                <div className="font-medium">{r.title}</div>
                <div className="mt-1 flex items-start gap-1.5 text-xs font-normal text-muted-foreground" title={r.fileName}>
                  <FileKindIcon mime={r.mimeType} />
                  <span>
                    {r.clientName ? `${r.clientName} · ` : ""}
                    {r.fileName !== r.title ? r.fileName : "File"}
                    {r.sizeBytes ? ` (${formatBytes(r.sizeBytes)})` : ""}
                  </span>
                </div>
                </div>
              </TableCell>
              <TableCell label="Expiry">
                <ExpiryBadge status={r.expiry} expiresOn={r.expiresOn} />
              </TableCell>
              <TableCell label="Status">
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
              <TableCell label="" className="text-right max-md:pt-3">
                <DocumentRowActions row={r} viewerIsHr={viewerIsHr} showAudience={showAudience} folders={folders} categorize={categorize} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    </div>
  );
}
