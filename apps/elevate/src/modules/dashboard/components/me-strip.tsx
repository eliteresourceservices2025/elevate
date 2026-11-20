import type { ReactNode } from "react";
import { getMyHours, getMyScheduleTile } from "../my-queries";
import { orFallback } from "../or-fallback";
import { hoursLabel } from "./bento";
import { guarded } from "./guard";

const STATE_LABEL = { out: "Clocked out", working: "Clocked in", break: "On break" } as const;

/**
 * A slim strip for people who manage as well as work: their own clock state, hours this week and today's shift, so they never need
 * the VA view for it. Shows nothing for someone without a people record. `actions` is where Edit layout sits.
 */
export async function MeStrip({ actions }: { actions?: ReactNode }) {
  return guarded(
    "Me",
    async () => {
      const [hours, schedule] = await Promise.all([orFallback(() => getMyHours(), null), orFallback(() => getMyScheduleTile(), null)]);
      if (!hours && !actions) return null;
      const today = schedule?.days.find((d) => d.today);
      return (
        <section aria-label="Me" className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-muted px-4 py-2 text-sm">
          <span className="font-semibold">Me</span>
          {hours ? (
            <>
              <span>{STATE_LABEL[hours.state]}</span>
              <span className="tabular-nums">
                {hoursLabel(hours.weekMinutes)}
                {hours.scheduledMinutes ? ` of ${hoursLabel(hours.scheduledMinutes)}` : ""} this week
              </span>
              {today ? <span>{today.range ? `Today ${today.range}` : today.holiday ? "Today is a holiday" : "Day off today"}</span> : null}
            </>
          ) : null}
          {actions ? <span className="ml-auto">{actions}</span> : null}
        </section>
      );
    },
    <span className="sr-only" />,
  );
}
