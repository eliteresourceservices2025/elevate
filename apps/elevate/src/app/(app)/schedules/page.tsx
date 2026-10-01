import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { formatDateOnly } from "@/lib/time";
import { SchedulesPanel } from "@/modules/attendance/components/schedules-panel";
import { getMySchedule, listSchedules, listTeamSchedules, type ScheduleLine } from "@/modules/attendance/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Schedules" };

function Line({ s, label }: { s: ScheduleLine; label?: string }) {
  return (
    <p className="text-sm">
      {label ? <span className="font-semibold">{label} </span> : null}
      {s.days}, {s.client} ({s.zone}), which is <strong>{s.manila}</strong> in Manila. Unpaid break {s.breakMinutes} min.{" "}
      <span className="text-muted-foreground">
        From {formatDateOnly(s.from)}
        {s.to ? ` to ${formatDateOnly(s.to)}` : ""}.
      </span>
    </p>
  );
}

export default async function SchedulesPage() {
  const user = await requireUser();
  const manage = scopeFor(user, "schedules.manage");
  const mine = await orNotFound(getMySchedule());
  const all = manage ? await orNotFound(listSchedules()) : null;
  const team = !manage && scopeFor(user, "schedules.view") === "team" ? await orNotFound(listTeamSchedules()) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Schedules</h1>
        <p className="mt-1 text-muted-foreground">Shifts in the client&apos;s time zone, also shown in Manila time. Your time clock uses them to flag late arrivals, early leaves, absences and extra hours.</p>
      </div>

      <section aria-label="My schedule" className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">My schedule</h2>
        {!mine ? (
          <p className="text-sm text-muted-foreground">You do not have a people record yet, so there is no schedule to show. Ask HR.</p>
        ) : mine.current ? (
          <Line s={mine.current} />
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
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>In Manila</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.rows.map((r) => (
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
          <p className="text-sm text-muted-foreground">HR changes schedules. Ask HR if one is wrong.</p>
        </section>
      ) : null}
    </div>
  );
}
