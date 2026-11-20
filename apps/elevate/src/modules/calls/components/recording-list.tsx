"use client";

import { Film } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatInZone } from "@/lib/time";
import type { RecordingListItem } from "../recording";

/** The recordings the person may watch. A video is only loaded when they press Watch (nothing downloads until then). */
export function RecordingList({ items, timeZone }: { items: RecordingListItem[]; timeZone: string }) {
  const [playing, setPlaying] = useState<string | null>(null);
  if (items.length === 0) return <EmptyState icon={Film} title="No recordings" description="When someone records a call you are in, it will appear here for 30 days." />;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((r) => (
        <li key={r.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-testid="recording-row">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-heading text-base font-semibold">{r.title}</span>
            <span className="text-muted-foreground">{formatInZone(r.startedAt, timeZone, "MMM d, h:mm a")}</span>
            <span className="text-muted-foreground">{r.live ? "Recording now" : `${r.minutes} min`}</span>
            <span className="text-muted-foreground">{(r.sizeBytes / 1024 / 1024).toFixed(0)} MB</span>
            <span className="text-muted-foreground">Recorded by {r.recorderName}</span>
            {r.expiresAt ? <span className="text-muted-foreground">Deleted on {formatInZone(r.expiresAt, timeZone, "MMM d")}</span> : null}
            {!r.live ? (
              <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setPlaying(playing === r.id ? null : r.id)} aria-expanded={playing === r.id}>
                {playing === r.id ? "Close" : "Watch"}
              </Button>
            ) : null}
          </div>
          {playing === r.id ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- a call recording has no caption file; the people in it are the transcript
            <video controls autoPlay preload="none" src={`/api/calls/recordings/${r.id}`} className="aspect-video w-full rounded-lg bg-black" />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
