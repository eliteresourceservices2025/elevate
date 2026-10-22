import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SelectField, TextField } from "@/components/form-fields";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orNotFound } from "@/lib/or-not-found";
import { CLOSE_KIND_LABELS, SOURCE_LABELS, STAGE_LABELS } from "@/modules/recruiting/constants";
import { getRecruitingReport, REPORT_STALE_DAYS } from "@/modules/recruiting/queries";
import { formatDays } from "@/modules/recruiting/report-math";

export const metadata: Metadata = { title: "Recruiting reports" };

const first = (v: unknown): string => (Array.isArray(v) ? first(v[0]) : typeof v === "string" ? v : "");
const isoDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RecruitingReportsPage({ searchParams }: PageProps<"/recruiting/reports">) {
  const sp = await searchParams;
  const job = first(sp.job);
  const report = await orNotFound(getRecruitingReport({ from: isoDate(first(sp.from)), to: isoDate(first(sp.to)), openingId: UUID.test(job) ? job.toLowerCase() : null }));
  const maxFunnel = Math.max(1, ...report.funnel.map((f) => f.reached));

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Recruiting reports"
        description="Counts only, no names. For applications that came in between the dates below."
        breadcrumbs={[{ label: "Recruiting", href: "/recruiting" }, { label: "Reports" }]}
      />

      <form method="get" action="/recruiting/reports" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Report dates">
        <TextField id="rp-from" name="from" label="Applied from" type="date" defaultValue={report.range.from} />
        <TextField id="rp-to" name="to" label="Applied to" type="date" defaultValue={report.range.to} />
        <SelectField id="rp-job" name="job" label="Job" defaultValue={UUID.test(job) ? job.toLowerCase() : ""}>
          <option value="">All jobs</option>
          {report.openings.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end gap-2">
          <Button type="submit">Show report</Button>
          <Link href="/recruiting/reports" className={buttonVariants({ variant: "ghost" })}>
            Last 90 days
          </Link>
        </div>
      </form>

      {report.total === 0 ? (
        <EmptyState icon={BarChart3} title="No applications in these dates" description="Pick a wider range or another job." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="rp-funnel" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="rp-funnel" className="text-lg font-semibold">
              How far applications got
            </h2>
            <p className="text-sm text-muted-foreground">{report.total} applications. Someone who reached a later stage counts at the earlier ones too.</p>
            <ol className="space-y-2">
              {report.funnel.map((f) => (
                <li key={f.stage} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{STAGE_LABELS[f.stage]}</span>
                    <span className="tabular-nums">
                      {f.reached}
                      {f.ofApplied !== null ? <span className="text-muted-foreground"> · {f.ofApplied}% of all</span> : null}
                      {f.ofPrevious !== null ? <span className="text-muted-foreground"> · {f.ofPrevious}% of the step before</span> : null}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted" role="presentation">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.round((f.reached / maxFunnel) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="rp-time" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="rp-time" className="text-lg font-semibold">
              Time in each stage
            </h2>
            <p className="text-sm text-muted-foreground">The middle value (median) of how long applications stayed in a stage. Applications still in a stage count up to today.</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Median time</TableHead>
                  <TableHead className="text-right">Applications</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.timeInStage.map((t) => (
                  <TableRow key={t.stage}>
                    <TableCell>{STAGE_LABELS[t.stage]}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDays(t.medianDays)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.n}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <section aria-labelledby="rp-source" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="rp-source" className="text-lg font-semibold">
              Where applicants come from
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                  <TableHead className="text-right">Reached interview</TableHead>
                  <TableHead className="text-right">Hired</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.sources.map((s) => (
                  <TableRow key={s.source ?? "none"}>
                    <TableCell>{s.source ? SOURCE_LABELS[s.source] : "Not said"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.interviews}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.hired}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <section aria-labelledby="rp-closed" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="rp-closed" className="text-lg font-semibold">
              How applications ended
            </h2>
            {report.closed.length === 0 ? (
              <p className="text-sm text-muted-foreground">None closed yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {report.closed.map((c) => (
                  <li key={c.kind ?? "other"} className="flex items-center justify-between rounded-md border px-3 py-1.5">
                    <span>{c.kind ? CLOSE_KIND_LABELS[c.kind] : "Closed"}</span>
                    <span className="font-medium tabular-nums">{c.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="rp-stale" className="space-y-3 rounded-xl border bg-card p-4 lg:col-span-2">
            <h2 id="rp-stale" className="text-lg font-semibold">
              Waiting longest
            </h2>
            <p className="text-sm text-muted-foreground">Open applications with no change in {REPORT_STALE_DAYS} days or more, by job (right now, whatever the dates).</p>
            {report.stale.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is waiting that long.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {report.stale.map((s) => (
                  <li key={s.openingId} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                    <Link href={`/recruiting/${s.openingId}`} className="text-primary underline-offset-4 hover:underline">
                      {s.title}
                    </Link>
                    <span className="font-medium tabular-nums">{s.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageContainer>
  );
}
