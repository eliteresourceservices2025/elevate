"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SignaturePhotoError, photoToSignaturePng } from "../signature-photo";

const WIDTH = 520;
const HEIGHT = 160;

/**
 * A small drawing box for a signature: mouse, finger or pen. Reports the drawing as a base64 PNG (no "data:" prefix), or null when
 * empty. The server checks the file again (size, type): this is only the drawing surface.
 */
export function SignaturePad({ onChange, label = "Draw your signature" }: { onChange: (pngBase64: string | null) => void; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1f1b2d";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * WIDTH, y: ((e.clientY - rect.top) / rect.height) * HEIGHT };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y + 0.01); // a tap makes a dot
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    const url = canvas.current?.toDataURL("image/png") ?? "";
    onChange(url.startsWith("data:image/png;base64,") ? url.slice("data:image/png;base64,".length) : null);
  };
  /** A photo of a signature written on paper (for people who cannot draw with a mouse): cleaned up, cropped and shown in the box. */
  const importPhoto = async (file: File) => {
    setBusy(true);
    try {
      const png = await photoToSignaturePng(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("preview"));
        image.src = `data:image/png;base64,${png}`;
      });
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        const fit = Math.min(WIDTH / image.width, HEIGHT / image.height, 1);
        const w = image.width * fit;
        const h = image.height * fit;
        ctx.drawImage(image, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
      }
      setEmpty(false);
      onChange(png);
    } catch (error) {
      toast.error(error instanceof SignaturePhotoError ? error.message : "That picture could not be used. Try another, or draw your signature.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, WIDTH, HEIGHT);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" id="sig-pad-label">
        {label}
      </p>
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-labelledby="sig-pad-label"
        data-testid="signature-pad"
        className="w-full max-w-lg touch-none rounded-lg border bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={empty}>
          Clear
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
          Upload a photo of my signature
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Photo of your signature"
          data-testid="signature-photo-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importPhoto(f);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Hard to draw with a mouse? Sign with dark ink on plain light paper, take a photo (or a scan) and upload it: it is cleaned up and cropped for you. Or switch to Type my name.
      </p>
    </div>
  );
}
