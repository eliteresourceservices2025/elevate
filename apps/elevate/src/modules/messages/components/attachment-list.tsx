import { FileText } from "lucide-react";
import { formatBytes } from "@/modules/documents/files";
import type { ChatMessage } from "../queries";

/** The files, pictures and voice notes of a message. Always served by our own authenticated route, never a storage link. */
export function AttachmentList({ attachments }: { attachments: ChatMessage["attachments"] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      {attachments.map((a) => {
        const src = `/api/messages/attachments/${a.id}`;
        if (a.kind === "image") {
          return (
            <a key={a.id} href={src} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border">
              {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated route, not a static asset */}
              <img src={src} alt={a.name} loading="lazy" className="max-h-64 max-w-full object-contain" />
            </a>
          );
        }
        if (a.kind === "voice") {
          return (
            <audio key={a.id} controls preload="none" src={src} aria-label={`Voice note${a.durationS ? `, ${a.durationS} seconds` : ""}`} className="h-10 w-64 max-w-full" />
          );
        }
        return (
          <a key={a.id} href={src} target="_blank" rel="noopener noreferrer" className="flex w-64 max-w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-card-foreground hover:bg-muted">
            <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{a.name}</span>
              <span className="block text-xs text-muted-foreground">{formatBytes(a.size)}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}
