import { Briefcase, CalendarDays, GraduationCap, HeartPulse, Users } from "lucide-react";
import { getHeadcountMovement, getHealthSummary, getHiringPipeline, getTimeOffCounts, getTrainingComplianceTile } from "../manager-queries";
import { orFallback } from "../or-fallback";
import { RowMeta, Tile, TileList, TileNote, TileRow } from "./bento";
import { guarded } from "./guard";

function Bars({ rows }: { rows: { key: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <TileList>
      {rows.map((r) => (
        <TileRow key={r.key}>
          <span className="w-20 shrink-0 truncate">{r.label}</span>
          <span aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <RowMeta>{r.count}</RowMeta>
        </TileRow>
      ))}
    </TileList>
  );
}

/** Company headcount and this month's movement, with people by team (teams under 5 never show). */
export async function ExecHeadcountTile() {
  return guarded("Headcount and movement", async () => {
    const h = await orFallback(() => getHeadcountMovement(), null);
    if (!h) return null;
    return (
      <Tile label="Headcount and movement" title="Headcount and movement" icon={<Users className="size-4 text-primary" aria-hidden />} href="/analytics" hrefLabel="Analytics">
        <p className="text-2xl font-semibold tabular-nums">
          {h.active.toLocaleString("en-US")} <span className="text-sm font-normal text-muted-foreground">active</span>
        </p>
        <p className="pb-1.5 text-xs text-muted-foreground">
          +{h.joined} joined, {h.left} left this month
        </p>
        {h.teams.length > 0 ? <Bars rows={h.teams.slice(0, 3).map((t, i) => ({ key: `${t.name}-${i}`, label: t.name, count: t.count }))} /> : null}
      </Tile>
    );
  });
}

const STAGE_LABEL: Record<string, string> = { applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired" };

/** Applicants by stage and open roles. */
export async function ExecHiringTile() {
  return guarded("Hiring pipeline", async () => {
    const p = await orFallback(() => getHiringPipeline(), null);
    if (!p) return null;
    return (
      <Tile label="Hiring pipeline" title="Hiring pipeline" icon={<Briefcase className="size-4 text-primary" aria-hidden />} href="/recruiting" hrefLabel="Recruiting">
        <Bars rows={p.stages.map((s) => ({ key: s.stage, label: STAGE_LABEL[s.stage] ?? s.stage, count: s.count }))} />
        <p className="mt-auto pt-1.5 text-xs text-muted-foreground">{p.openRoles} open {p.openRoles === 1 ? "role" : "roles"}</p>
      </Tile>
    );
  });
}

/** Share of assigned people with a current certificate. Counts only; no names, no scores. */
export async function ExecTrainingTile() {
  return guarded("Training compliance", async () => {
    const t = await orFallback(() => getTrainingComplianceTile(), null);
    if (!t) return null;
    return (
      <Tile label="Training compliance" title="Training compliance" icon={<GraduationCap className="size-4 text-primary" aria-hidden />}>
        {t.currentPercent === null ? (
          <TileNote>No training assigned yet.</TileNote>
        ) : (
          <>
            <p className="text-2xl font-semibold tabular-nums">{t.currentPercent}%</p>
            <p className="text-xs text-muted-foreground">have a current certificate</p>
          </>
        )}
        <p className="mt-auto pt-1.5 text-xs text-muted-foreground">{t.overdue} overdue</p>
      </Tile>
    );
  });
}

/** Late background jobs out of all of them, and nothing else about them. */
export async function ExecHealthTile() {
  return guarded("System health", async () => {
    const h = await orFallback(() => getHealthSummary(), null);
    if (!h) return null;
    return (
      <Tile label="System health" title="System health" icon={<HeartPulse className="size-4 text-primary" aria-hidden />}>
        <p className="text-2xl font-semibold">{h.late === 0 ? "All on time" : `${h.late} late`}</p>
        <p className="mt-auto pt-1.5 text-xs text-muted-foreground">{h.total} background jobs checked</p>
      </Tile>
    );
  });
}

/** The next seven days: how many people are off and which holidays fall there. Never who. */
export async function ExecTimeOffTile() {
  return guarded("Time off this week", async () => {
    const days = await orFallback(() => getTimeOffCounts(), []);
    return (
      <Tile label="Time off this week" title="Time off this week" icon={<CalendarDays className="size-4 text-primary" aria-hidden />}>
        {days.length === 0 ? (
          <TileNote>Nobody is out and there are no holidays in the next 7 days.</TileNote>
        ) : (
          <TileList>
            {days.slice(0, 4).map((d, i) => (
              <TileRow key={`${d.label}-${i}`}>
                <span className="w-16 shrink-0 text-xs font-medium">{d.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {[...d.holidays, d.count > 0 ? `${d.count} ${d.count === 1 ? "person" : "people"} off` : ""].filter(Boolean).join(" · ")}
                </span>
              </TileRow>
            ))}
          </TileList>
        )}
        <p className="mt-auto pt-1.5 text-xs text-muted-foreground">Counts only, no names.</p>
      </Tile>
    );
  });
}
