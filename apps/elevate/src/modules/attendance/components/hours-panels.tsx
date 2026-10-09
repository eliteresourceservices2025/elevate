"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { toast } from "sonner";
import { ClientPager, usePaged } from "@/components/client-pager";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { MINUTE, formatDuration } from "../clock";
import { approveCleanWeeks, approveHoursWeek, exportHours, savePayPeriod } from "../hours-actions";
import type { HoursSettings, ReviewRow, TeamReview } from "../hours-queries";
import { PAY_PERIOD_LABELS, type PayPeriodKind } from "../pay-periods";

const STATE_TEXT: Record<ReviewRow["state"], string> = { approved: "Approved", partly: "Partly approved", changed: "Changed after approval", none: "Not approved", empty: "Nothing to approve yet" };
const STATE_VARIANT: Record<ReviewRow["state"], "default" | "secondary" | "outline" | "destructive"> = { approved: "default", partly: "secondary", changed: "destructive", none: "outline", empty: "outline" };
const hours = (minutes: number) => (minutes ? formatDuration(minutes * MINUTE) : "-");

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = <T,>(fn: () => Promise<{ ok: boolean; error?: string; data?: T }>, success: (data: T | undefined) => string) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        toast.success(success(result.data));
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return { run, pending, router };
}

