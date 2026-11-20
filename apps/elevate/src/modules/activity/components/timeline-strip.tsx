import { cn } from "@/lib/utils";
import type { TimelineBlock } from "../timeline";

// A day as one horizontal strip: clocked-in time as a faint underlay, recorded time on top (green active, amber idle).
// Colour is never the only signal: every block carries its app, times and state as text for hover and screen readers.

const KIND = { working: "bg-muted", active: "bg-success", idle: "bg-warning" } as const;

export function TimelineStrip({ blocks, ticks, ariaLabel, className }: { blocks: TimelineBlock[]; ticks: { leftPct: number; label: string }[]; ariaLabel: string; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <div role="img" aria-label={ariaLabel} className="relative h-10 w-full overflow-clip rounded-md border bg-card">
        {blocks.map((b, i) => (
          <span
            key={`${b.kind}-${i}`}
            title={b.label}
            className={cn("absolute inset-y-0 min-w-px", KIND[b.kind], b.kind === "working" && "inset-y-2 rounded-sm")}
            style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
          />
        ))}
      </div>
      <div aria-hidden className="relative h-4 text-xs text-muted-foreground">
        {ticks.map((t) => (
          <span key={t.label + t.leftPct} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: `${t.leftPct}%` }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
