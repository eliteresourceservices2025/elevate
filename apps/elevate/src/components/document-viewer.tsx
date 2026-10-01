"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shows a PDF inside the page with the browser's own viewer (zoom, scroll, search), so nobody has to download it or open a new tab.
 * `src` must be one of our own authenticated routes that answers with the PDF "inline". `onFirstLoad` runs once when the file has
 * loaded (used to refresh the page after the server recorded that a signer opened it).
 */
export function DocumentViewer({ src, title, openLabel = "View", defaultOpen = false, onFirstLoad, children }: { src: string; title: string; openLabel?: string; defaultOpen?: boolean; onFirstLoad?: () => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const loaded = useRef(false);
  const fire = () => {
    if (loaded.current) return;
    loaded.current = true;
    onFirstLoad?.();
  };
  // Some browsers do not report a finished load for a PDF in a frame, so opening also triggers it after a moment.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(fire, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only reads refs and the latest callback
  }, [open]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={open ? "outline" : "default"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : openLabel}
        </Button>
        {children}
      </div>
      {open ? (
        <div className="overflow-hidden rounded-lg border bg-muted/30">
          <iframe
            title={title}
            src={src}
            className="h-[75vh] min-h-96 w-full bg-white"
            onLoad={fire}
          />
          <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">If the document does not show here, use the download button instead.</p>
        </div>
      ) : null}
    </div>
  );
}
