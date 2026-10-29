"use client";

import { CheckCircle2, CircleAlert, Loader2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { useFormDialogWork } from "@/components/form-dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { cancelUpload, finalizeUpload, requestUpload } from "../actions";
import { ALLOWED_MIME_TYPES, ALLOWED_TYPES_TEXT, MAX_FILE_BYTES, formatBytes, titleFromFileName } from "../files";
import type { TypeOption } from "../queries";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx";
const MAX_FILES = 50;

type Item = { key: number; file: File; state: "waiting" | "uploading" | "done" | "failed"; message?: string };

/**
 * Many files at once, by dragging them in or choosing them. Every file lands as "Unsorted" and is categorized later from the list
 * (type, title, expiry). Each file takes the same three checked steps as a single upload, one after the other so a slow or failing
 * file never blocks the rest.
 */
export function BulkUpload({ target, employeeId, types }: { target: "employee" | "company"; employeeId?: string; types: TypeOption[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const next = useRef(0);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [running, setRunning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const dialog = useFormDialogWork({ dirty: items.length > 0 ? items.some((i) => i.state !== "done") : acknowledged, busy: running });

  const unsorted = types.find((t) => t.slug === `unsorted_${target}`);
  if (!unsorted) return null;

  function add(list: FileList | File[]) {
    const files = [...list];
    setItems((current) => {
      const room = Math.max(0, MAX_FILES - current.length);
      if (files.length > room) toast.error(`Only ${MAX_FILES} files fit in one go. ${files.length - room} not added.`);
      const accepted: Item[] = files.slice(0, room).map((file) => {
        const key = next.current++;
        if (file.size > MAX_FILE_BYTES) return { key, file, state: "failed" as const, message: `${formatBytes(file.size)} is over the 10 MB limit.` };
        if (!ALLOWED_MIME_TYPES.includes(file.type)) return { key, file, state: "failed" as const, message: `Only ${ALLOWED_TYPES_TEXT} files are allowed.` };
        return { key, file, state: "waiting" as const };
      });
      return [...current, ...accepted];
    });
  }

  const patch = (key: number, change: Partial<Item>) => setItems((current) => current.map((i) => (i.key === key ? { ...i, ...change } : i)));

  async function uploadOne(item: Item) {
    patch(item.key, { state: "uploading", message: undefined });
    try {
      const ticket = await requestUpload({
        target,
        employeeId,
        typeId: unsorted!.id,
        title: titleFromFileName(item.file.name),
        // Company files stay HR-only until HR has looked at them and chosen who may read them.
        audience: target === "company" ? "hr_only" : "all_staff",
        fileName: item.file.name,
        mimeType: item.file.type,
        sizeBytes: item.file.size,
        acknowledged,
      });
      if (!ticket.ok) return patch(item.key, { state: "failed", message: ticket.error });
      const { error } = await createSupabaseBrowserClient().storage.from(ticket.data.bucket).uploadToSignedUrl(ticket.data.path, ticket.data.token, item.file, { contentType: ticket.data.contentType });
      if (error) {
        await cancelUpload({ documentId: ticket.data.documentId });
        return patch(item.key, { state: "failed", message: "The upload did not go through." });
      }
      const done = await finalizeUpload({ documentId: ticket.data.documentId });
      patch(item.key, done.ok ? { state: "done" } : { state: "failed", message: done.error });
    } catch {
      patch(item.key, { state: "failed", message: "No connection. Try again." });
    }
  }

  async function start() {
    setRunning(true);
    for (const item of items.filter((i) => i.state === "waiting")) await uploadOne(item);
    setRunning(false);
    router.refresh();
  }

  const waiting = items.filter((i) => i.state === "waiting").length;
  const done = items.filter((i) => i.state === "done").length;

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        {dialog ? null : <h3 className="text-base font-semibold">Upload many files</h3>}
        <p className="text-sm text-muted-foreground">Drop the files here. They are saved as &ldquo;Unsorted&rdquo;; give each its type afterwards from the list.</p>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!running) add(e.dataTransfer.files);
        }}
        className={cn("flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors", over ? "border-primary bg-primary/5" : "border-muted-foreground/30")}
      >
        <UploadCloud className="size-7 text-muted-foreground" aria-hidden />
        <p className="text-sm">Drag and drop files here, or</p>
        <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          disabled={running}
          accept={ACCEPT}
          aria-label="Choose files to upload"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-muted-foreground">
          {ALLOWED_TYPES_TEXT}, up to 10 MB each, {MAX_FILES} files at a time.
        </p>
      </div>

      {items.length > 0 ? (
        <ul className="divide-y rounded-lg border text-sm" aria-label="Files to upload">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
              {i.state === "uploading" ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : i.state === "done" ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : i.state === "failed" ? <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden /> : <span className="size-4 shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{i.file.name}</span>
              <span className={cn("max-w-full text-xs [overflow-wrap:anywhere] sm:max-w-56", i.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {i.state === "waiting" ? formatBytes(i.file.size) : i.state === "uploading" ? "Uploading…" : i.state === "done" ? "Saved" : i.message}
              </span>
              {i.state === "waiting" && !running ? (
                <Button type="button" variant="ghost" size="xs" onClick={() => setItems((c) => c.filter((x) => x.key !== i.key))}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={acknowledged} disabled={running} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
        These files contain no client or patient information.
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={running || waiting === 0 || !acknowledged} onClick={start}>
          {waiting > 0 ? `Upload ${waiting} file${waiting === 1 ? "" : "s"}` : "Upload files"}
        </Button>
        {items.length > 0 && !running ? (
          <Button type="button" variant="outline" onClick={() => { setItems([]); setAcknowledged(false); }}>
            Clear list
          </Button>
        ) : null}
        <span role="status" className="text-sm text-muted-foreground">
          {done > 0 ? `${done} saved.` : ""}
        </span>
      </div>
    </div>
  );
}
