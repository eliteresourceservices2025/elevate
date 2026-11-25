import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { SchedulesPanel } from "@/modules/attendance/components/schedules-panel";
import { PersonScheduleView } from "@/modules/attendance/components/person-schedule";
import { ScheduleChips } from "@/modules/attendance/components/schedule-chips";
import { getMySchedule, listSchedules, listTeamSchedules } from "@/modules/attendance/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Schedules" };

export default async function SchedulesPage({ searchParams }: PageProps<"/schedules">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const manage = scopeFor(user, "schedules.manage");
  const mine = await orNotFound(getMySchedule(one(params.week)));
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
        {!mine ? <p className="text-sm text-muted-foreground">You do not have a people record yet, so there is no schedule to show. Ask HR.</p> : null}
        {mine && mine.entries.length === 0 ? <p className="text-sm text-muted-foreground">You have no schedule yet, so late, early and extra hours are not tracked. HR sets schedules.</p> : null}
        {mine && (mine.entries.length > 0 || mine.hours?.days.some((d) => d.minutes !== null) || mine.hours?.usualMinutes != null) ? <PersonScheduleView data={mine} basePath="/schedules" /> : null}
      </section>

      {all ? <SchedulesPanel rows={all.rows} withoutSchedule={all.withoutSchedule} today={todayInZone()} clients={all.clients} /> : null}

      {team ? (
        <section aria-label="Team schedules" className="space-y-2">
          <h2 className="text-lg font-semibold">Your team&apos;s schedules</h2>
          {team.rows.length === 0 ? (
            <p className="text-muted-foreground">Nobody reports to you yet.</p>
          ) : (
            <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
              <Table stack>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>This week</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamPage?.rows.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="font-medium">
                        <Link href={`/schedules/${r.employeeId}`} className="text-primary underline-offset-4 hover:underline">
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell label="This week">{r.entries.length > 0 ? <ScheduleChips chips={r.chips} nextChange={r.nextChange} /> : <Badge variant="outline">No schedule</Badge>}</TableCell>
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
