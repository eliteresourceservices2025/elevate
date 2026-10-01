"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

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
        <p className="text-xs text-muted-foreground">Prefer typing? Switch to Type my name. You can use the mouse, a finger or a pen.</p>
      </div>
    </div>
  );
}
