import Link from "next/link";
import { CalendarDays, PartyPopper } from "lucide-react";
import { getWhosOut } from "../feed-queries";
import { guarded } from "./guard";

/** The next week at a glance: who is off (as much as this person may see), holidays, and work anniversaries for HR and leads. */
export async function WhosOut() {
  return guarded("Who is out", async () => {
    const data = await getWhosOut();
    if (!data) return null;
    const { days, mode, anniversaries } = data;
    const quiet = days.every((d) => d.count === 0 && d.holidays.length === 0);
    return (
      <section aria-label="Who is out" className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarDays className="size-5 text-primary" aria-hidden />
            Who is out this week
          </h2>
          <Link href="/time-off?tab=calendar" className="text-sm text-primary underline-offset-4 hover:underline">
            Full calendar
          </Link>
        </div>
        <div className="rounded-xl border bg-card">
          {quiet ? (
            <p className="p-4 text-sm text-muted-foreground">Nobody is out and there are no holidays in the next 7 days.</p>
          ) : (
            <ul className="divide-y">
              {days.map((d) => (
                <li key={d.date} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 font-medium">{d.label}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {d.holidays.length > 0 ? <span className="mr-2 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{d.holidays.join(", ")}</span> : null}
                    {mode === "counts"
                      ? d.count > 0
                        ? `${d.count} ${d.count === 1 ? "person" : "people"} off`
                        : d.holidays.length === 0
                          ? "Nobody off"
                          : null
                      : d.names.length > 0
                        ? `${d.names.join(", ")}${d.extra > 0 ? ` and ${d.extra} more` : ""}`
                        : d.holidays.length === 0
                          ? "Nobody off"
                          : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {anniversaries.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <PartyPopper className="size-4 text-primary" aria-hidden />
            <span className="font-medium text-foreground">Work anniversaries:</span>
            {anniversaries.map((a, i) => (
              <span key={`${a.name}-${a.date}`}>
                {a.name} ({a.years} {a.years === 1 ? "year" : "years"}){i < anniversaries.length - 1 ? "," : ""}
              </span>
            ))}
          </p>
        ) : null}
      </section>
    );
  });
}
