import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock, FileCheck, GraduationCap, ListChecks, Target } from "lucide-react";
import { getMyHours, getMyScheduleTile, getMyTodo, type TodoItem } from "../my-queries";
import { hoursLabel, RowMeta, Tile, TileList, TileNote, TileRow } from "./bento";
import { guarded } from "./guard";

const STATE_LABEL = { out: "Clocked out", working: "Clocked in", break: "On break" } as const;

/** This week's hours from the ELEVATE clock, against the schedule, and last week's approval. */
export async function HoursTile() {
  return guarded("My hours", async () => {
    const h = await getMyHours();
    if (!h) return null;
    const pct = h.scheduledMinutes ? Math.min(100, Math.round((h.weekMinutes / h.scheduledMinutes) * 100)) : null;
    return (
      <Tile label="My hours this week" title="Hours this week" icon={<Clock className="size-4 text-primary" aria-hidden />} href="/attendance" hrefLabel="Time clock">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{hoursLabel(h.weekMinutes)}</span>
          {h.scheduledMinutes ? <span className="text-xs text-muted-foreground">of {hoursLabel(h.scheduledMinutes)} scheduled</span> : null}
        </div>
        {pct !== null ? (
          <div role="progressbar" aria-label="Hours worked this week" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="my-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <p className="mt-auto text-xs text-muted-foreground">
          {STATE_LABEL[h.state]}
          {h.lastWeek ? ` · Last week ${hoursLabel(h.lastWeek.workedMinutes)}, ${h.lastWeek.approved ? "approved" : "waiting for approval"}` : ""}
        </p>
      </Tile>
    );
  });
}

/** Today and the next two days, in the person's own zone. */
export async function ScheduleTile() {
  return guarded("My schedule", async () => {
    const s = await getMyScheduleTile();
    return (
      <Tile label="My schedule" title="Schedule" icon={<CalendarClock className="size-4 text-primary" aria-hidden />} href="/schedules" hrefLabel="Full schedule">
        {!s ? (
          <TileNote>No schedule yet. Your lead or HR sets it.</TileNote>
        ) : (
          <>
            <TileList>
              {s.days.map((d) => (
                <TileRow key={d.date}>
                  <span className={d.today ? "w-12 shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-center text-xs font-medium text-accent-foreground" : "w-12 shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-center text-xs text-secondary-foreground"}>{d.label}</span>
                  <span className={d.range ? "truncate" : "text-muted-foreground"}>{d.range ?? (d.holiday ? "Holiday" : "Day off")}</span>
                </TileRow>
              ))}
            </TileList>
            {s.client ? (
              <p className="mt-auto pt-1.5 text-xs text-muted-foreground">
                {s.client}
                {s.clientRange && s.clientZone ? ` · ${s.clientRange} ${s.clientZone.split("/").pop()?.replace("_", " ")}` : ""}
              </p>
            ) : null}
          </>
        )}
      </Tile>
    );
  });
}

const KIND_ICON: Record<TodoItem["kind"], typeof Target> = { training: GraduationCap, goal: Target, policy: FileCheck, task: ListChecks };

/** Training, goals, policies and reviews waiting for the person, in one short list. */
export async function TodoTile() {
  return guarded("My to-do", async () => {
    const { items, total } = await getMyTodo();
    return (
      <Tile label="My to-do" title="To-do" icon={<ListChecks className="size-4 text-primary" aria-hidden />}>
        {items.length === 0 ? (
          <TileNote icon={<CheckCircle2 className="size-4 text-success" aria-hidden />}>You are all caught up.</TileNote>
        ) : (
          <div tabIndex={items.length > 4 ? 0 : undefined} aria-label={items.length > 4 ? "Everything waiting for you (scrolls)" : undefined} className="max-h-40 overflow-y-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <TileList>
            {items.map((t) => {
              const Icon = KIND_ICON[t.kind];
              return (
                <TileRow key={t.id}>
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <Link href={t.href} className="min-w-0 flex-1 truncate rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                    {t.title}
                  </Link>
                  {t.detail ? <RowMeta className={t.overdue ? "text-destructive" : undefined}>{t.detail}</RowMeta> : null}
                </TileRow>
              );
            })}
          </TileList>
          </div>
        )}
        {total > items.length ? <p className="mt-auto pt-1.5 text-xs text-muted-foreground">+ {total - items.length} more</p> : null}
      </Tile>
    );
  });
}
