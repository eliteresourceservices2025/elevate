"use client";

import { useId, useState } from "react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// One metric as a chart with a data table behind a toggle, so the numbers are readable without seeing the chart. Hidden cells arrive
// from the server as null and are shown as "fewer than 5"; they are never drawn. No dependency: the chart is plain SVG.

export type Cell = number | string | null;
export type Column = { key: string; label: string; suffix?: string };
export type Series = { key: string; label: string; color: string };
type Row = Record<string, Cell>;

const W = 640;
const H = 200;
const M = { top: 12, right: 12, bottom: 28, left: 44 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

function Chart({ rows, xKey, series, kind, summary, format }: { rows: Row[]; xKey: string; series: Series[]; kind: "line" | "bar"; summary: string; format: (n: number) => string }) {
  const values = series.flatMap((s) => rows.map((r) => r[s.key])).filter((v): v is number => typeof v === "number");
  const max = niceMax(Math.max(0, ...values));
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const n = rows.length;
  const x = (i: number) => M.left + (kind === "bar" ? ((i + 0.5) / Math.max(n, 1)) * innerW : n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - (v / max) * innerH;
  const step = Math.max(1, Math.ceil(n / 8));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const barW = Math.max(3, Math.min(28, innerW / Math.max(n, 1) / (series.length + 0.6)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-auto w-full max-w-3xl">
      <title>{summary}</title>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.12} />
          <text x={M.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.7}>
            {format(t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) =>
        i % step === 0 ? (
          <text key={String(r[xKey])} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.7}>
            {String(r[xKey]).slice(kind === "bar" || String(r[xKey]).length <= 7 ? 0 : 5)}
          </text>
        ) : null,
      )}
      {series.map((s, si) => {
        if (kind === "bar")
          return rows.map((r, i) => {
            const v = r[s.key];
            if (typeof v !== "number") return null;
            const bx = x(i) - (series.length * barW) / 2 + si * barW;
            return <rect key={`${s.key}-${i}`} x={bx} y={y(v)} width={barW - 1} height={Math.max(0, M.top + innerH - y(v))} fill={s.color} rx={1} />;
          });
        // Lines break at a hidden value instead of bridging it
        let d = "";
        let pen = false;
        rows.forEach((r, i) => {
          const v = r[s.key];
          if (typeof v !== "number") {
            pen = false;
            return;
          }
          d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
          pen = true;
        });
        return (
          <g key={s.key}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} />
            {rows.map((r, i) => (typeof r[s.key] === "number" ? <circle key={i} cx={x(i)} cy={y(r[s.key] as number)} r={2.5} fill={s.color} /> : null))}
          </g>
        );
      })}
    </svg>
  );
}

export function SeriesPanel({
  title,
  description,
  rows,
  columns,
  xKey,
  series,
  kind = "line",
  unit = "",
  empty = "Nothing to show for this range yet.",
}: {
  title: string;
  description?: string;
  rows: Row[];
  columns: Column[];
  xKey: string;
  series: Series[];
  kind?: "line" | "bar";
  unit?: string;
  empty?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const paged = usePaged(rows, "", 12);
  const id = useId();
  const shownValues = series.flatMap((s) => rows.map((r) => r[s.key])).filter((v): v is number => typeof v === "number");
  const hiddenCount = series.reduce((n, s) => n + rows.filter((r) => r[s.key] === null).length, 0);
  const summary = shownValues.length
    ? `${title}: ${series.map((s) => s.label).join(", ")} over ${rows.length} periods, from ${rows[0]?.[xKey]} to ${rows[rows.length - 1]?.[xKey]}. Highest value ${Math.max(...shownValues)}${unit}${hiddenCount ? `. ${hiddenCount} values are hidden because fewer than 5 people are in the group` : ""}. The same numbers are in the table view.`
    : `${title}: no values to show.`;
  const format = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${id}-h`} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div role="group" aria-label={`${title}: how to show it`} className="flex overflow-hidden rounded-lg border text-sm">
          {(["chart", "table"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-3 py-1 ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary/50"}`}>
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : view === "chart" ? (
        <div className="space-y-2">
          <Chart rows={rows} xKey={xKey} series={series} kind={kind} summary={summary} format={format} />
          <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? <p className="text-xs text-muted-foreground">Gaps are periods with fewer than 5 people in the group: those numbers are not shown.</p> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <Table>
            <caption className="sr-only">{title}</caption>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key} scope="col">
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((r, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={c.key === xKey ? "font-medium" : undefined}>
                      {r[c.key] === null ? <span className="text-muted-foreground">fewer than 5</span> : `${r[c.key]}${c.suffix ?? ""}`}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="periods" />
        </div>
      )}
    </section>
  );
}
