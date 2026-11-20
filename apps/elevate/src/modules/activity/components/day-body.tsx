import { Camera } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { minutesText } from "../labels";
import type { ActivityDay } from "../queries";
import { hourTicks, layoutTimeline } from "../timeline";
import { TimelineStrip } from "./timeline-strip";

/** Which client and project the working time was for, with the day and the exact times. Nothing is shown for a person with no clients. */
function WorkLog({ day, viewerZone }: { day: ActivityDay; viewerZone: string }) {
  if (day.workLog.length === 0) return null;
  return (
    <section aria-label="Who the time was for" className="space-y-2">
      <h3 className="text-sm font-semibold">Who the time was for</h3>
      <ul className="divide-y rounded-xl border bg-card text-sm">
        {day.workLog.map((w) => (
          <li key={`${w.start}-${w.end}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
            <span>
              {w.client ?? "Client"}
              {w.project ? <span className="text-muted-foreground"> · {w.project}</span> : null}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatInZone(w.start, viewerZone, "EEE MMM d")}, {formatInZone(w.start, viewerZone, "h:mm a")} to {formatInZone(w.end, viewerZone, "h:mm a")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A day's timeline, totals and top apps. Shared by "My day" and the person page. `dayStart`/`dayEnd` are the person's day. */
export function DayBody({ day, viewerZone }: { day: ActivityDay; viewerZone: string }) {
  const { dayStart, dayEnd } = day;
  const blocks = layoutTimeline({ segments: day.segments, working: day.working, dayStart, dayEnd, formatTime: (ms) => formatInZone(ms, viewerZone, "h:mm a") });
  const ticks = hourTicks(dayStart, dayEnd, (ms) => formatInZone(ms, viewerZone, "ha").toLowerCase());
  const m = day.minutes;
  const other = Math.max(0, m.active - m.work - m.nonWork);
  const none = m.active + m.idle === 0;
  const log = (
    <WorkLog day={day} viewerZone={viewerZone} />
  );
  if (none) return day.workLog.length > 0 ? log : <EmptyState icon={Camera} title="Nothing recorded for this day" description="The ELEVATE Tracker App records only while you are clocked in." />;
  return (
    <div className="space-y-4">
      <TimelineStrip blocks={blocks} ticks={ticks} ariaLabel={`Timeline of ${formatDateOnly(day.date)}: ${minutesText(m.active)} active, ${minutesText(m.idle)} idle`} />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Active", minutesText(m.active)],
          ["Idle", minutesText(m.idle)],
          ["Work apps", minutesText(m.work)],
          ["Other apps", minutesText(m.nonWork + other)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-heading text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {log}
      {day.topApps.some((a) => a.minutes > 0) ? (
        <section aria-label="Top apps" className="space-y-2">
          <h3 className="text-sm font-semibold">Top apps</h3>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {day.topApps.filter((a) => a.minutes > 0).map((a) => (
              <li key={a.app} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{a.app}</span>
                <span className="tabular-nums text-muted-foreground">{minutesText(a.minutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