/** A lead (their team) or HR (everyone) reviews a week and approves it person by person, or everyone with no flags at once. */
export function ReviewPanel({ review, prevHref, nextHref, flagLabels }: { review: TeamReview; prevHref: string; nextHref: string; flagLabels: Record<string, string> }) {
  const { run, pending } = useRun();
  const labels = new Map(Object.entries(flagLabels));
  const label = (f: string) => labels.get(f) ?? f;
  const paged = usePaged(review.rows, review.weekStart);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Week of {formatDateOnly(review.weekStart)} <span className="text-sm font-normal text-muted-foreground">to {formatDateOnly(review.weekEnd)}</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link href={prevHref} className="rounded-lg border px-3 py-1 text-sm hover:bg-secondary/50" aria-label="Previous week">
            Previous
          </Link>
          <Link href={nextHref} className="rounded-lg border px-3 py-1 text-sm hover:bg-secondary/50" aria-label="Next week">
            Next
          </Link>
          <Button
            size="sm"
            disabled={pending || review.pending === 0}
            onClick={() => run<{ approved: number; withFlags: number; skipped: number }>(() => approveCleanWeeks({ weekStart: review.weekStart }), (d) => `Approved ${d?.approved ?? 0} ${(d?.approved ?? 0) === 1 ? "person" : "people"}. ${d?.withFlags ?? 0} with flags are waiting for you to look.`)}
          >
            Approve everyone without flags
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        You approve the days that have finished. Approved hours are saved as they were: if a correction changes a day later, it shows as changed and needs approving again. HR exports approved hours for payroll.
        {review.scope === "team" ? " These are people on your team." : ""}
      </p>
      {review.rows.length === 0 ? (
        <p className="text-muted-foreground">Nobody has hours or a scheduled day that week.</p>
      ) : (
        <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="text-right">Scheduled</TableHead>
                <TableHead className="text-right">Worked</TableHead>
                <TableHead className="text-right">Extra</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((r) => (
                <Fragment key={r.employeeId}>
                  <TableRow>
                    <TableCell className="font-medium">
                      {r.name}
                      <span className="block text-xs font-normal text-muted-foreground">{r.team ?? "No team"}</span>
                    </TableCell>
                    <TableCell className="text-right">{hours(r.scheduledMinutes)}</TableCell>
                    <TableCell className="text-right font-medium">{hours(r.workedMinutes)}</TableCell>
                    <TableCell className="text-right">
                      {r.extraMinutes ? (
                        <>
                          +{formatDuration(r.extraMinutes * MINUTE)}
                          <span className="block text-xs text-muted-foreground">{r.approvedExtraMinutes ? `${formatDuration(r.approvedExtraMinutes * MINUTE)} approved` : "not approved"}</span>
                        </>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="space-x-1">
                      {r.flags.length === 0 ? "-" : r.flags.map((f) => (
                        <Badge key={f} variant="outline">
                          {label(f)}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_VARIANT[r.state]}>{STATE_TEXT[r.state]}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.canApprove ? (
                        <Button size="sm" disabled={pending} onClick={() => run<{ approved: number }>(() => approveHoursWeek({ employeeId: r.employeeId, weekStart: review.weekStart }), (d) => `Approved ${d?.approved ?? 0} ${(d?.approved ?? 0) === 1 ? "day" : "days"} for ${r.name}.`)}>
                          Approve week
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30 text-xs">
                    <TableCell colSpan={7} className="py-1">
                      <details>
                        <summary className="cursor-pointer text-muted-foreground">Days ({r.days.length})</summary>
                        <ul className="mt-2 space-y-1">
                          {r.days.map((d) => (
                            <li key={d.date} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span className="w-28 font-medium">
                                {d.weekday}, {formatDateOnly(d.date)}
                              </span>
                              <span className="w-40">
                                {d.firstIn ? formatInZone(d.firstIn, r.zone, "h:mm a") : "-"} to {d.lastOut ? formatInZone(d.lastOut, r.zone, "h:mm a") : "-"}
                              </span>
                              <span className="w-28">Worked {hours(d.workedMinutes)}</span>
                              <span className="w-28">{d.scheduledMinutes !== null ? `Scheduled ${hours(d.scheduledMinutes)}` : "Rest day"}</span>
                              <span className="w-32">{d.extraMinutes ? `Extra +${formatDuration(d.extraMinutes * MINUTE)}` : ""}</span>
                              <span className="space-x-1">
                                {d.flags.map((f) => (
                                  <Badge key={f} variant="outline">
                                    {label(f)}
                                  </Badge>
                                ))}
                              </span>
                              <Badge variant={d.state === "approved" ? "default" : d.state === "changed" ? "destructive" : "outline"}>{d.state === "approved" ? "Approved" : d.state === "changed" ? "Changed after approval" : d.finished ? "Not approved" : "Day not over"}</Badge>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </TableCell>
                  </TableRow>
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {review.rows.length > 0 ? <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="people" /> : null}
    </div>
  );
}

/** How much of a pay period is approved, by team, so HR knows whether the export is complete before payroll. */
function ProgressBox({ progress }: { progress: HoursSettings["progress"][number] }) {
  const open = progress.teams.filter((t) => t.pendingDays > 0);
  return (
    <div role="status" className={`rounded-lg border p-3 text-sm ${progress.pendingDays === 0 ? "border-green-600/40 bg-green-600/10" : "border-amber-500/50 bg-amber-500/10"}`}>
      {progress.totalDays === 0 ? (
        "No finished days in this period yet."
      ) : progress.pendingDays === 0 ? (
        <>All {progress.totalDays} finished days in this period are approved.</>
      ) : (
        <>
          <strong>{progress.pendingDays} of {progress.totalDays} finished days are not approved yet</strong> ({progress.pendingPeople} {progress.pendingPeople === 1 ? "person" : "people"}). They are left out of the export until a lead or HR approves them.
          <ul className="mt-1 list-disc pl-5">
            {open.map((t) => (
              <li key={t.team}>
                {t.team}: {t.pendingDays} {t.pendingDays === 1 ? "day" : "days"} ({t.pendingPeople} {t.pendingPeople === 1 ? "person" : "people"})
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** HR: how pay periods are cut, and the CSV downloads for a period. */
export function ExportPanel({ settings }: { settings: HoursSettings }) {
  const { run, pending } = useRun();
  const [period, setPeriod] = useState(settings.periods[0]?.start ?? "");
  const [includeAll, setIncludeAll] = useState(false);
  const [kind, setKind] = useState<PayPeriodKind>(settings.kind);
  const [anchor, setAnchor] = useState(settings.biweeklyAnchor);

  const download = (what: "daily" | "summary") =>
    run<{ fileName: string; csv: string; rows: number; unapprovedDays: number }>(
      async () => {
        const result = await exportHours({ periodStart: period, kind: what, includeUnapproved: includeAll });
        if (result.ok) {
          const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = result.data.fileName;
          a.click();
          URL.revokeObjectURL(url);
        }
        return result;
      },
      (d) => `Downloaded ${d?.rows ?? 0} ${(d?.rows ?? 0) === 1 ? "row" : "rows"}.${!includeAll && (d?.unapprovedDays ?? 0) > 0 ? ` ${d?.unapprovedDays} finished ${d?.unapprovedDays === 1 ? "day is" : "days are"} not approved and left out.` : ""}`,
    );

  return (
    <div className="space-y-6">
      <section aria-label="Export hours" className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Export hours for payroll</h2>
        <p className="text-sm text-muted-foreground">
          ELEVATE totals and labels hours; it does not compute pay. By default only days a lead or HR approved, with the numbers they approved, are included. Hours that were corrected after approval are left out until approved again.
        </p>
        {settings.progress.find((p) => p.start === period) ? <ProgressBox progress={settings.progress.find((p) => p.start === period)!} /> : null}
        <SelectField id="ex-period" label="Pay period" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {settings.periods.map((p) => (
            <option key={p.start} value={p.start}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <label htmlFor="ex-all" className="flex items-center gap-2 text-sm">
          <input id="ex-all" type="checkbox" className="size-4 accent-primary" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          Also include days that are not approved yet (they are labelled)
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !period} onClick={() => download("daily")}>
            Download daily detail (CSV)
          </Button>
          <Button variant="outline" disabled={pending || !period} onClick={() => download("summary")}>
            Download per-person summary (CSV)
          </Button>
        </div>
      </section>

      <form
        className="space-y-3 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => savePayPeriod({ kind, biweeklyAnchor: kind === "biweekly" ? anchor : undefined }), () => "Pay periods saved.");
        }}
      >
        <h3 className="font-semibold">How pay periods are cut</h3>
        <SelectField id="pp-kind" label="Pay periods" value={kind} onChange={(e) => setKind(e.target.value as PayPeriodKind)}>
          {Object.entries(PAY_PERIOD_LABELS).map(([k, text]) => (
            <option key={k} value={k}>
              {text}
            </option>
          ))}
        </SelectField>
        {kind === "biweekly" ? <TextField id="pp-anchor" label="A Monday a period starts on" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} required /> : null}
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </form>
    </div>
  );
}
