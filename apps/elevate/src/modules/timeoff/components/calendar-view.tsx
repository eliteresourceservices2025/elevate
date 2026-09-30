import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CalendarView } from "../request-queries";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAME = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function shiftMonth(month: string, by: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Month grid (Monday first) of who is off. What each person may see depends on the mode chosen by the query. */
export function CalendarMonth({ view, today }: { view: CalendarView; today: string }) {
  const firstDate = view.dates[0];
  const offset = (new Date(`${firstDate}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const cells: (string | null)[] = [...Array<null>(offset).fill(null), ...view.dates];
  while (cells.length % 7 !== 0) cells.push(null);

  const offOn = (date: string) => view.entries.filter((e) => e.startDate <= date && e.endDate >= date);
  const holidaysOn = (date: string) => view.holidays.filter((h) => h.date === date);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Link href={`/time-off?tab=calendar&month=${shiftMonth(view.month, -1)}`} className="rounded-lg border px-3 py-1 text-sm hover:bg-secondary/50" aria-label="Previous month">
          Previous
        </Link>
        <h2 className="text-lg font-semibold">{MONTH_NAME.format(new Date(`${firstDate}T00:00:00Z`))}</h2>
        <Link href={`/time-off?tab=calendar&month=${shiftMonth(view.month, 1)}`} className="rounded-lg border px-3 py-1 text-sm hover:bg-secondary/50" aria-label="Next month">
          Next
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        {view.mode === "all" ? "Everyone. Pending requests are shown lighter." : null}
        {view.mode === "team" ? "You and your team. Pending requests are shown lighter." : null}
        {view.mode === "peers" ? "You and your teammates." : null}
        {view.mode === "counts" ? "How many people are off each day." : null}
      </p>

      <div role="grid" aria-label="Time off calendar" className="grid grid-cols-7 overflow-hidden rounded-xl border bg-card text-sm">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="border-b bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} className="min-h-24 border-b border-r bg-muted/20" />;
          const off = offOn(date);
          const holidays = holidaysOn(date);
          const count = view.counts[date] ?? 0; // eslint-disable-line security/detect-object-injection -- date comes from the view's own list
          const weekend = i % 7 >= 5;
          return (
            <div key={date} role="gridcell" className={cn("min-h-24 space-y-1 border-b border-r p-1.5", weekend && "bg-muted/30", date === today && "ring-2 ring-inset ring-primary")}>
              <div className="text-xs text-muted-foreground">{Number(date.slice(8))}</div>
              {holidays.map((h) => (
                <div key={h.calendar + h.name} className="truncate rounded bg-secondary px-1 text-xs text-secondary-foreground" title={h.name}>
                  {h.name}
                </div>
              ))}
              {view.mode === "counts" && count > 0 ? <Badge variant="secondary">{count} off</Badge> : null}
              {off.slice(0, 3).map((e) => (
                <div key={e.employeeId + e.startDate} className={cn("truncate rounded px-1 text-xs", e.pending ? "border border-dashed border-primary/50 text-muted-foreground" : "bg-primary/15 text-foreground")} title={`${e.name}${e.leaveType ? ` · ${e.leaveType}` : ""}${e.pending ? " (pending)" : ""}`}>
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
