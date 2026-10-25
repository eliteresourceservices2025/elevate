"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, ImageUp, Paperclip, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { referencedFileIds } from "@/lib/markdown";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { MAX_FILE_BYTES, MAX_VIDEO_BYTES, videoKindFromMime } from "@/modules/documents/files";
import type { ContentFileView } from "../content-files";
import { cancelAnnouncementFileUpload, finalizeAnnouncementFileUpload, requestAnnouncementFileUpload } from "../upload-actions";
import { cancelAnnouncementVideoUpload, finalizeAnnouncementVideoUpload, requestAnnouncementVideoUpload } from "../video-actions";

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

async function upload(kind: "image", blob: Blob, name: string): Promise<ContentFileView> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", blob, name);
  const response = await fetch("/api/content/files", { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; file?: ContentFileView };
  if (!response.ok || !body.ok || !body.file) throw new Error(body.error ?? "We could not upload that. Please try again.");
  return body.file;
}

/** Sends a video straight to storage (request, upload, finalize); a failed upload cancels the request. */
async function uploadVideo(file: File): Promise<ContentFileView> {
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4");
  if (!videoKindFromMime(mimeType)) throw new Error("Add an MP4 or WebM video.");
  if (file.size > MAX_VIDEO_BYTES) throw new Error("A video can be up to 100 MB.");
  const ticket = await requestAnnouncementVideoUpload({ fileName: file.name, mimeType, sizeBytes: file.size });
  if (!ticket.ok) throw new Error(ticket.error);
  const { error } = await createSupabaseBrowserClient().storage.from(ticket.data.bucket).uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.contentType });
  if (error) {
    await cancelAnnouncementVideoUpload({ id: ticket.data.id });
    throw new Error("The video did not upload. Check your connection and try again.");
  }
  const done = await finalizeAnnouncementVideoUpload({ id: ticket.data.id });
  if (!done.ok) throw new Error(done.error);
  return done.data;
}

const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Sends a PDF or Word document straight to storage (request, upload, finalize); a failed upload cancels the request. */
async function uploadDocument(file: File): Promise<ContentFileView> {
  // eslint-disable-next-line security/detect-object-injection -- the extension only selects from the three known keys
  const mimeType = Object.values(DOCUMENT_TYPES).includes(file.type) ? file.type : (DOCUMENT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "");
  if (!mimeType) throw new Error("Attach a PDF or Word document.");
  if (file.size > MAX_FILE_BYTES) throw new Error("A file can be up to 10 MB.");
  const ticket = await requestAnnouncementFileUpload({ fileName: file.name, mimeType, sizeBytes: file.size });
  if (!ticket.ok) throw new Error(ticket.error);
  const { error } = await createSupabaseBrowserClient().storage.from(ticket.data.bucket).uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.contentType });
  if (error) {
    await cancelAnnouncementFileUpload({ id: ticket.data.id });
    throw new Error("The file did not upload. Check your connection and try again.");
  }
  const done = await finalizeAnnouncementFileUpload({ id: ticket.data.id });
  if (!done.ok) throw new Error(done.error);
  return done.data;
}

/**
 * Pictures, documents and (announcements only) one video. A picture is inserted into the text as ![description](file:id); a document
 * is a download under the text. Removing a picture also removes its line from the text.
 */
export function ContentFilesEditor({
  files,
  onFilesChange,
  onBusyChange,
  body,
  onBodyChange,
  disabled,
  allowVideo,
}: {
  files: ContentFileView[];
  /** Takes an updater, so a finished upload joins the list as it is now, not as it was when the upload began. */
  onFilesChange: (update: (files: ContentFileView[]) => ContentFileView[]) => void;
  /** Told when an upload starts or ends, so the page can hold back Save and Publish until nothing is in flight (pass a stable setter). */
  onBusyChange?: (busy: boolean) => void;
  body: string;
  onBodyChange: (body: string) => void;
  disabled?: boolean;
  /** Announcements only: one MP4 or WebM video, shown above the text. */
  allowVideo?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoInput = useRef<HTMLInputElement>(null);
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  const hasVideo = files.some((f) => f.kind === "video");
  const [alt, setAlt] = useState<Record<string, string>>({});
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inText = new Set(referencedFileIds(body));

  const add = async (kind: "image" | "file", picked: File | undefined) => {
    if (!picked) return;
    if (files.length >= MAX_FILES) return void toast.error(`At most ${MAX_FILES} pictures and files.`);
    setBusy(true);
    try {
      const stored = kind === "image" ? await upload("image", await toJpeg(picked), picked.name.replace(/\.[^.]+$/, "") + ".jpg") : await uploadDocument(picked);
      onFilesChange((current) => [...current, stored]);
      toast.success(kind === "image" ? "Picture added. Describe it, then insert it into the text." : "File attached.");
    } catch (error) {
      toast.error(error instanceof Error && error.message !== "unreadable" ? error.message : "We could not open that picture. Try a JPG or PNG.");
    } finally {
      setBusy(false);
    }
  };

  const addVideo = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    setUploadingVideo(true);
    try {
      const stored = await uploadVideo(picked);
      onFilesChange((current) => [...current, stored]);
      toast.success("Video added. Save the announcement to publish it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We could not upload that video. Please try again.");
    } finally {
      setBusy(false);
      setUploadingVideo(false);
    }
  };

  const insert = (f: ContentFileView) => {
    const description = (alt[f.id] ?? "").replace(/[\]\n\r]/g, " ").trim();
    if (!description) return void toast.error("Describe the picture first, for people who cannot see it.");
    const line = `![${description}](file:${f.id})`;
    onBodyChange(`${body.trimEnd()}${body.trim() ? "\n\n" : ""}${line}\n`);
  };

  const remove = (f: ContentFileView) => {
    onFilesChange((current) => current.filter((x) => x.id !== f.id));
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
        {allowVideo ? (
          <>
            <Button type="button" size="sm" variant="outline" disabled={disabled || busy || hasVideo} onClick={() => videoInput.current?.click()}>
              <Video aria-hidden /> {uploadingVideo ? "Uploading video…" : "Add a video"}
            </Button>
            <input
              ref={videoInput}
              type="file"
              accept="video/mp4,video/webm,.mp4,.webm"
              className="sr-only"
              aria-label="Choose a video"
              onChange={(e) => {
                void addVideo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
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
      <p className="text-xs text-muted-foreground">Pictures show inside the text, files are downloads under it. Please do not add client or patient information. Up to {MAX_FILES} items, files up to 10 MB{allowVideo ? "; one video (MP4 or WebM) up to 100 MB, with no client or patient screens in it" : ""}.</p>

      {files.length === 0 ? null : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-2 text-sm">
              {f.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a private picture served by our own route
                <img src={`/api/content/files/${f.id}`} alt="" className="size-12 rounded object-cover" />
              ) : f.kind === "video" ? (
                <Video className="size-6 text-muted-foreground" aria-hidden />
              ) : (
                <FileText className="size-6 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {f.kind === "image" ? (inText.has(f.id) ? "Picture, shown in the text" : "Picture, not in the text yet") : f.kind === "video" ? "Video, shown above the text" : "Document"} · {sizeText(f.sizeBytes)}
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
                  <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => insert(f)}>
                    Insert in text
                  </Button>
                </>
              ) : null}
              <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={() => remove(f)} aria-label={`Remove ${f.fileName}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
