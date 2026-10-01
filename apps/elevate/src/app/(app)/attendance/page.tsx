import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { formatDuration, MINUTE } from "@/modules/attendance/clock";
import { AutoRefresh } from "@/modules/attendance/components/auto-refresh";
import { CorrectionForm, CorrectionList, FileForOthersForm, PreferencesForm, RulesForm, SetupProfileForm, ShiftNote } from "@/modules/attendance/components/attendance-forms";
import { BulkCorrectionsPanel } from "@/modules/attendance/components/bulk-corrections-panel";
import { HealthPanel } from "@/modules/health/components/health-panel";
import { getSystemHealth } from "@/modules/health/queries";
import { ExportPanel } from "@/modules/attendance/components/hours-panels";
import { getHoursSettings } from "@/modules/attendance/hours-queries";
import { getMyTime, listClockRules, listCorrectionBatches, listCorrectionQueue, listFilablePeople, mondayOf } from "@/modules/attendance/queries";

export const metadata: Metadata = { title: "Attendance" };

const ALL_TABS = [
  { key: "mine", label: "My time" },
  { key: "corrections", label: "Corrections" },
  { key: "export", label: "Hours export" },
  { key: "rules", label: "Rules" },
  { key: "health", label: "Health" },
] as const;

// Old addresses (bookmarks, notifications sent before these became their own pages) go to the page that now holds the content.
const MOVED: Record<string, string> = { team: "/team-attendance", extra: "/extra-hours", review: "/hours-review", jibble: "/jibble" };

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requireUser();
  const params = await searchParams;
  const moved = typeof params.tab === "string" ? MOVED[params.tab] : undefined;
  if (moved) redirect(typeof params.rweek === "string" && params.tab === "review" ? `${moved}?rweek=${encodeURIComponent(params.rweek)}` : moved);
  const allowed = new Set<string>(["mine"]);
  const approve = scopeFor(user, "attendance.approve_correction");
  if (approve === "all" || approve === "team") allowed.add("corrections");
  if (scopeFor(user, "attendance.manage_rules")) allowed.add("rules");
  if (scopeFor(user, "hours.export")) allowed.add("export");
  if (scopeFor(user, "health.view")) allowed.add("health");
  const tabs = ALL_TABS.filter((t) => allowed.has(t.key));
  const tab = tabs.find((t) => t.key === params.tab)?.key ?? "mine";

  const mine = tab === "mine" ? await orNotFound(getMyTime(typeof params.week === "string" ? params.week : undefined)) : null;
  const queue = tab === "corrections" ? await orNotFound(listCorrectionQueue()) : null;
  const filable = tab === "corrections" && ["all", "team"].includes(String(scopeFor(user, "attendance.file_for_others"))) ? await orNotFound(listFilablePeople()) : null;
  const hoursSettings = tab === "export" ? await orNotFound(getHoursSettings()) : null;
  const health = tab === "health" ? await orNotFound(getSystemHealth()) : null;
  const batches = tab === "corrections" && approve === "all" ? await orNotFound(listCorrectionBatches()) : null;
  const rules = tab === "rules" ? await orNotFound(listClockRules()) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Attendance</h1>
        <p className="mt-1 text-muted-foreground">The time clock is in the header. ELEVATE is the only source of your hours.</p>
      </div>

      <nav aria-label="Attendance sections" className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/attendance?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn("-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm", t.key === tab ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "mine" ? (
        mine ? (
          <div className="space-y-6">
            {mine.days.some((d) => d.open) ? <AutoRefresh seconds={30} /> : null}
            <section aria-label="My schedule" className="rounded-xl border bg-card p-4">
              {mine.schedule ? (
                <p className="text-sm">
                  <span className="font-semibold">Your schedule:</span> {mine.schedule.days}, {mine.schedule.client} ({mine.schedule.zone}), which is <strong>{mine.schedule.manila}</strong> in Manila.{" "}
                  <span className="text-muted-foreground">
                    Since {formatDateOnly(mine.schedule.effectiveFrom)}. Your times below are in {mine.zone}.{" "}
                    <Link href="/schedules" className="text-primary underline-offset-4 hover:underline">
                      Schedule details
                    </Link>
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">You have no schedule yet, so late, early and extra hours are not tracked. HR sets schedules.</p>
              )}
            </section>
            <section aria-label="This week" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  Week of {formatDateOnly(mine.weekStart)} <span className="text-sm font-normal text-muted-foreground">({mine.zone})</span>
                </h2>
                <div className="flex gap-2">
                  <Link href={`/attendance?week=${addDays(mine.weekStart, -7)}`} className="rounded-lg border px-3 py-1 text-sm hover:bg-secondary/50" aria-label="Previous week">
                    Previous
                  </Link>
                  <Link href={`/attendance?week=${mondayOf(addDays(mine.weekStart, 7))}`} className="rounded-lg border px-3 py-1 text-sm hover:bg-secondary/50" aria-label="Next week">
                    Next
                  </Link>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>First in</TableHead>
                      <TableHead>Last out</TableHead>
                      <TableHead className="text-right">Breaks</TableHead>
                      <TableHead className="text-right">Over break</TableHead>
                      <TableHead className="text-right">Worked</TableHead>
                      <TableHead className="text-right">Extra</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mine.days.map((d) => (
                      <Fragment key={d.date}>
                        <TableRow>
                          <TableCell className="font-medium">
                            {d.weekday}, {formatDateOnly(d.date)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {d.shift ? (
                              <>
                                {d.shift.range}
                                <span className="block text-muted-foreground">
                                  {d.shift.clientRange} {d.shift.zone.split("/").pop()?.replace("_", " ")}
                                </span>
                              </>
                            ) : d.holiday ? (
                              <Badge variant="outline">Holiday</Badge>
                            ) : mine.schedule ? (
                              <span className="text-muted-foreground">Rest day</span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>{d.firstIn ? formatInZone(d.firstIn, mine.zone, "h:mm a") : "-"}</TableCell>
                          <TableCell>{d.open ? <Badge variant="secondary">In progress</Badge> : d.lastOut ? formatInZone(d.lastOut, mine.zone, "h:mm a") : "-"}</TableCell>
                          <TableCell className="text-right">{d.breakMinutes ? formatDuration(d.breakMinutes * MINUTE) : "-"}</TableCell>
                          <TableCell className="text-right">{d.overbreakMinutes ? <Badge variant="destructive">+{d.overbreakMinutes} min</Badge> : "-"}</TableCell>
                          <TableCell className="text-right font-medium">{d.workedMinutes ? formatDuration(d.workedMinutes * MINUTE) : "-"}</TableCell>
                          <TableCell className="text-right">
                            {d.extraMinutes ? (
                              <>
                                <Badge variant={d.approvedExtraMinutes >= d.extraMinutes ? "default" : "secondary"}>+{formatDuration(d.extraMinutes * MINUTE)}</Badge>
                                <span className="block text-xs text-muted-foreground">{d.approvedExtraMinutes > 0 ? `${formatDuration(d.approvedExtraMinutes * MINUTE)} approved` : "not approved"}</span>
                              </>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        </TableRow>
                        {d.sessionList.map((sess, i) => (
                          <TableRow key={`${d.date}-${sess.startAt}`} className="bg-muted/30 text-xs" data-session>
                            <TableCell className="pl-6 text-muted-foreground">Session {i + 1}</TableCell>
                            <TableCell />
                            <TableCell>{formatInZone(sess.startAt, mine.zone, "h:mm a")}</TableCell>
                            <TableCell>{sess.endAt ? formatInZone(sess.endAt, mine.zone, "h:mm a") : <Badge variant="secondary">In progress</Badge>}</TableCell>
                            <TableCell className="text-right">
                              {sess.breaks.length === 0
                                ? "-"
                                : sess.breaks.map((b) => (
                                    <div key={b.startAt}>
                                      {b.minutes}m{b.plannedMinutes ? ` of ${b.plannedMinutes}m` : ""}
                                      {b.overMinutes ? <span className="font-medium text-red-600"> (+{b.overMinutes}m over)</span> : null}
                                    </div>
                                  ))}
                            </TableCell>
                            <TableCell className="text-right">{sess.overbreakMinutes ? `+${sess.overbreakMinutes}m` : "-"}</TableCell>
                            <TableCell className="text-right">{sess.workedMinutes ? formatDuration(sess.workedMinutes * MINUTE) : "-"}</TableCell>
                            <TableCell />
                          </TableRow>
                        ))}
                        {d.sessionList.map((sess) => {
                          const note = sess.eventId ? mine.notes[sess.eventId] : undefined;
                          const canEdit = Boolean(sess.eventId && sess.endAt !== null && mine.serverNowMs - sess.endAt <= mine.noteWindowMs);
                          if (!sess.eventId || (!note && !canEdit)) return null;
                          return (
                            <TableRow key={`note-${sess.eventId}`} className="bg-muted/30">
                              <TableCell colSpan={8} className="pl-6">
                                <ShiftNote sessionId={sess.eventId} initial={note?.body ?? null} edited={note?.edited ?? false} canEdit={canEdit} />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </Fragment>
                    ))}
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right font-semibold">{mine.days.reduce((n, d) => n + d.overbreakMinutes, 0) ? `+${mine.days.reduce((n, d) => n + d.overbreakMinutes, 0)} min` : "-"}</TableCell>
                      <TableCell className="text-right font-semibold">{formatDuration(mine.weekMinutes * MINUTE)}</TableCell>
                      <TableCell className="text-right font-semibold">{mine.days.reduce((n, d) => n + d.extraMinutes, 0) ? `+${formatDuration(mine.days.reduce((n, d) => n + d.extraMinutes, 0) * MINUTE)}` : "-"}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <CorrectionForm zone={mine.zone} />
              <PreferencesForm shareLocation={mine.prefs.shareLocation} timeZone={mine.prefs.timeZone} monitoringPublished={mine.monitoringPublished} />
            </div>

            <section aria-label="My corrections" className="space-y-2">
              <h2 className="text-lg font-semibold">My corrections</h2>
              <CorrectionList items={mine.corrections} zone={mine.zone} mode="mine" empty="You have not asked for any corrections." />
            </section>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground">Your account is not linked to a people record yet, and the time clock needs one.</p>
            {can(user, "people.create") ? <SetupProfileForm /> : <p className="text-sm">Ask HR to add you in People with your sign-in email, and the clock will appear.</p>}
          </div>
        )
      ) : null}

      {queue ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{queue.scope === "team" ? "Corrections from people on your team." : "Every pending correction. HR decides when nobody above the person can."}</p>
          {filable ? <FileForOthersForm people={filable} zone="America/Phoenix" /> : null}
          {batches ? <BulkCorrectionsPanel batches={batches} /> : null}
          <CorrectionList items={queue.items} zone="America/Phoenix" mode="queue" empty="No corrections are waiting." />
        </div>
      ) : null}

      {hoursSettings ? <ExportPanel settings={hoursSettings} /> : null}

      {health ? <HealthPanel health={health} /> : null}

      {rules ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Rules apply per team. A team with no rules has no IP restriction and the default idle prompt. Selfies and location need the monitoring policy to be published{rules.monitoringPublished ? " (it is)" : " (it is not yet)"}.
          </p>
          {rules.rows.length === 0 ? <p className="text-muted-foreground">There are no teams yet.</p> : null}
          {rules.rows.map((r) => (
            <RulesForm key={r.teamId} row={r} monitoringPublished={rules.monitoringPublished} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
