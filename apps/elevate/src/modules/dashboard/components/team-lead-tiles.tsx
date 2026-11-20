import { Activity, AlertTriangle, ClipboardList, Timer } from "lucide-react";
import { orFallback } from "../or-fallback";
import { getClockedInTile, getReviewsGoalsTile, getTeamFlagsTile, getTeamHoursTile } from "../manager-queries";
import { hoursLabel, RowMeta, Tile, TileList, TileNote, TileRow } from "./bento";
import { guarded } from "./guard";

/** Last week's hours for the team against the schedule, and how many days wait for approval. */
export async function TeamHoursTile() {
  return guarded("Team hours", async () => {
    const hours = await orFallback(() => getTeamHoursTile(), null);
    if (!hours) return null;
    return (
      <Tile label="Team hours" title="Team hours, last week" icon={<Timer className="size-4 text-primary" aria-hidden />} href="/hours-review" hrefLabel="Review">
        {hours.rows.length === 0 ? (
          <TileNote>No hours from last week to review.</TileNote>
        ) : (
          <TileList>
            {hours.rows.slice(0, 3).map((r, i) => (
              <TileRow key={`${r.name}-${i}`}>
                <span className="w-20 shrink-0 truncate">{r.name}</span>
                <div role="progressbar" aria-label={`${r.name} hours`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${r.percent}%` }} />
                </div>
                <RowMeta>{hoursLabel(r.workedMinutes)}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
        <p className="mt-auto pt-1.5 text-xs text-muted-foreground">{hours.daysWaiting === 0 ? "Everything approved" : `${hours.daysWaiting} ${hours.daysWaiting === 1 ? "day waits" : "days wait"} for approval`}</p>
      </Tile>
    );
  });
}

/** How many of the team are clocked in now. Counts only. */
export async function ClockedInTile() {
  return guarded("Clocked in now", async () => {
    const c = await orFallback(() => getClockedInTile(), null);
    if (!c) return null;
    const detail = [c.onBreak > 0 ? `${c.onBreak} on break` : null, c.longOpen > 0 ? `${c.longOpen} over 12 h` : null].filter(Boolean).join(", ");
    return (
      <Tile label="Clocked in now" title="Clocked in now" icon={<Activity className="size-4 text-primary" aria-hidden />} href="/team-attendance" hrefLabel="Team">
        <p className="text-2xl font-semibold tabular-nums">
          {c.working + c.onBreak} <span className="text-sm font-normal text-muted-foreground">of {c.total}</span>
        </p>
        <p className="mt-auto pt-1.5 text-xs text-muted-foreground">{detail || "Nobody on break or over 12 h"}</p>
      </Tile>
    );
  });
}

/** Days worth a look in the last two weeks, by kind. */
export async function TeamFlagsTile() {
  return guarded("Team flags", async () => {
    const flags = await orFallback(() => getTeamFlagsTile(), []);
    return (
      <Tile label="Team flags" title="Team flags" icon={<AlertTriangle className="size-4 text-primary" aria-hidden />} href="/team-attendance" hrefLabel="Flags">
        {flags.length === 0 ? (
          <TileNote>No flags in the last two weeks.</TileNote>
        ) : (
          <TileList>
            {flags.slice(0, 3).map((f, i) => (
              <TileRow key={`${f.label}-${i}`}>
                <span className="min-w-0 truncate">{f.label}</span>
                <RowMeta>{f.count}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
      </Tile>
    );
  });
}

/** Reviews to write, self reviews waiting and goals due soon. */
export async function ReviewsGoalsTile() {
  return guarded("Reviews and goals due", async () => {
    const r = await orFallback(() => getReviewsGoalsTile(), { toWrite: 0, selfReviews: 0, goalsToUpdate: 0 });
    const lines = [
      r.toWrite > 0 ? { label: "Reviews for you to write", n: r.toWrite } : null,
      r.selfReviews > 0 ? { label: "Self reviews waiting", n: r.selfReviews } : null,
      r.goalsToUpdate > 0 ? { label: "Goals due in 2 weeks", n: r.goalsToUpdate } : null,
    ].filter((l): l is { label: string; n: number } => l !== null);
    return (
      <Tile label="Reviews and goals due" title="Reviews and goals due" icon={<ClipboardList className="size-4 text-primary" aria-hidden />} href="/reviews" hrefLabel="Reviews">
        {lines.length === 0 ? (
          <TileNote>Nothing due.</TileNote>
        ) : (
          <TileList>
            {lines.map((l) => (
              <TileRow key={l.label}>
                <span className="min-w-0 truncate">{l.label}</span>
                <RowMeta>{l.n}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
      </Tile>
    );
  });
}
