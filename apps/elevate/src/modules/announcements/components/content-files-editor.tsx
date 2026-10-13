"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, ImageUp, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { referencedFileIds } from "@/lib/markdown";
import type { ContentFileView } from "../content-files";

const MAX_SIDE = 1600;
const MAX_FILES = 12;
const sizeText = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/** Re-encodes a chosen picture as a JPEG no wider than 1600 px (this also drops camera and location details). */
async function toJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable"));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("no blob");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function upload(kind: "image" | "file", blob: Blob, name: string): Promise<ContentFileView> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", blob, name);
  const response = await fetch("/api/content/files", { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; file?: ContentFileView };
  if (!response.ok || !body.ok || !body.file) throw new Error(body.error ?? "We could not upload that. Please try again.");
  return body.file;
}

/**
 * Pictures and documents for an announcement or policy. A picture is inserted into the text as ![description](file:id); a document
 * is a download under the text. Removing a picture also removes its line from the text.
 */
export function ContentFilesEditor({
  files,
  onFilesChange,
  body,
  onBodyChange,
  disabled,
}: {
  files: ContentFileView[];
  onFilesChange: (files: ContentFileView[]) => void;
  body: string;
  onBodyChange: (body: string) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [alt, setAlt] = useState<Record<string, string>>({});
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inText = new Set(referencedFileIds(body));

  const add = async (kind: "image" | "file", picked: File | undefined) => {
    if (!picked) return;
    if (files.length >= MAX_FILES) return void toast.error(`At most ${MAX_FILES} pictures and files.`);
    setBusy(true);
    try {
      const blob = kind === "image" ? await toJpeg(picked) : picked;
      const name = kind === "image" ? picked.name.replace(/\.[^.]+$/, "") + ".jpg" : picked.name;
      const stored = await upload(kind, blob, name);
      onFilesChange([...files, stored]);
      toast.success(kind === "image" ? "Picture added. Describe it, then insert it into the text." : "File attached.");
    } catch (error) {
      toast.error(error instanceof Error && error.message !== "unreadable" ? error.message : "We could not open that picture. Try a JPG or PNG.");
    } finally {
      setBusy(false);
    }
  };

  const insert = (f: ContentFileView) => {
    const description = (alt[f.id] ?? "").replace(/[\]\n\r]/g, " ").trim();
    if (!description) return void toast.error("Describe the picture first, for people who cannot see it.");
    const line = `![${description}](file:${f.id})`;
    onBodyChange(`${body.trimEnd()}${body.trim() ? "\n\n" : ""}${line}\n`);
  };

  const remove = (f: ContentFileView) => {
    onFilesChange(files.filter((x) => x.id !== f.id));
    if (inText.has(f.id)) {
      const kept = body
        .split("\n")
        .filter((line) => !line.includes(`(file:${f.id})`))
        .join("\n");
      onBodyChange(kept);
    }
  };

  return (
    <section aria-label="Pictures and files" className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Pictures and files</h3>
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => photoInput.current?.click()}>
          <ImageUp aria-hidden /> Add a picture
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
          <Paperclip aria-hidden /> Attach a PDF or Word file
        </Button>
        <input
          ref={photoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Choose a picture"
          onChange={(e) => {
            void add("image", e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          aria-label="Choose a PDF or Word file"
          onChange={(e) => {
            void add("file", e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">Pictures show inside the text, files are downloads under it. Please do not add client or patient information. Up to {MAX_FILES} items, files up to 10 MB.</p>

      {files.length === 0 ? null : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-2 text-sm">
              {f.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a private picture served by our own route
                <img src={`/api/content/files/${f.id}`} alt="" className="size-12 rounded object-cover" />
              ) : (
                <FileText className="size-6 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {f.kind === "image" ? (inText.has(f.id) ? "Picture, shown in the text" : "Picture, not in the text yet") : "Document"} · {sizeText(f.sizeBytes)}
                </span>
              </span>
              {f.kind === "image" && !inText.has(f.id) ? (
                <>
                  <label className="sr-only" htmlFor={`alt-${f.id}`}>
                    Describe {f.fileName}
                  </label>
                  <input
                    id={`alt-${f.id}`}
                    value={alt[f.id] ?? ""}
                    onChange={(e) => setAlt((s) => ({ ...s, [f.id]: e.target.value }))}
                    maxLength={150}
                    placeholder="Describe the picture"
                    className="h-8 w-56 max-w-full rounded-md border bg-background px-2 text-xs"
                  />
                  <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => insert(f)}>
                    Insert in text
                  </Button>
                </>
              ) : null}
              <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => remove(f)} aria-label={`Remove ${f.fileName}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
