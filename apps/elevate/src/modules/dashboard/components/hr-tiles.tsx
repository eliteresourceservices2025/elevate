import Link from "next/link";
import { ClipboardCheck, ListChecks, ShieldAlert, Users } from "lucide-react";
import { SEVERITY_VARIANT } from "./severity";
import { getAttention } from "../feed-queries";
import type { Lens } from "../lens";
import { getHrKpiTiles } from "../manager-queries";
import { orFallback } from "../or-fallback";
import { getRisks, getTracker, getWorkforce } from "../panel-queries";
import { RowMeta, Tile, TileList, TileNote, TileRow } from "./bento";
import { guarded } from "./guard";

/** One of the six HR number tiles. The six share one read; a number this person may not see is shown as a dash. */
export async function HrKpiTile({ id }: { id: string }) {
  return guarded(`HR number ${id}`, async () => {
    const kpi = (await getHrKpiTiles()).find((k) => k.id === id);
    if (!kpi) return null;
    return (
      <Tile label={kpi.label} title={kpi.label}>
        <Link href={kpi.href} className="rounded-sm text-2xl font-semibold tabular-nums outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
          {kpi.value === null ? "–" : kpi.value.toLocaleString("en-US")}
        </Link>
        {kpi.hint ? <p className="mt-auto pt-1 text-xs text-muted-foreground">{kpi.hint}</p> : null}
      </Tile>
    );
  });
}

/** The early warnings, three at most. */
export async function RisksTile({ lens }: { lens: Lens }) {
  return guarded("Risks", async () => {
    const { cards, ready } = await getRisks(lens);
    return (
      <Tile label="Risks" title="Risks" icon={<ShieldAlert className="size-4 text-primary" aria-hidden />}>
        {!ready ? (
          <TileNote>Trends appear after the first nightly summary.</TileNote>
        ) : cards.length === 0 ? (
          <TileNote>Nothing is trending the wrong way.</TileNote>
        ) : (
          <TileList>
            {cards.slice(0, 3).map((c) => (
              <TileRow key={c.id}>
                <Link href={c.href} className="min-w-0 flex-1 truncate rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  {c.title}
                </Link>
                <RowMeta className={SEVERITY_VARIANT[c.severity] === "destructive" ? "text-destructive" : undefined}>{c.severity === "urgent" ? "Urgent" : c.severity === "warn" ? "Watch" : "Info"}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
        {cards.length > 3 ? <p className="mt-auto pt-1.5 text-xs text-muted-foreground">+ {cards.length - 3} more</p> : null}
      </Tile>
    );
  });
}

/** Open onboarding and offboarding cases: overdue first, three at most. */
export async function HrTrackerTile() {
  return guarded("Onboarding and offboarding", async () => {
    const t = await getTracker();
    if (!t) return null;
    const rows = [...t.onboarding.map((c) => ({ ...c, kind: "Onboarding", base: "/onboarding" })), ...t.offboarding.map((c) => ({ ...c, kind: "Offboarding", base: "/offboarding" }))]
      .sort((a, b) => Number(b.overdue > 0) - Number(a.overdue > 0))
      .slice(0, 3);
    const total = t.onboardingTotal + t.offboardingTotal;
    return (
      <Tile label="Onboarding and offboarding" title="Onboarding and offboarding" icon={<ClipboardCheck className="size-4 text-primary" aria-hidden />} href="/onboarding" hrefLabel="Tracker">
        {rows.length === 0 ? (
          <TileNote>No open cases.</TileNote>
        ) : (
          <TileList>
            {rows.map((c, i) => (
              <TileRow key={`${c.id}-${i}`}>
                <Link href={`${c.base}/${c.id}`} className="min-w-0 flex-1 truncate rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  {c.name} <span className="text-xs text-muted-foreground">{c.kind}</span>
                </Link>
                <RowMeta className={c.overdue > 0 ? "text-destructive" : undefined}>{c.overdue > 0 ? `${c.overdue} overdue` : `${c.done}/${c.total}`}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
        {total > rows.length ? <p className="mt-auto pt-1.5 text-xs text-muted-foreground">+ {total - rows.length} more</p> : null}
      </Tile>
    );
  });
}

/** Headcount by team, from the nightly summaries. Groups under 5 people are merged or hidden before they get here. */
export async function HrWorkforceTile() {
  return guarded("Workforce by team", async () => {
    const w = await getWorkforce();
    if (!w) return null;
    const teams = w.teams && !w.teams.hiddenAll ? [...w.teams.rows].sort((a, b) => b.headcount - a.headcount).slice(0, 4) : [];
    const max = Math.max(1, ...teams.map((r) => r.headcount));
    return (
      <Tile label="Workforce by team" title="Workforce by team" icon={<Users className="size-4 text-primary" aria-hidden />} href="/analytics" hrefLabel="Analytics">
        {teams.length === 0 ? (
          <TileNote>Teams under 5 people are not shown.</TileNote>
        ) : (
          <TileList>
            {teams.map((r, i) => (
              <TileRow key={`${r.id}-${i}`}>
                <span className="w-20 shrink-0 truncate">{r.name}</span>
                <span aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.headcount / max) * 100}%` }} />
                </span>
                <RowMeta>{r.headcount}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
      </Tile>
    );
  });
}

/** What needs HR's eyes now: counts and wording only, three at most. */
export async function HrAttentionTile() {
  return guarded("Needs attention", async () => {
    const items = await orFallback(() => getAttention("hr"), []);
    return (
      <Tile label="Needs attention" title="Needs attention" icon={<ListChecks className="size-4 text-primary" aria-hidden />}>
        {items.length === 0 ? (
          <TileNote>You are all caught up.</TileNote>
        ) : (
          <TileList>
            {items.slice(0, 3).map((a) => (
              <TileRow key={a.id}>
                <Link href={a.href} className="min-w-0 flex-1 truncate rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  {a.title}
                </Link>
              </TileRow>
            ))}
          </TileList>
        )}
        {items.length > 3 ? <p className="mt-auto pt-1.5 text-xs text-muted-foreground">+ {items.length - 3} more</p> : null}
      </Tile>
    );
  });
}
