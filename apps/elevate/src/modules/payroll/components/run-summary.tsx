import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RunsSummary } from "../queries";
import { cutoffNote, shortRange, type RunsView } from "../runs-list";

// The four tiles above the runs list and the filter chips. Dates and counts only: the list never shows an amount.

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

export function RunSummaryTiles({ summary }: { summary: RunsSummary }) {
  const { nextCutoff, inReview, approvedNotPaid, lastPaid } = summary;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Payroll summary" role="group">
      <Tile label="Next to prepare" value={nextCutoff ? shortRange(nextCutoff.start, nextCutoff.end) : "All caught up"} note={nextCutoff ? cutoffNote(nextCutoff.daysLeft) : "Every recent cutoff has a run"} />
      <Tile label="Waiting for approval" value={runs(inReview)} note={inReview > 0 ? "Sent for review" : "Nothing waiting"} />
      <Tile
        label="Approved, not paid"
        value={approvedNotPaid ? runs(approvedNotPaid.count) : "None"}
        note={approvedNotPaid ? `${approvedNotPaid.paidCount} of ${approvedNotPaid.peopleCount} people paid on the newest` : "Nothing waiting for payment"}
      />
      <Tile label="Last fully paid" value={lastPaid ? shortRange(lastPaid.periodStart, lastPaid.periodEnd) : "None yet"} note={lastPaid ? `${lastPaid.peopleCount} ${lastPaid.peopleCount === 1 ? "person" : "people"}` : "No paid run yet"} />
    </div>
  );
}

const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors pointer-coarse:h-11";

export function RunFilters({ view, actionCount }: { view: RunsView; actionCount: number }) {
  const items: { view: RunsView; label: string; count?: number }[] = [
    { view: "all", label: "All" },
    { view: "action", label: "Needs you", count: actionCount },
    { view: "test", label: "Test runs" },
  ];
  return (
    <nav aria-label="Filter runs" className="flex flex-wrap items-center gap-2">
      {items.map((i) => (
        <Link
          key={i.view}
          href={i.view === "all" ? "/payroll" : `/payroll?view=${i.view}`}
          aria-current={view === i.view ? "page" : undefined}
          className={cn(CHIP, view === i.view ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
        >
          {i.label}
          {i.count !== undefined ? <span className="tabular-nums">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
