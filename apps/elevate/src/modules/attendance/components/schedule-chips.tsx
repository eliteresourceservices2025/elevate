import { formatDateOnly } from "@/lib/time";
import { WEEKDAYS } from "../schedule";
import type { DayChip } from "../schedule-view";

/** Monday to Sunday at a glance: each shift's start time and client. The full times are on the person's page. */
export function ScheduleChips({ chips, nextChange }: { chips: DayChip[]; nextChange: string | null }) {
  return (
    <div className="space-y-1">
      <ol className="grid w-full grid-cols-7 gap-1 sm:min-w-72" aria-label="Week">
        {chips.map((day) => (
          <li key={day.weekday} className="min-w-0 rounded-md border p-1 text-center text-xs">
            <span className="block text-muted-foreground">{WEEKDAYS.find((w) => w.n === day.weekday)?.short}</span>
            {day.shifts.length === 0 ? (
              <span className="block text-muted-foreground">
                <span aria-hidden>-</span>
                <span className="sr-only">Rest</span>
              </span>
            ) : (
              day.shifts.map((s) => (
                <span key={s.entryId} className="mt-0.5 block rounded bg-primary/10 px-0.5" title={`${s.clientName ?? "No client"}, ${s.startLabel}`}>
                  <span className="block font-medium">{s.startLabel.replace(":00", "").replace(" AM", "a").replace(" PM", "p")}</span>
                  <span className="block truncate">{s.clientName ?? "No client"}</span>
                </span>
              ))
            )}
          </li>
        ))}
      </ol>
      {nextChange ? <p className="text-xs text-muted-foreground">Changes {formatDateOnly(nextChange)}</p> : null}
    </div>
  );
}
