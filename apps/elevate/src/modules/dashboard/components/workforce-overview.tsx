import Link from "next/link";
import { Users } from "lucide-react";
import type { Breakdown } from "@/modules/analytics/view";
import { getWorkforce } from "../panel-queries";
import { sparkline } from "../workforce";
import { guarded } from "./guard";

function Bars({ title, data }: { title: string; data: Breakdown | null }) {
  if (!data || data.hiddenAll) return null;
  const rows = [...data.rows].sort((a, b) => b.headcount - a.headcount).slice(0, 6);
  const other = data.other;
  const max = Math.max(1, ...rows.map((r) => r.headcount), other?.headcount ?? 0);
  if (rows.length === 0 && !other) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-2 text-xs">
            <span className="truncate">{r.name}</span>
            <span aria-hidden className="h-2 overflow-hidden rounded-full bg-secondary">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.headcount / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted-foreground">{r.headcount}</span>
          </li>
        ))}
        {other ? (
          <li className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground">Other ({other.groups} small {other.groups === 1 ? "group" : "groups"})</span>
            <span aria-hidden className="h-2 overflow-hidden rounded-full bg-secondary">
              <span className="block h-full rounded-full bg-muted-foreground/40" style={{ width: `${(other.headcount / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted-foreground">{other.headcount}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** Headcount over the last year and how people are spread across teams and clients. Groups under 5 people are merged or hidden before they get here. */
export async function WorkforceOverview() {
  return guarded("Workforce overview", async () => {
    const w = await getWorkforce();
    if (!w) return null;
    const line = sparkline(w.trend.map((p) => p.headcount));
    const first = w.trend.find((p) => p.headcount !== null)?.headcount ?? null;
    const change = first !== null && w.headcountNow !== null ? w.headcountNow - first : null;
    return (
      <section aria-label="Workforce overview" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="size-5 text-primary" aria-hidden />
            Workforce overview
          </h2>
          <Link href="/analytics" className="text-sm text-primary underline-offset-4 hover:underline">
            Full analytics
          </Link>
        </div>
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{w.scopeLabel}</p>
              <p className="font-heading text-3xl font-bold tabular-nums">{w.headcountNow === null ? "Fewer than 5" : w.headcountNow.toLocaleString("en-US")}</p>
              {change !== null ? (
                <p className="text-xs text-muted-foreground">
                  {change === 0 ? "No change" : `${change > 0 ? "+" : ""}${change}`} over the last 12 months
                </p>
              ) : null}
            </div>
            {line ? (
              <svg viewBox="0 0 120 36" role="img" aria-label={`Headcount over the last 12 months: ${first ?? "hidden"} at the start, ${w.headcountNow ?? "hidden"} now.`} className="h-10 w-32 text-primary">
                <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Bars title="By team" data={w.teams} />
            <Bars title="By client" data={w.clients} />
          </div>
          <p className="text-xs text-muted-foreground">Up to date as of {w.asOf}. Groups under 5 people are merged into Other.</p>
        </div>
      </section>
    );
  });
}
