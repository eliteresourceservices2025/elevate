"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/time";
import { archiveDocument, getDownloadUrl, verifyDocument } from "../actions";
import type { ExpiryStatus } from "../expiry";
import { formatBytes } from "../files";
import type { DocumentRow } from "../queries";

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
}: {
  rows: DocumentRow[];
  viewerIsHr: boolean;
  showAudience?: boolean;
  emptyText?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      router.refresh();
    });

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className={r.archived ? "opacity-60" : undefined}>
              <TableCell>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">
                  {r.typeName}
                  {r.clientName ? ` · ${r.clientName}` : ""} · {r.fileName}
                  {r.sizeBytes ? ` (${formatBytes(r.sizeBytes)})` : ""}
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
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
