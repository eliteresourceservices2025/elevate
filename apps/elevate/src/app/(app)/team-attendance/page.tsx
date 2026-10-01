import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { PagerLinks } from "@/components/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { formatDuration, MINUTE } from "@/modules/attendance/clock";
import { FLAG_LABELS } from "@/modules/attendance/flag-labels";
import { listFlags, listShiftNotes, listWorkingNow } from "@/modules/attendance/queries";

export const metadata: Metadata = { title: "Team attendance" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function TeamAttendancePage({ searchParams }: PageProps<"/team-attendance">) {
  await requireUser();
  const params = await searchParams;
  const [working, flags, notes] = await Promise.all([orNotFound(listWorkingNow()), orNotFound(listFlags()), orNotFound(listShiftNotes())]);
  const query = { wpage: one(params.wpage), wsize: one(params.wsize), fpage: one(params.fpage), fsize: one(params.fsize), npage: one(params.npage), nsize: one(params.nsize) };
  const cut = <T,>(rows: T[], page?: string, size?: string, defaultSize?: number) => {
    const p = parsePaging({ page, size }, defaultSize);
    return paginate(rows, p.page, p.pageSize);
  };
  const w = cut(working.rows, query.wpage, query.wsize);
  const f = cut(flags.rows, query.fpage, query.fsize);
  const n = cut(notes.rows, query.npage, query.nsize, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Team attendance</h1>
        <p className="mt-1 text-muted-foreground">Who is clocked in, what needs a look, and the end-of-day reports from your team.</p>
      </div>

      <section aria-label="Working now" className="space-y-2">
        <h2 className="text-lg font-semibold">Working now</h2>
        {working.rows.length === 0 ? (
          <p className="text-muted-foreground">Nobody is clocked in right now.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Since</TableHead>
                    <TableHead>Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {w.rows.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.team ?? "No team"}</TableCell>
                      <TableCell className="space-x-1">
                        <Badge variant={r.state === "break" ? "secondary" : "default"}>{r.state === "break" ? "On break" : "Working"}</Badge>
                        {r.outsideRange ? <Badge variant="outline">Outside IP range</Badge> : null}
                        {r.longOpen ? <Badge variant="destructive">Over 12 hours</Badge> : null}
                        {r.possiblyOffline ? <Badge variant="outline">Possibly offline</Badge> : null}
                      </TableCell>
                      <TableCell>{formatInZone(r.sinceMs, undefined, "MMM d, h:mm a")}</TableCell>
                      <TableCell>{r.lastSeenMs ? formatInZone(r.lastSeenMs, undefined, "h:mm a") : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PagerLinks info={w.info} basePath="/team-attendance" query={query} pageKey="wpage" sizeKey="wsize" label="people" />
          </>
        )}
      </section>

      <section aria-label="Flags" className="space-y-2">
        <h2 className="text-lg font-semibold">Flags in the last two weeks</h2>
        <p className="text-sm text-muted-foreground">Rebuilt every night from the clock events.</p>
        {flags.rows.length === 0 ? (
          <p className="text-muted-foreground">Nothing to look at.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead className="text-right">Worked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {f.rows.map((r) => (
                    <TableRow key={`${r.employeeId}-${r.date}`}>
                      <TableCell>{formatDateOnly(r.date)}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="space-x-1">
                        {r.flags.map((fl) => (
                          <Badge key={fl} variant="outline">
                            {fl === "overbreak" && r.overbreakMinutes
                              ? `Overbreak +${r.overbreakMinutes} min`
                              : fl === "late" && r.lateMinutes
                                ? `Late ${r.lateMinutes} min`
                                : fl === "left_early" && r.earlyLeaveMinutes
                                  ? `Left ${r.earlyLeaveMinutes} min early`
                                  : fl === "extra_hours" && r.extraMinutes
                                    ? `Extra +${formatDuration(r.extraMinutes * MINUTE)}`
                                    : (FLAG_LABELS.get(fl) ?? fl)}
                          </Badge>
                        ))}
                      </TableCell>
                      <TableCell className="text-right">{formatDuration(r.workedMinutes * MINUTE)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PagerLinks info={f.info} basePath="/team-attendance" query={query} pageKey="fpage" sizeKey="fsize" label="flagged days" />
          </>
        )}
      </section>

      <section aria-label="End-of-day reports" className="space-y-2">
        <h2 className="text-lg font-semibold">End-of-day reports, last 7 days</h2>
        {notes.rows.length === 0 ? (
          <p className="text-muted-foreground">No reports yet.</p>
        ) : (
          <>
            <ul className="space-y-3">
              {n.rows.map((r) => (
                <li key={r.id} className="space-y-1 rounded-xl border bg-card p-4">
                  <p className="text-sm font-semibold">
                    {r.name} <span className="font-normal text-muted-foreground">{formatInZone(r.sessionStartMs, undefined, "EEE MMM d, h:mm a")}</span>
                    {r.edited ? <span className="ml-1 text-xs font-normal text-muted-foreground">(edited)</span> : null}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                </li>
              ))}
            </ul>
            <PagerLinks info={n.info} basePath="/team-attendance" query={query} pageKey="npage" sizeKey="nsize" defaultSize={10} label="reports" />
          </>
        )}
      </section>
    </div>
  );
}
