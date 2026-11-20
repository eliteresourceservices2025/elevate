import Link from "next/link";
import { UsersRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StatusChip, type StatusTone } from "@/components/status-chip";
import { cn } from "@/lib/utils";
import { FLOOR_STATE_LABELS, minutesText, type FloorStateKey } from "../labels";
import type { FloorRow } from "../queries";

// The Live floor: who is doing what right now. Colour is never alone: every state also has its word.

const ORDER: FloorStateKey[] = ["offline", "idle", "active", "break", "out"];
const TONE: Record<FloorStateKey, StatusTone> = { active: "success", idle: "warning", break: "info", offline: "danger", out: "neutral" };

export type FloorCountsMap = Record<FloorStateKey, number>;

export function countStates(rows: readonly FloorRow[]): FloorCountsMap {
  const counts: FloorCountsMap = { active: 0, idle: 0, break: 0, offline: 0, out: 0 };
  for (const r of rows) counts[r.state] += 1;
  return counts;
}

/** Offline first (they need a look), then idle, active, on break, clocked out; ties by name. */
export function sortFloor(rows: readonly FloorRow[]): FloorRow[] {
  return [...rows].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
}

export const isFloorState = (v: unknown): v is FloorStateKey => typeof v === "string" && (ORDER as string[]).includes(v);

/** The counts bar: one link per state that filters the grid. */
export function FloorCounts({ counts, current }: { counts: FloorCountsMap; current: FloorStateKey | undefined }) {
  return (
    <nav aria-label="Filter by state" className="flex flex-wrap gap-2">
      <Link href="/activity" aria-current={current ? undefined : "page"} className={cn("rounded-lg border px-3 py-1.5 text-sm", !current && "bg-muted font-medium")}>
        All <span className="tabular-nums">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
      </Link>
      {ORDER.map((state) => (
        <Link key={state} href={`/activity?state=${state}`} aria-current={current === state ? "page" : undefined} className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", current === state && "bg-muted font-medium")}>
          <StatusChip tone={TONE[state]}>{FLOOR_STATE_LABELS[state]}</StatusChip>
          <span className="tabular-nums">{counts[state]}</span>
        </Link>
      ))}
    </nav>
  );
}

function stateText(r: FloorRow): string {
  if (r.state === "out") return "Clocked out";
  if (r.state === "offline") return r.lastSeenMinutes === null ? "Tracker not reporting" : `Not reporting for ${minutesText(r.lastSeenMinutes)}`;
  return `${FLOOR_STATE_LABELS[r.state]} for ${minutesText(r.minutesInState)}`;
}

export function FloorGrid({ rows }: { rows: readonly FloorRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon={UsersRound} title="Nobody has the ELEVATE Tracker App yet" description="People appear here after they add their computer with a one-time code from their Attendance page." />;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="People">
      {sortFloor(rows).map((r) => (
        <li key={r.employeeId}>
          <Link href={`/activity/people/${r.employeeId}`} className="flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{r.name}</p>
              <StatusChip tone={TONE[r.state]}>{FLOOR_STATE_LABELS[r.state]}</StatusChip>
            </div>
            <p className="text-sm text-muted-foreground">{stateText(r)}</p>
            <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
              <span>{r.teamName ?? "No team"}</span>
              <span>Active today: <span className="font-medium text-foreground tabular-nums">{r.activePercentToday}%</span></span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
