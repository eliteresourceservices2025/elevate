import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/time";
import { RANGES } from "../constants";
import type { Breakdown, Cell, Dashboard } from "../view";
import { ExportButton } from "./export-button";
import { SeriesPanel } from "./series-panel";

// The People analytics page body. Server-rendered; only the chart panels and the export button are client components. All numbers
// arrive already suppressed (null = fewer than 5 people), so nothing hidden is ever in the page.

const FEWER = <span className="text-muted-foreground">fewer than 5</span>;
const show = (v: Cell, suffix = "") => (v === null ? FEWER : `${v}${suffix}`);

function Tile({ label, value, note }: { label: string; value: Cell; note?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value === null ? <span className="text-base font-normal text-muted-foreground">fewer than 5</span> : value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function sumIfAllShown(values: Cell[]): Cell {
  return values.length > 0 && values.every((v) => v !== null) ? Math.round((values as number[]).reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

function BreakdownTable({ title, data }: { title: string; data: Breakdown }) {
  return (
    <section aria-label={title} className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {data.rows.length === 0 && !data.other ? (
        <p className="text-sm text-muted-foreground">{data.hiddenAll ? "Every group here has fewer than 5 people, so none is shown." : "Nothing to show yet."}</p>
      ) : (
        <Table containerClassName="[--shadow-cover:var(--background)]">
          <caption className="sr-only">{title}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Group</TableHead>
              <TableHead scope="col" className="text-right">
                People
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right">{r.headcount}</TableCell>
              </TableRow>
            ))}
            {data.other ? (
              <TableRow>
                <TableCell className="text-muted-foreground">Other ({data.other.groups} smaller groups)</TableCell>
                <TableCell className="text-right">{data.other.headcount}</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">Groups with fewer than 5 people are combined under Other.</p>
    </section>
  );
}

export function AnalyticsDashboard({ data, canExport }: { data: Dashboard; canExport: boolean }) {
  const p = data.people;
  const h = data.hiring;
  const lastMove = p?.movement[p.movement.length - 1];
  const lastWeek = p?.attendance[p.attendance.length - 1];

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" aria-label="Choose what to show">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Range</span>
          <select name="range" defaultValue={String(data.rangeMonths)} className="rounded-md border bg-background px-2 py-1.5">
            {RANGES.map((r) => (
              <option key={r} value={r}>
                Last {r} months
              </option>
            ))}
          </select>
        </label>
        {data.scopeOptions.length > 1 ? (
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Group</span>
            <select name="scope" defaultValue={data.scope.value} className="max-w-72 rounded-md border bg-background px-2 py-1.5">
              {data.scopeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="rounded-lg border bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90">
          Show
        </button>
        {canExport ? <ExportButton range={data.rangeMonths} scope={data.scope.value === "downline" ? "company" : data.scope.value} /> : null}
      </form>

      <p className="text-sm text-muted-foreground">
        {data.asOf ? `Numbers as of ${formatDateOnly(data.asOf)} (built each night, company time).` : "No numbers yet."} Only totals are shown, never a person. Any group or cell with fewer than 5 people is hidden.
      </p>

      {data.peopleNote ? <p className="rounded-xl border bg-card p-4 text-sm">{data.peopleNote}</p> : null}

      {p ? (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold">People: {data.scope.label}</h2>
          </div>
          {p.hidden ? (
            <p className="rounded-xl border bg-card p-4 text-sm">This group has fewer than 5 people, so its numbers are hidden.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label="People now" value={p.headcountNow} />
                <Tile label="Turnover last month" value={lastMove?.turnover === null || lastMove === undefined ? null : lastMove.turnover} note="Leavers divided by average headcount, in percent." />
                <Tile label={`Prize days used, last ${data.rangeMonths} months`} value={sumIfAllShown(p.leave.map((l) => l.daysUsed))} />
                <Tile label="Late days, latest week" value={lastWeek?.lateRate ?? null} note="Percent of recorded days." />
              </div>
              <SeriesPanel
                title="Headcount"
                description="People working at the end of each month."
                xKey="date"
                kind="line"
                series={[{ key: "headcount", label: "People", color: "var(--chart-1)" }]}
                columns={[{ key: "date", label: "Date" }, { key: "headcount", label: "People" }]}
                rows={p.headcount.map((r) => ({ date: r.date, headcount: r.headcount }))}
              />
              <SeriesPanel
                title="Joiners and leavers"
                description="People who started and people whose last day fell in each month."
                xKey="month"
                kind="bar"
                series={[
                  { key: "joiners", label: "Joiners", color: "var(--chart-1)" },
                  { key: "leavers", label: "Leavers", color: "var(--chart-2)" },
                ]}
                columns={[{ key: "month", label: "Month" }, { key: "joiners", label: "Joiners" }, { key: "leavers", label: "Leavers" }, { key: "avgHeadcount", label: "Average headcount" }]}
                rows={p.movement.map((m) => ({ month: m.month.slice(0, 7), joiners: m.joiners, leavers: m.leavers, avgHeadcount: m.avgHeadcount }))}
              />
              <SeriesPanel
                title="Turnover"
                description="Leavers divided by the month's average headcount."
                xKey="month"
                kind="line"
                unit="%"
                series={[{ key: "turnover", label: "Turnover %", color: "var(--chart-3)" }]}
                columns={[{ key: "month", label: "Month" }, { key: "turnover", label: "Turnover", suffix: "%" }]}
                rows={p.movement.map((m) => ({ month: m.month.slice(0, 7), turnover: m.turnover }))}
              />
              <SeriesPanel
                title="Prize days used"
                description="Prize days taken, by the month of the day off. Counts only."
                xKey="month"
                kind="bar"
                series={[{ key: "daysUsed", label: "Days used", color: "var(--chart-1)" }]}
                columns={[{ key: "month", label: "Month" }, { key: "daysUsed", label: "Days used" }]}
                rows={p.leave.map((l) => ({ month: l.month.slice(0, 7), daysUsed: l.daysUsed }))}
              />
              <SeriesPanel
                title="Attendance flags"
                description="Share of recorded days with each flag, by week (Monday). Absent days are for review, never an automatic deduction."
                xKey="week"
                kind="line"
                unit="%"
                series={[
                  { key: "lateRate", label: "Late %", color: "var(--chart-1)" },
                  { key: "absentRate", label: "Absent %", color: "var(--chart-2)" },
                ]}
                columns={[
                  { key: "week", label: "Week of" },
                  { key: "dayCount", label: "Days recorded" },
                  { key: "late", label: "Late" },
                  { key: "absent", label: "Absent" },
                  { key: "leftEarly", label: "Left early" },
                  { key: "extraHours", label: "Extra hours" },
                  { key: "unapprovedExtra", label: "Unapproved extra" },
                  { key: "lateRate", label: "Late %", suffix: "%" },
                  { key: "absentRate", label: "Absent %", suffix: "%" },
                ]}
                rows={p.attendance.map((a) => ({ ...a }))}
              />
            </>
          )}
          {data.teams ? <BreakdownTable title="Headcount by team" data={data.teams} /> : null}
          {data.clients ? <BreakdownTable title="Headcount by client" data={data.clients} /> : null}
        </div>
      ) : null}

      {h ? (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Hiring</h2>
          <section aria-label="Hiring funnel" className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="text-lg font-semibold">Hiring funnel</h3>
            <p className="text-sm text-muted-foreground">Applications that reached each stage, counted in the month they applied.</p>
            <Table containerClassName="[--shadow-cover:var(--background)]">
              <caption className="sr-only">Hiring funnel, all jobs</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Stage</TableHead>
                  <TableHead scope="col" className="text-right">
                    Applications
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Of applied
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.funnel.map((f) => (
                  <TableRow key={f.stage}>
                    <TableCell>{f.label}</TableCell>
                    <TableCell className="text-right">{show(f.applications)}</TableCell>
                    <TableCell className="text-right">{show(f.ofApplied, "%")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          {h.byJob.length > 0 || h.otherJobs ? (
            <section aria-label="Funnel by job" className="space-y-2 rounded-xl border bg-card p-4">
              <h3 className="text-lg font-semibold">By job</h3>
              <Table containerClassName="[--shadow-cover:var(--background)]">
                <caption className="sr-only">Applications by job and stage</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Job</TableHead>
                    {["applied", "screening", "interview", "assessment", "offer", "hired"].map((s) => (
                      <TableHead key={s} scope="col" className="text-right capitalize">
                        {s}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {h.byJob.map((j) => (
                    <TableRow key={j.title + j.applied}>
                      <TableCell>{j.title}</TableCell>
                      {["applied", "screening", "interview", "assessment", "offer", "hired"].map((s) => (
                        <TableCell key={s} className="text-right">
                          {j.stages[s] ?? 0}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {h.otherJobs ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground">Other ({h.otherJobs.jobs} smaller jobs)</TableCell>
                      {["applied", "screening", "interview", "assessment", "offer", "hired"].map((s) => (
                        <TableCell key={s} className="text-right">
                          {h.otherJobs?.stages[s] ?? 0}
                        </TableCell>
                      ))}
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">Jobs with fewer than 5 applicants in this range are combined under Other.</p>
            </section>
          ) : null}
          <SeriesPanel
            title="Time to hire"
            description={`Days from applying to being hired, by month of hire. Overall average: ${h.overall.avgDays === null ? "fewer than 5 hires" : `${h.overall.avgDays} days`}.`}
            xKey="month"
            kind="bar"
            series={[{ key: "avgDays", label: "Average days", color: "var(--chart-1)" }]}
            columns={[{ key: "month", label: "Month" }, { key: "hires", label: "Hires" }, { key: "avgDays", label: "Average days" }, { key: "medianDays", label: "Median days" }]}
            rows={h.timeToHire.map((t) => ({ month: t.month.slice(0, 7), hires: t.hires, avgDays: t.avgDays, medianDays: t.medianDays }))}
          />
        </div>
      ) : null}
    </div>
  );
}

