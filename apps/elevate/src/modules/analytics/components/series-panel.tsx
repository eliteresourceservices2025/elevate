"use client";

import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// One metric as a chart with a data table behind a toggle, so the numbers are readable without seeing the chart. Hidden cells arrive
// from the server as null and are shown as "fewer than 5"; they are never drawn. The chart is Recharts.

export type Cell = number | string | null;
export type Column = { key: string; label: string; suffix?: string };
export type Series = { key: string; label: string; color: string };
type Row = Record<string, Cell>;

/** The chart itself (Recharts). A hidden cell is null, so a line breaks there and a bar is missing: hidden numbers are never drawn. */
function Chart({ rows, xKey, series, kind, summary, format }: { rows: Row[]; xKey: string; series: Series[]; kind: "line" | "bar"; summary: string; format: (n: number) => string }) {
  const data = rows.map((r) => ({ ...r }));
  const interval = Math.max(0, Math.ceil(rows.length / 8) - 1);
  const shortX = (v: unknown) => {
    const t = String(v);
    return kind === "bar" || t.length <= 7 ? t : t.slice(5);
  };
  const axis = { stroke: "currentColor", strokeOpacity: 0.5, fontSize: 11 } as const;
  const common = { data, margin: { top: 8, right: 12, bottom: 4, left: 0 } };
  const parts = [
    <CartesianGrid key="g" stroke="currentColor" strokeOpacity={0.12} vertical={false} />,
    <XAxis key="x" dataKey={xKey} interval={interval} tickFormatter={shortX} tick={{ fill: "currentColor", fillOpacity: 0.7, fontSize: 11 }} {...axis} />,
    <YAxis key="y" width={44} tickFormatter={(v: number) => format(v)} tick={{ fill: "currentColor", fillOpacity: 0.7, fontSize: 11 }} {...axis} />,
    <Tooltip key="t" formatter={(v) => (typeof v === "number" ? format(v) : String(v))} contentStyle={{ fontSize: 12 }} />,
  ];
  return (
    <div role="img" aria-label={summary} className="h-52 w-full max-w-3xl">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart {...common}>
            {parts}
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        ) : (
          <LineChart {...common}>
            {parts}
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
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
