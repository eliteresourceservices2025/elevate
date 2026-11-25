"use client";

import Link from "next/link";
import { useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateOnly } from "@/lib/time";
import type { PersonSchedule } from "../queries";
import { addDays, WEEKDAYS } from "../schedule";
import type { ScheduleEntry, WeekViewDay } from "../schedule-view";
import { AddScheduleForm, ChangeScheduleForm, RemoveScheduleForm } from "./schedule-forms";

type Action = { kind: "choose" | "edit" | "replace" | "remove"; entry: ScheduleEntry };

const weekdayShort = (n: number) => WEEKDAYS.find((w) => w.n === n)?.short ?? "";
const dayLabel = (d: WeekViewDay) => `${weekdayShort(d.weekday)} ${Number(d.date.slice(8))}`;
const titles = { choose: "Change this schedule", edit: "Correct this schedule", replace: "Replace this schedule", remove: "Remove this schedule" };

/**
 * A person's week: a grid on a wide screen and one row per day on a narrow one, then every current and upcoming entry and the earlier ones.
 * HR changes an entry from its block or its row. `basePath` is where the previous and next week links go.
 */
export function PersonScheduleView({ data, basePath }: { data: PersonSchedule; basePath: string }) {
  const [action, setAction] = useState<Action | null>(null);
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  const live = data.entries.filter((e) => e.status !== "past");
  const past = data.entries.filter((e) => e.status === "past").reverse().slice(0, 10);
  const done = () => setAction(null);
  const open = (kind: Action["kind"], id: string) => {
    const entry = byId.get(id);
    if (entry) setAction({ kind, entry });
  };
  const buttons = (entry: ScheduleEntry) =>
    data.canManage ? (
      <div className="flex flex-wrap gap-1">
        {entry.canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAction({ kind: "edit", entry })}>
            Edit
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={() => setAction({ kind: "replace", entry })}>
          Replace
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAction({ kind: "remove", entry })}>
          Remove
        </Button>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${basePath}?week=${addDays(data.weekStart, -7)}`} scroll={false} />}>
            Previous week
          </Button>
          <p className="font-medium">Week of {formatDateOnly(data.weekStart)}</p>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${basePath}?week=${addDays(data.weekStart, 7)}`} scroll={false} />}>
            Next week
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Days and shift times are in each schedule&apos;s time zone.</p>
      </div>

      <ol aria-label="Week" className="hidden grid-cols-7 gap-1.5 lg:grid">
        {data.week.map((day) => (
          <li key={day.date} className="min-h-28 space-y-1.5 rounded-lg border bg-card p-2">
            <p className="text-xs font-medium">
              {dayLabel(day)}
              {day.date === data.today ? <Badge variant="secondary" className="ml-1">Today</Badge> : null}
            </p>
            {day.shifts.length === 0 ? <p className="text-xs text-muted-foreground">Rest</p> : null}
            {day.shifts.map((s) => {
              const body = (
                <>
                  <span className="block font-medium">{s.clientName ?? "No client"}</span>
                  <span className="block">{s.clientRange}</span>
                  <span className="block text-muted-foreground">Manila {s.manilaRange}</span>
                </>
              );
              const box = "block w-full rounded-md border-l-2 border-primary bg-muted/50 p-1.5 text-left text-xs";
              return data.canManage ? (
                <button key={s.entryId} type="button" className={`${box} hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring`} onClick={() => open("choose", s.entryId)}>
                  {body}
                </button>
              ) : (
                <div key={s.entryId} className={box}>
                  {body}
                </div>
              );
            })}
          </li>
        ))}
      </ol>

      <ol aria-label="Week by day" className="divide-y rounded-xl border bg-card lg:hidden">
        {data.week.map((day) => (
          <li key={day.date} className="space-y-2 p-3">
            <p className="text-sm font-medium">
              {dayLabel(day)}
              {day.date === data.today ? <Badge variant="secondary" className="ml-2">Today</Badge> : null}
            </p>
            {day.shifts.length === 0 ? <p className="text-sm text-muted-foreground">Rest</p> : null}
            {day.shifts.map((s) => {
              const entry = byId.get(s.entryId);
              return (
                <div key={s.entryId} className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">{s.clientName ?? "No client"}</span> {s.clientRange}
                    {entry ? <span className="text-muted-foreground"> {entry.zone}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Manila {s.manilaRange}
                    {entry?.allottedMinutes ? ` · ${entry.allottedMinutes / 60} h for the client` : ""}
                    {entry ? ` · ${entry.breakMinutes} min break` : ""}
                  </p>
                  {entry ? buttons(entry) : null}
                </div>
              );
            })}
          </li>
        ))}
      </ol>

      <section aria-label="Current and upcoming schedules" className="space-y-2">
        <h3 className="text-base font-semibold">Current and upcoming</h3>
        {live.length === 0 ? <p className="text-sm text-muted-foreground">No schedule yet, so late, early and extra hours are not tracked.</p> : null}
        <ul className="space-y-2">
          {live.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm">
              <div>
                <p>
                  <span className="font-medium">{e.clientName ?? "No client"}</span> · {e.days}, {e.clientRange} ({e.zone})
                  {e.status === "upcoming" ? <Badge variant="info" className="ml-2">Upcoming</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Manila {e.manilaRange} · from {formatDateOnly(e.from)}
                  {e.to ? ` to ${formatDateOnly(e.to)}` : ""} · {e.breakMinutes} min break
                  {e.allottedMinutes ? ` · ${e.allottedMinutes / 60} h a day for the client` : ""}
                </p>
              </div>
              {buttons(e)}
            </li>
          ))}
        </ul>
        {past.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Earlier schedules ({past.length})</summary>
            <ul className="mt-2 space-y-1">
              {past.map((e) => (
                <li key={e.id} className="text-muted-foreground">
                  {e.clientName ?? "No client"} · {e.days}, {e.clientRange} ({e.zone}), {formatDateOnly(e.from)} to {e.to ? formatDateOnly(e.to) : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {action ? (
        <FormDialog key={`${action.kind}-${action.entry.id}`} label={titles[action.kind]} title={titles[action.kind]} size="lg" open onOpenChange={(o) => !o && done()} hideTrigger>
          {action.kind === "choose" ? (
            <div className="space-y-3">
              <p className="text-sm">
                {action.entry.clientName ?? "No client"} · {action.entry.days}, {action.entry.clientRange} ({action.entry.zone})
              </p>
              {buttons(action.entry)}
            </div>
          ) : action.kind === "remove" ? (
            <RemoveScheduleForm entry={action.entry} today={data.today} clockedIn={data.clockedIn} onDone={done} />
          ) : (
            <ChangeScheduleForm kind={action.kind} entry={action.entry} today={data.today} clients={data.clients} clockedIn={data.clockedIn} onDone={done} />
          )}
        </FormDialog>
      ) : null}
    </div>
  );
}

/** The header button on a person's page. */
export function AddScheduleButton({ data }: { data: PersonSchedule }) {
  return (
    <FormDialog label="Add schedule" title={`Add a schedule for ${data.name}`} description="Shift times and days are in the schedule's time zone." size="xl">
      <AddScheduleForm people={[data.employeeId]} today={data.today} clients={data.clients} clockedIn={data.clockedIn} />
    </FormDialog>
  );
}
