import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { formatDuration, MINUTE } from "../clock";
import { mondayOf, type MyTime } from "../queries";
import { ShiftNote } from "./attendance-forms";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dur = (minutes: number) => formatDuration(minutes * MINUTE);

type Day = MyTime["days"][number];

function SummaryCard({ label, children, className, ...props }: { label: string; children: ReactNode; className?: string } & React.ComponentProps<"section">) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-sm animate-in fade-in-0 duration-300 motion-reduce:animate-none", className)} {...props}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t py-2 text-sm first:mt-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

/** Today (when the shown week holds today), the week so far, and the schedule, side by side. */
function Summary({ mine }: { mine: MyTime }) {
  const today = formatInZone(mine.serverNowMs, mine.zone, "yyyy-MM-dd");
  const day = mine.days.find((d) => d.date === today);
  const scheduled = mine.days.reduce((n, d) => n + (d.scheduledMinutes ?? 0), 0);
  const extra = mine.days.reduce((n, d) => n + d.extraMinutes, 0);
  const over = mine.days.reduce((n, d) => n + d.overbreakMinutes, 0);
  const daysWorked = mine.days.filter((d) => d.workedMinutes > 0 || d.open).length;
  const openSession = day?.sessionList.find((s) => s.endAt === null);
  return (
    <div className={cn("grid gap-4", day ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
      {day ? (
        <SummaryCard label={`Today · ${day.weekday}, ${formatDateOnly(day.date)}`} aria-label="Today">
          <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{dur(day.workedMinutes)}</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium">
            {day.open ? (
              <>
                <span className="size-2.5 rounded-full bg-success" aria-hidden />
                {openSession ? `Working since ${formatInZone(openSession.startAt, mine.zone, "h:mm a")}` : "Working"}
              </>
            ) : day.workedMinutes > 0 ? (
              "Clocked out for now"
            ) : (
              <span className="font-normal text-muted-foreground">Not clocked in yet</span>
            )}
          </p>
          <Fact label="Breaks">{day.breakMinutes ? dur(day.breakMinutes) : "None"}</Fact>
          <Fact label="Shift">{day.shift ? day.shift.range : day.holiday ? "Holiday" : mine.schedule ? "Rest day" : "No schedule"}</Fact>
        </SummaryCard>
      ) : null}
      <SummaryCard label="Week so far" aria-label="Week summary">
        <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{dur(mine.weekMinutes)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{scheduled > 0 ? `of ${dur(scheduled)} scheduled` : `${daysWorked} ${daysWorked === 1 ? "day" : "days"} worked`}</p>
        {scheduled > 0 ? (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round((mine.weekMinutes / scheduled) * 100))}%` }} />
          </div>
        ) : null}
        <Fact label="Extra hours">{extra ? `+${dur(extra)}` : "None"}</Fact>
        <Fact label="Over break">{over ? <span className="text-warning">+{over} min</span> : "None"}</Fact>
      </SummaryCard>
      <section aria-label="My schedule" className="rounded-2xl border bg-card p-5 shadow-sm animate-in fade-in-0 duration-300 motion-reduce:animate-none">
        <p className="text-xs font-medium text-muted-foreground">Your schedule</p>
        {mine.schedule ? (
          <>
            <p className="mt-1 text-sm font-semibold">
              {mine.schedule.days}, {mine.schedule.client} ({mine.schedule.zone})
            </p>
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">{mine.schedule.manila}</strong> in Manila
            </p>
            <Fact label="Since">{formatDateOnly(mine.schedule.effectiveFrom)}</Fact>
            <Fact label="Times shown in">{mine.zone}</Fact>
            <p className="border-t pt-2 text-right text-sm">
              <Link href="/schedules" className="text-primary underline-offset-4 hover:underline">
                Schedule details
              </Link>
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">You have no schedule yet, so late, early and extra hours are not tracked. HR sets schedules.</p>
        )}
      </section>
    </div>
  );
}

function DayFlags({ d }: { d: Day }) {
  const flags: ReactNode[] = [];
  if (d.overbreakMinutes) flags.push(<Badge key="ob" variant="warning">+{d.overbreakMinutes} min over break</Badge>);
  if (d.extraMinutes)
    flags.push(
      <Badge key="ex" variant={d.approvedExtraMinutes >= d.extraMinutes ? "success" : "info"}>
        +{dur(d.extraMinutes)} extra{d.approvedExtraMinutes >= d.extraMinutes ? " (approved)" : d.approvedExtraMinutes > 0 ? ` (${dur(d.approvedExtraMinutes)} approved)` : " (not approved)"}
      </Badge>,
    );
  return flags.length > 0 ? <span className="flex flex-wrap justify-end gap-1">{flags}</span> : null;
}

/** One day of the week: the row (shift, bar, in, out, worked, flags) and, for a day with clock sessions, each session with its breaks and note. */
function DayRow({ d, mine, isToday }: { d: Day; mine: MyTime; isToday: boolean }) {
  const hasSessions = d.sessionList.length > 0;
  const quiet = !hasSessions && !d.open;
  const full = d.scheduledMinutes ?? 480;
  const pct = Math.min(100, Math.round((d.workedMinutes / Math.max(full, 1)) * 100));
  const shift = d.shift ? (
    <>
      {d.shift.range}
      <span className="text-muted-foreground"> · {d.shift.clientRange} {d.shift.zone.split("/").pop()?.replace("_", " ")}</span>
    </>
  ) : d.holiday ? (
    <Badge variant="outline">Holiday</Badge>
  ) : mine.schedule ? (
    "Rest day"
  ) : null;
  const inTime = d.firstIn ? formatInZone(d.firstIn, mine.zone, "h:mm a") : "—";
  const outTime = d.open ? null : d.lastOut ? formatInZone(d.lastOut, mine.zone, "h:mm a") : "—";
  const row = (
    <div className={cn("grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 md:grid-cols-[13rem_1fr_6rem_6rem_12rem]", quiet && "text-muted-foreground")}>
      <div>
        <p className={cn("text-sm font-medium", !quiet && "text-foreground")}>
          {d.weekday}, {formatDateOnly(d.date)}
          {isToday ? <Badge variant="secondary" className="ml-2">Today</Badge> : null}
        </p>
        {shift ? <p className="text-xs text-muted-foreground">{shift}</p> : null}
      </div>
      <div className="hidden md:block" aria-hidden>
        {!quiet ? (
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>
      <p className="hidden text-sm md:block">{inTime}</p>
      <p className="hidden text-sm md:block">{d.open ? <Badge variant="secondary">In progress</Badge> : outTime}</p>
      <div className="space-y-1 text-right">
        <p className={cn("text-sm", d.workedMinutes ? "font-semibold text-foreground" : "")}>{d.workedMinutes ? dur(d.workedMinutes) : "—"}</p>
        <DayFlags d={d} />
      </div>
      <p className="col-span-2 text-xs text-muted-foreground md:hidden">
        {quiet ? null : (
          <>
            {inTime} to {d.open ? "now" : outTime}
            {d.open ? <Badge variant="secondary" className="ml-2">In progress</Badge> : null}
          </>
        )}
      </p>
    </div>
  );
  if (!hasSessions) return row;
  // A day with a note, or one where the note can still be written, opens by itself so nothing the person may want to do is hidden.
  const sessionsWithNotes = d.sessionList.filter((s) => s.eventId && (mine.notes[s.eventId] || (s.endAt !== null && mine.serverNowMs - s.endAt <= mine.noteWindowMs)));
  return (
    <details className="group" open={isToday || sessionsWithNotes.length > 0}>
      <summary className="cursor-pointer list-none outline-none transition-colors hover:bg-secondary/40 focus-visible:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">{row}</summary>
      <ul className="space-y-3 border-t border-dashed bg-muted/30 px-5 py-3 text-sm">
        {d.sessionList.map((sess, i) => {
          const note = sess.eventId ? mine.notes[sess.eventId] : undefined;
          const canEdit = Boolean(sess.eventId && sess.endAt !== null && mine.serverNowMs - sess.endAt <= mine.noteWindowMs);
          return (
            <Fragment key={`${d.date}-${sess.startAt}`}>
              <li data-session className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="w-20 text-muted-foreground">Session {i + 1}</span>
                <span>
                  {formatInZone(sess.startAt, mine.zone, "h:mm a")} to {sess.endAt ? formatInZone(sess.endAt, mine.zone, "h:mm a") : <Badge variant="secondary">In progress</Badge>}
                </span>
                <span className="text-muted-foreground">
                  {sess.breaks.length === 0
                    ? "No breaks"
                    : sess.breaks.map((b, n) => (
                        <span key={b.startAt}>
                          {n > 0 ? ", " : ""}
                          {b.minutes}m{b.plannedMinutes ? ` of ${b.plannedMinutes}m` : ""}
                          {b.overMinutes ? <span className="font-medium text-warning"> (+{b.overMinutes}m over)</span> : null}
                        </span>
                      ))}
                </span>
                <span className="ml-auto font-medium">{sess.workedMinutes ? dur(sess.workedMinutes) : "—"}</span>
              </li>
              {sess.eventId && (note || canEdit) ? (
                <li className="pl-0 sm:pl-[6.5rem]">
                  <ShiftNote sessionId={sess.eventId} initial={note?.body ?? null} edited={note?.edited ?? false} canEdit={canEdit} />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ul>
    </details>
  );
}

/** The week: previous / this week / next, then a list of the seven days. */
export function WeekList({ mine }: { mine: MyTime }) {
  const today = formatInZone(mine.serverNowMs, mine.zone, "yyyy-MM-dd");
  const thisWeek = mondayOf(today);
  const link = "px-3.5 py-1.5 text-sm font-medium outline-none transition-colors hover:bg-secondary/60 focus-visible:bg-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const overall = mine.days.reduce((n, d) => n + d.extraMinutes, 0);
  const over = mine.days.reduce((n, d) => n + d.overbreakMinutes, 0);
  return (
    <section aria-label="This week" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Week of {formatDateOnly(mine.weekStart)} <span className="text-sm font-normal text-muted-foreground">({mine.zone})</span>
        </h2>
        <div className="inline-flex divide-x overflow-clip rounded-lg border bg-card">
          <Link href={`/attendance?week=${addDays(mine.weekStart, -7)}`} className={link} aria-label="Previous week">
            Previous
          </Link>
          {mine.weekStart !== thisWeek ? (
            <Link href="/attendance" className={link}>
              This week
            </Link>
          ) : null}
          <Link href={`/attendance?week=${mondayOf(addDays(mine.weekStart, 7))}`} className={link} aria-label="Next week">
            Next
          </Link>
        </div>
      </div>
      <div className="overflow-clip rounded-2xl border bg-card shadow-sm">
        <div className="hidden grid-cols-[13rem_1fr_6rem_6rem_12rem] gap-x-4 border-b bg-secondary/40 px-5 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:grid" role="presentation">
          <span>Day</span>
          <span />
          <span>First in</span>
          <span>Last out</span>
          <span className="text-right">Worked</span>
        </div>
        <ul className="divide-y">
          {mine.days.map((d) => (
            <li key={d.date} data-day={d.date} className={cn(d.date === today && "bg-primary/5")}>
              <DayRow d={d} mine={mine} isToday={d.date === today} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t bg-secondary/40 px-5 py-3 text-sm">
          <span className="font-semibold">Total</span>
          <span className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-muted-foreground">
            {over ? <span>Over break +{over} min</span> : null}
            {overall ? <span>Extra +{dur(overall)}</span> : null}
            <span className="font-semibold text-foreground">{dur(mine.weekMinutes)}</span>
          </span>
        </div>
      </div>
    </section>
  );
}

export function MyTimeOverview({ mine }: { mine: MyTime }) {
  return (
    <div className="space-y-6">
      <Summary mine={mine} />
      <WeekList mine={mine} />
    </div>
  );
}
