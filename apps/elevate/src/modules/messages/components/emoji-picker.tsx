"use client";

import { Smile } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { EMOJI_SET } from "../emoji";

const PICKER_WIDTH = 288;
const PICKER_HEIGHT = 248;

/**
 * A button that opens a grid of emoji. `onPick` gets the chosen one. Closes on a pick, Escape or a click elsewhere.
 * The grid is placed with fixed positioning next to the button (above it, or below when there is no room), so a scrolling
 * message list around the button never clips it.
 */
export function EmojiPicker({ onPick, label = "Add emoji", size = "icon-sm" }: { onPick: (emoji: string) => void; label?: string; size?: "icon" | "icon-sm" }) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const open = style !== null;

  function toggle() {
    if (open) return setStyle(null);
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PICKER_WIDTH - 8));
    const room = rect.top > PICKER_HEIGHT + 16;
    setStyle(room ? { position: "fixed", left, bottom: window.innerHeight - rect.top + 4 } : { position: "fixed", left, top: rect.bottom + 4 });
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setStyle(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setStyle(null);
    const onScroll = () => setStyle(null);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <span ref={root} className="inline-flex">
      <Button type="button" variant="ghost" size={size} aria-label={label} aria-expanded={open} onClick={toggle}>
        <Smile aria-hidden />
      </Button>
      {open ? (
        <div role="dialog" aria-label="Emoji" style={style ?? undefined} className="z-50 grid max-h-[248px] w-72 grid-cols-8 gap-0.5 overflow-y-auto rounded-xl border bg-popover p-2 shadow-lg">
          {EMOJI_SET.map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              onClick={() => {
                onPick(e);
                setStyle(null);
              }}
              className="flex h-8 items-center justify-center rounded-md text-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={`Emoji ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
