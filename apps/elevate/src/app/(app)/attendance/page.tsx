import type { Metadata } from "next";
import Link from "next/link";
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
import { JibblePanel } from "@/modules/jibble/components/jibble-panel";
import { getJibbleOverview } from "@/modules/jibble/queries";
import { getMyTime, listClockRules, listCorrectionQueue, listFilablePeople, listFlags, listShiftNotes, listWorkingNow, mondayOf } from "@/modules/attendance/queries";

export const metadata: Metadata = { title: "Attendance" };

const ALL_TABS = [
  { key: "mine", label: "My time" },
  { key: "team", label: "Team" },
  { key: "corrections", label: "Corrections" },
  { key: "rules", label: "Rules" },
  { key: "jibble", label: "Jibble" },
] as const;

const FLAG_LABELS = new Map<string, string>(Object.entries({
  open_session: "Still clocked in",
  outside_range: "Outside allowed IP range",
  corrected: "Corrected",
  idle_unanswered: "Idle prompt unanswered",
  overbreak: "Overbreak",
  no_eod: "No end-of-day report",
  jibble_mismatch: "Jibble and ELEVATE totals differ",
  on_leave: "On approved leave",
}));

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requireUser();
  const params = await searchParams;
  const allowed = new Set<string>(["mine"]);
  const view = scopeFor(user, "attendance.view");
  if (view === "all" || view === "team") allowed.add("team");
  const approve = scopeFor(user, "attendance.approve_correction");
  if (approve === "all" || approve === "team") allowed.add("corrections");
  if (scopeFor(user, "attendance.manage_rules")) allowed.add("rules");
  if (scopeFor(user, "jibble.manage")) allowed.add("jibble");
  const tabs = ALL_TABS.filter((t) => allowed.has(t.key));
  const tab = tabs.find((t) => t.key === params.tab)?.key ?? "mine";

  const mine = tab === "mine" ? await orNotFound(getMyTime(typeof params.week === "string" ? params.week : undefined)) : null;
  const working = tab === "team" ? await orNotFound(listWorkingNow()) : null;
  const flags = tab === "team" ? await orNotFound(listFlags()) : null;
  const queue = tab === "corrections" ? await orNotFound(listCorrectionQueue()) : null;
  const notes = tab === "team" ? await orNotFound(listShiftNotes()) : null;
  const filable = tab === "corrections" && ["all", "team"].includes(String(scopeFor(user, "attendance.file_for_others"))) ? await orNotFound(listFilablePeople()) : null;
  const jibble = tab === "jibble" ? await orNotFound(getJibbleOverview()) : null;
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
                      <TableHead>First in</TableHead>
                      <TableHead>Last out</TableHead>
                      <TableHead className="text-right">Breaks</TableHead>
                      <TableHead className="text-right">Over break</TableHead>
                      <TableHead className="text-right">Worked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mine.days.map((d) => (
                      <Fragment key={d.date}>
                        <TableRow>
                          <TableCell className="font-medium">
                            {d.weekday}, {formatDateOnly(d.date)}
                          </TableCell>
                          <TableCell>{d.firstIn ? formatInZone(d.firstIn, mine.zone, "h:mm a") : "-"}</TableCell>
                          <TableCell>{d.open ? <Badge variant="secondary">In progress</Badge> : d.lastOut ? formatInZone(d.lastOut, mine.zone, "h:mm a") : "-"}</TableCell>
                          <TableCell className="text-right">{d.breakMinutes ? formatDuration(d.breakMinutes * MINUTE) : "-"}</TableCell>
                          <TableCell className="text-right">{d.overbreakMinutes ? <Badge variant="destructive">+{d.overbreakMinutes} min</Badge> : "-"}</TableCell>
                          <TableCell className="text-right font-medium">{d.workedMinutes ? formatDuration(d.workedMinutes * MINUTE) : "-"}</TableCell>
                        </TableRow>
                        {d.sessionList.map((sess, i) => (
                          <TableRow key={`${d.date}-${sess.startAt}`} className="bg-muted/30 text-xs" data-session>
                            <TableCell className="pl-6 text-muted-foreground">Session {i + 1}</TableCell>
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
                          </TableRow>
                        ))}
                        {d.sessionList.map((sess) => {
                          const note = sess.eventId ? mine.notes[sess.eventId] : undefined;
                          const canEdit = Boolean(sess.eventId && sess.endAt !== null && mine.serverNowMs - sess.endAt <= mine.noteWindowMs);
                          if (!sess.eventId || (!note && !canEdit)) return null;
                          return (
                            <TableRow key={`note-${sess.eventId}`} className="bg-muted/30">
                              <TableCell colSpan={6} className="pl-6">
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
                      <TableCell className="text-right font-semibold">{mine.days.reduce((n, d) => n + d.overbreakMinutes, 0) ? `+${mine.days.reduce((n, d) => n + d.overbreakMinutes, 0)} min` : "-"}</TableCell>
                      <TableCell className="text-right font-semibold">{formatDuration(mine.weekMinutes * MINUTE)}</TableCell>
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

      {working && flags ? (
        <div className="space-y-8">
          <section aria-label="Working now" className="space-y-2">
            <h2 className="text-lg font-semibold">Working now</h2>
            {working.rows.length === 0 ? (
              <p className="text-muted-foreground">Nobody is clocked in right now.</p>
            ) : (
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
                    {working.rows.map((r) => (
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
            )}
          </section>

          <section aria-label="Flags" className="space-y-2">
            <h2 className="text-lg font-semibold">Flags in the last two weeks</h2>
            <p className="text-sm text-muted-foreground">Rebuilt every night from the clock events. Late, overtime and absence flags arrive with schedules.</p>
            {flags.rows.length === 0 ? (
              <p className="text-muted-foreground">Nothing to look at.</p>
            ) : (
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
                    {flags.rows.map((r) => (
                      <TableRow key={`${r.employeeId}-${r.date}`}>
                        <TableCell>{formatDateOnly(r.date)}</TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="space-x-1">
                          {r.flags.map((f) => (
                            <Badge key={f} variant="outline">
                              {f === "overbreak" && r.overbreakMinutes ? `Overbreak +${r.overbreakMinutes} min` : (FLAG_LABELS.get(f) ?? f)}
                            </Badge>
                          ))}
                        </TableCell>
                        <TableCell className="text-right">{formatDuration(r.workedMinutes * MINUTE)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
          <section aria-label="End-of-day reports" className="space-y-2">
            <h2 className="text-lg font-semibold">End-of-day reports, last 7 days</h2>
            {!notes || notes.rows.length === 0 ? (
              <p className="text-muted-foreground">No reports yet.</p>
            ) : (
              <ul className="space-y-3">
                {notes.rows.map((n) => (
                  <li key={n.id} className="space-y-1 rounded-xl border bg-card p-4">
                    <p className="text-sm font-semibold">
                      {n.name} <span className="font-normal text-muted-foreground">{formatInZone(n.sessionStartMs, undefined, "EEE MMM d, h:mm a")}</span>
                      {n.edited ? <span className="ml-1 text-xs font-normal text-muted-foreground">(edited)</span> : null}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {queue ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{queue.scope === "team" ? "Corrections from people on your team." : "Every pending correction. HR decides when nobody above the person can."}</p>
          {filable ? <FileForOthersForm people={filable} zone="America/Phoenix" /> : null}
          <CorrectionList items={queue.items} zone="America/Phoenix" mode="queue" empty="No corrections are waiting." />
        </div>
      ) : null}

      {jibble ? <JibblePanel overview={jibble} /> : null}

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
