import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CalendarView } from "../request-queries";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAME = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

function shiftMonth(month: string, by: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * Month of who is off (Monday first). From the tablet width it is a grid; on a phone, where seven columns leave no room for a name,
 * it is an agenda: one row per day that has anything on it. What each person may see depends on the mode chosen by the query.
 */
export function CalendarMonth({ view, today }: { view: CalendarView; today: string }) {
  const firstDate = view.dates[0];
  const offset = (new Date(`${firstDate}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const cells: (string | null)[] = [...Array<null>(offset).fill(null), ...view.dates];
  while (cells.length % 7 !== 0) cells.push(null);

  const offOn = (date: string) => view.entries.filter((e) => e.startDate <= date && e.endDate >= date);
  const holidaysOn = (date: string) => view.holidays.filter((h) => h.date === date);
  const countOn = (date: string) => view.counts[date] ?? 0; // eslint-disable-line security/detect-object-injection -- date comes from the view's own list
  const busy = view.dates.filter((d) => offOn(d).length > 0 || holidaysOn(d).length > 0 || countOn(d) > 0);
  const thisMonth = today.slice(0, 7);
  const nav = "px-3.5 py-1.5 text-sm font-medium outline-none transition-colors hover:bg-secondary/60 focus-visible:bg-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{MONTH_NAME.format(new Date(`${firstDate}T00:00:00Z`))}</h2>
        <div className="inline-flex divide-x overflow-clip rounded-lg border bg-card">
          <Link href={`/time-off?tab=calendar&month=${shiftMonth(view.month, -1)}`} className={nav} aria-label="Previous month">
            Previous
          </Link>
          {view.month !== thisMonth ? (
            <Link href="/time-off?tab=calendar" className={nav}>
              Today
            </Link>
          ) : null}
          <Link href={`/time-off?tab=calendar&month=${shiftMonth(view.month, 1)}`} className={nav} aria-label="Next month">
            Next
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          {view.mode === "all" ? "Everyone." : null}
          {view.mode === "team" ? "You and your team." : null}
          {view.mode === "peers" ? "You and your teammates." : null}
          {view.mode === "counts" ? "How many people are off each day." : null}
        </span>
        {view.mode === "all" || view.mode === "team" ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-sm bg-primary/30" aria-hidden /> Approved
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-sm border border-dashed border-primary" aria-hidden /> Pending
            </span>
          </>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2.5 rounded-sm bg-warning-surface ring-1 ring-warning/40" aria-hidden /> Holiday
        </span>
      </div>

      {/* Phone: an agenda of the days that have something on them. */}
      <div className="overflow-clip rounded-2xl border bg-card shadow-sm md:hidden">
        {busy.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nobody is off and there are no holidays this month.</p>
        ) : (
          <ul className="divide-y">
            {busy.map((date) => {
              const off = offOn(date);
              const holidays = holidaysOn(date);
              const count = countOn(date);
              return (
                <li key={date} className={cn("flex gap-4 px-4 py-3.5", date === today && "bg-primary/5")}>
                  <div className="w-11 shrink-0 text-center">
                    <p className="font-heading text-2xl leading-none font-bold">{Number(date.slice(8))}</p>
                    <p className="mt-0.5 text-[0.7rem] font-medium text-muted-foreground uppercase">{WEEKDAY.format(new Date(`${date}T00:00:00Z`))}</p>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    {holidays.map((h) => (
                      <p key={h.calendar + h.name}>
                        <Badge variant="warning">Holiday</Badge> <span className="ml-1">{h.name}</span>
                      </p>
                    ))}
                    {view.mode === "counts" && count > 0 ? <Badge variant="secondary">{count} off</Badge> : null}
                    {off.map((e) => (
                      <p key={e.employeeId + e.startDate}>
                        <span className="font-medium">{e.name}</span>
                        {e.leaveType ? <span className="text-muted-foreground"> · {e.leaveType}</span> : null}
                        {e.pending ? <Badge variant="outline" className="ml-2">Pending</Badge> : null}
                      </p>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Tablet and up: the month grid. */}
      <div role="grid" aria-label="Time off calendar" className="hidden grid-cols-7 overflow-clip rounded-2xl border bg-card text-sm shadow-sm md:grid">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="border-b bg-secondary/40 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {d}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} className="min-h-28 border-r border-b bg-muted/20" />;
          const off = offOn(date);
          const holidays = holidaysOn(date);
          const count = countOn(date);
          const weekend = i % 7 >= 5;
          const isToday = date === today;
          return (
            <div key={date} role="gridcell" className={cn("min-h-28 space-y-1 border-r border-b p-2", weekend && "bg-secondary/20")}>
              <div className={cn("text-xs text-muted-foreground", isToday && "inline-grid size-6 place-items-center rounded-full bg-primary font-semibold text-primary-foreground")}>{Number(date.slice(8))}</div>
              {holidays.map((h) => (
                <div key={h.calendar + h.name} className="truncate rounded-md bg-warning-surface px-1.5 py-0.5 text-xs text-warning" title={h.name}>
                  {h.name}
                </div>
              ))}
              {view.mode === "counts" && count > 0 ? <Badge variant="secondary">{count} off</Badge> : null}
              {off.slice(0, 3).map((e) => (
                <div key={e.employeeId + e.startDate} className={cn("truncate rounded-md px-1.5 py-0.5 text-xs", e.pending ? "border border-dashed border-primary/60 text-muted-foreground" : "bg-primary/15 text-foreground")} title={`${e.name}${e.leaveType ? ` · ${e.leaveType}` : ""}${e.pending ? " (pending)" : ""}`}>
                  {e.name}
                  {e.leaveType ? <span className="text-muted-foreground"> · {e.leaveType}</span> : null}
                </div>
              ))}
              {off.length > 3 ? <div className="text-xs text-muted-foreground">+{off.length - 3} more</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
