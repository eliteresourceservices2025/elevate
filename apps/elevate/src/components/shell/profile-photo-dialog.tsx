"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PHOTO_SIZE, sourceSquare } from "@/modules/people/photo";
import { removeProfilePhoto } from "@/modules/people/photo-actions";

const PREVIEW = 240;

/**
 * Choose a picture, move and zoom it inside a round frame, save. The browser makes the small square JPEG (so the original, with its
 * camera and location details, never leaves the device); the server checks it again and keeps only a cleaned copy.
 */
export function ProfilePhotoDialog({ open, onOpenChange, hasPhoto }: { open: boolean; onOpenChange: (open: boolean) => void; hasPhoto: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <PhotoEditor onOpenChange={onOpenChange} hasPhoto={hasPhoto} /> : null}</DialogContent>
    </Dialog>
  );
}

function PhotoEditor({ onOpenChange, hasPhoto }: { onOpenChange: (open: boolean) => void; hasPhoto: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Draw the preview.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !image) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { sx, sy, side } = sourceSquare(image.naturalWidth, image.naturalHeight, zoom, pos.x, pos.y);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(image, sx, sy, side, side, 0, 0, c.width, c.height);
  }, [image, zoom, pos]);

  const choose = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return void setError("Choose a JPG, PNG or WEBP picture.");
    if (file.size > 15 * 1024 * 1024) return void setError("That picture is too large. Choose one under 15 MB.");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (Math.min(img.naturalWidth, img.naturalHeight) < 64) return void setError("That picture is too small. Choose one at least 64 pixels wide.");
      setZoom(1);
      setPos({ x: 0, y: 0 });
      setImage(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("We could not open that picture. Try a JPG or PNG.");
    };
    img.src = url;
  };

  const move = (dx: number, dy: number) => {
    if (!image) return;
    const { side } = sourceSquare(image.naturalWidth, image.naturalHeight, zoom, 0, 0);
    const scale = PREVIEW / side; // preview pixels per original pixel
    const slackX = (image.naturalWidth - side) / 2;
    const slackY = (image.naturalHeight - side) / 2;
    setPos((p) => ({
      x: slackX > 0 ? Math.min(1, Math.max(-1, p.x - dx / scale / slackX)) : 0,
      y: slackY > 0 ? Math.min(1, Math.max(-1, p.y - dy / scale / slackY)) : 0,
    }));
  };

  const save = async () => {
    if (!image) return;
    setSaving(true);
    setError(null);
    try {
      const out = document.createElement("canvas");
      out.width = PHOTO_SIZE;
      out.height = PHOTO_SIZE;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      const { sx, sy, side } = sourceSquare(image.naturalWidth, image.naturalHeight, zoom, pos.x, pos.y);
      ctx.fillStyle = "#ffffff"; // a transparent PNG gets a white background (JPEG has none)
      ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
      ctx.drawImage(image, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("no blob");
      const form = new FormData();
      form.set("photo", blob, "photo.jpg");
      const response = await fetch("/api/profile-photo", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) return void setError(body.error ?? "We could not save your photo. Please try again.");
      toast.success("Photo saved.");
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("We could not save your photo. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    startTransition(async () => {
      const result = await removeProfilePhoto();
      if (!result.ok) return void setError(result.error);
      toast.success("Photo removed.");
      onOpenChange(false);
      router.refresh();
    });

  return (
    <>
        <DialogHeader>
          <DialogTitle>Profile photo</DialogTitle>
          <DialogDescription>Colleagues who sign in to ELEVATE can see it. Use a picture of yourself, never a client or patient.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative size-60 touch-none overflow-hidden rounded-full border bg-muted"
            style={{ width: PREVIEW, height: PREVIEW }}
            onPointerDown={(e) => {
              if (!image) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              move(e.clientX - drag.current.x, e.clientY - drag.current.y);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={(e) => {
              const step = 12;
              const keys: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
              const delta = keys[e.key];
              if (!delta) return;
              e.preventDefault();
              move(delta[0], delta[1]);
            }}
            tabIndex={image ? 0 : -1}
            role="img"
            aria-label={image ? "Your picture. Drag, or use the arrow keys, to move it inside the circle." : "No picture chosen yet"}
          >
            {image ? (
              <canvas ref={canvas} width={PREVIEW} height={PREVIEW} className="size-full cursor-grab active:cursor-grabbing" />
            ) : (
              <button type="button" onClick={() => input.current?.click()} className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <ImageUp className="size-8" aria-hidden />
                Choose a picture
              </button>
            )}
          </div>

          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Choose a picture"
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {image ? (
            <div className="flex w-full flex-col gap-3">
              <div className="space-y-1">
                <Label htmlFor="photo-zoom">Zoom</Label>
                <input id="photo-zoom" type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-primary" />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
                Choose a different picture
              </Button>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {hasPhoto ? (
            <Button type="button" variant="ghost" disabled={pending || saving} onClick={remove}>
              Remove photo
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!image || saving || pending} onClick={save}>
              {saving ? "Saving…" : "Save photo"}
            </Button>
          </div>
        </DialogFooter>
    </>
  );
}
