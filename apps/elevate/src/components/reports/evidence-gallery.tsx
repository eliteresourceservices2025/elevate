"use client";

import { ChevronLeft, ChevronRight, Download, ImageOff, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { openEvidence } from "@/modules/attendance/actions";

export type EvidenceItem = { id: string; mime?: string; purged: boolean };

const src = (id: string, full = false) => `/api/attendance/evidence/${id}${full ? "?view=1" : "?thumb=1"}`;

/**
 * The screenshots of a report as thumbnails; click one to see it full size inside the page (zoom, previous and next, arrow keys). The pictures
 * come through our own signed-in route, never a storage link, and each full-size open is audited. "Download" asks for the 60-second link as before.
 * The 90-day purge leaves a note instead of a picture.
 */
export function EvidenceGallery({ evidence, label = "Screenshots" }: { evidence: EvidenceItem[]; label?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const live = evidence.filter((e) => !e.purged);
  const index = open === null ? -1 : live.findIndex((e) => e.id === evidence[open]?.id);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function step(by: number) {
    if (live.length < 2 || index < 0) return;
    const next = live[(index + by + live.length) % live.length];
    setOpen(evidence.findIndex((e) => e.id === next.id));
    setZoomed(false);
  }

  async function download(id: string) {
    const result = await openEvidence({ evidenceId: id });
    if (!result.ok) return void toast.error(result.error);
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  if (evidence.length === 0) return null;
  const current = open === null ? null : evidence[open];
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="flex flex-wrap gap-2">
        {evidence.map((ev, i) => (
          <li key={ev.id}>
            {ev.purged ? (
              <span className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center text-xs text-muted-foreground">
                <ImageOff aria-hidden className="size-4" />
                Deleted after 90 days
              </span>
            ) : (
              <button
                type="button"
                aria-label={`View screenshot ${i + 1}`}
                className="group relative block h-20 w-28 overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setOpen(i);
                  setZoomed(false);
                }}
              >
                {/* Our own authenticated route, not a static asset: next/image cannot optimize it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(ev.id)} alt={`Screenshot ${i + 1}`} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Screenshot {open === null ? "" : open + 1} of {evidence.length}
            </DialogTitle>
            <DialogDescription>Only you, the person who sent it, their leads and HR can see this. Never share it outside ELEVATE.</DialogDescription>
          </DialogHeader>
          {current && !current.purged ? (
            <div className="space-y-3">
              <div className={`overflow-auto rounded-lg border bg-muted ${zoomed ? "max-h-[70vh]" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(current.id, true)} alt={`Screenshot ${(open ?? 0) + 1}`} className={zoomed ? "max-w-none" : "mx-auto max-h-[65vh] w-auto max-w-full object-contain"} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => step(-1)} disabled={live.length < 2} aria-label="Previous screenshot">
                    <ChevronLeft aria-hidden /> Previous
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => step(1)} disabled={live.length < 2} aria-label="Next screenshot">
                    Next <ChevronRight aria-hidden />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setZoomed((z) => !z)}>
                    {zoomed ? <ZoomOut aria-hidden /> : <ZoomIn aria-hidden />} {zoomed ? "Fit to window" : "Actual size"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void download(current.id)}>
                    <Download aria-hidden /> Download
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
