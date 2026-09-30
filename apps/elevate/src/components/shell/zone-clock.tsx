"use client";

import { useSyncExternalStore } from "react";
import { formatDual } from "@/lib/time";

// Minute-resolution tick. The server snapshot is null, so the server and the first
// browser render match; the time appears after hydration.
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 15_000);
  return () => clearInterval(id);
}
const getMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const getServerMinute = () => null;

const zoneLabel = (z: string) => z.split("/").pop()?.replace("_", " ");

// Shows the current time in the viewer's zone and Manila (CLAUDE.md rule 8).
export function ZoneClock({ zone }: { zone?: string | null }) {
  const minute = useSyncExternalStore(subscribe, getMinute, getServerMinute);

  if (minute === null) return <div className="h-9 w-56" aria-hidden />;

  const t = formatDual(minute, { zone, pattern: "h:mm a" });

  return (
    <dl className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Current time">
      <div>
        <dt className="sr-only">{t.primaryZone}</dt>
        <dd>
          <span className="font-mono text-sm font-medium text-foreground">{t.primary}</span>{" "}
          {zoneLabel(t.primaryZone)}
        </dd>
      </div>
      <div>
        <dt className="sr-only">{t.secondaryZone}</dt>
        <dd>
          <span className="font-mono text-sm font-medium text-foreground">{t.secondary}</span>{" "}
          {zoneLabel(t.secondaryZone)}
        </dd>
      </div>
    </dl>
  );
}
