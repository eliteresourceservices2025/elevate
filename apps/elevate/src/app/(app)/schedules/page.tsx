import type { Metadata } from "next";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { formatDateOnly } from "@/lib/time";
import { SchedulesPanel } from "@/modules/attendance/components/schedules-panel";
import { getMySchedule, listSchedules, listTeamSchedules, type ScheduleLine } from "@/modules/attendance/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Schedules" };

function Line({ s, label }: { s: ScheduleLine; label?: string }) {
  return (
    <div className="rounded-lg border bg-background p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {label ? <span className="font-semibold">{label}</span> : null}
        <span className="font-medium">{s.days}</span>
        <span className="text-muted-foreground">
          From {formatDateOnly(s.from)}
          {s.to ? ` to ${formatDateOnly(s.to)}` : ""}
        </span>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Client time</dt>
          <dd>{s.client}</dd>
          <dd className="text-xs text-muted-foreground">{s.zone}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Manila time</dt>
          <dd>{s.manila}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Unpaid break</dt>
          <dd>{s.breakMinutes} min</dd>
        </div>
      </dl>
    </div>
  );
}

export default async function SchedulesPage({ searchParams }: PageProps<"/schedules">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const manage = scopeFor(user, "schedules.manage");
  const mine = await orNotFound(getMySchedule());
  const all = manage ? await orNotFound(listSchedules()) : null;
  const team = !manage && scopeFor(user, "schedules.view") === "team" ? await orNotFound(listTeamSchedules()) : null;

  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const teamPage = team ? paginate(team.rows, paging.page, paging.pageSize) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Schedules"
        description="Shifts in the client's time zone, also shown in Manila time. Your time clock uses them to flag late arrivals, early leaves, absences and extra hours."
      />

      <section aria-label="My schedule" className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-lg font-semibold">My schedule</h2>
          <p className="text-sm text-muted-foreground">Your schedule sets the expected workdays and the attendance checks for your shift.</p>
        </div>
        {!mine ? (
          <p className="text-sm text-muted-foreground">You do not have a people record yet, so there is no schedule to show. Ask HR.</p>
        ) : mine.current ? (
          <Line s={mine.current} label="Current" />
        ) : (
          <p className="text-sm text-muted-foreground">You have no schedule yet, so late, early and extra hours are not tracked. HR sets schedules.</p>
        )}
        {mine?.upcoming.map((s) => <Line key={s.from} s={s} label="Next:" />)}
        {mine && mine.past.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Earlier schedules ({mine.past.length})</summary>
            <div className="mt-2 space-y-1">
              {mine.past.map((s) => (
                <Line key={s.from} s={s} />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      {all ? <SchedulesPanel rows={all.rows} withoutSchedule={all.withoutSchedule} today={todayInZone()} /> : null}

      {team ? (
        <section aria-label="Team schedules" className="space-y-2">
          <h2 className="text-lg font-semibold">Your team&apos;s schedules</h2>
          {team.rows.length === 0 ? (
            <p className="text-muted-foreground">Nobody reports to you yet.</p>
          ) : (
            <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>In Manila</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamPage?.rows.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        {r.current ? (
                          <span>
                            {r.current.days}, {r.current.client}
                          </span>
                        ) : (
                          <Badge variant="outline">No schedule</Badge>
                        )}
                        {r.upcoming ? (
                          <span className="block text-xs text-muted-foreground">
                            Then from {formatDateOnly(r.upcoming.effectiveFrom)}: {r.upcoming.days}, {r.upcoming.client}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{r.current?.manila ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {teamPage ? <PagerLinks info={teamPage.info} basePath="/schedules" label="people" /> : null}
          <p className="text-sm text-muted-foreground">HR changes schedules. Ask HR if one is wrong.</p>
        </section>
      ) : null}
    </PageContainer>
  );
}
