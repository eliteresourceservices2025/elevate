import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/time";
import type { SystemHealth } from "../queries";

const STATE_TEXT = { ok: "Running", late: "Stopped", failing: "Last run failed", waiting: "Not run yet" } as const;
const STATE_VARIANT = { ok: "default", late: "destructive", failing: "destructive", waiting: "outline" } as const;
const every = (minutes: number) => (minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${minutes / 60} h` : minutes === 1440 ? "daily" : minutes === 10_080 ? "weekly" : `${Math.round(minutes / 1440)} days`);

/** What HR looks at when something feels wrong: are the jobs running, is Jibble keeping up, is the clock being used. */
export function HealthPanel({ health }: { health: SystemHealth }) {
  const bad = health.jobs.filter((j) => j.state === "late" || j.state === "failing");
  const j = health.jibble;
  return (
    <div className="space-y-6">
      <div role="status" className={`rounded-xl border p-4 text-sm ${bad.length === 0 && (j.oldestMinutes ?? 0) < 15 ? "border-green-600/40 bg-green-600/10" : "border-red-500/50 bg-red-500/10"}`}>
        {bad.length === 0 && (j.oldestMinutes ?? 0) < 15 ? (
          <>Everything is running. Checked {formatInZone(health.checkedAt, undefined, "h:mm a")}.</>
        ) : (
          <>
            <strong>Something needs a look.</strong> {bad.length > 0 ? `${bad.length} scheduled ${bad.length === 1 ? "job is" : "jobs are"} not running as expected. ` : ""}
            {(j.oldestMinutes ?? 0) >= 15 ? `A call to Jibble has waited ${j.oldestMinutes} minutes.` : ""} The clock itself keeps working; background tasks (alerts, nightly flags, Jibble) may be behind.
          </>
        )}
      </div>

      <section aria-label="Clock activity" className="grid gap-3 sm:grid-cols-4">
        {[
          ["Working now", health.clock.workingNow],
          ["Clock actions, last hour", health.clock.clockActionsLastHour],
          ["Pages checking in, last 10 min", health.clock.stillHereLast10Minutes],
          ["Last clock action", health.clock.lastClockAt ? formatInZone(health.clock.lastClockAt, undefined, "MMM d, h:mm a") : "-"],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section aria-label="Jibble" className="space-y-2">
        <h2 className="text-lg font-semibold">Jibble</h2>
        <p className="text-sm">
          {j.configured ? "Connected." : "Not set up."} {j.paused ? <Badge variant="secondary">Paused</Badge> : null} Waiting: <strong>{j.queued}</strong> · Oldest waiting: <strong>{j.oldestMinutes === null ? "none" : `${j.oldestMinutes} min`}</strong> · Failed in 24 hours:{" "}
          <strong className={j.failed24h ? "text-red-600" : undefined}>{j.failed24h}</strong> · Last sent: <strong>{j.lastSentAt ? formatInZone(j.lastSentAt, undefined, "MMM d, h:mm a") : "never"}</strong>
        </p>
      </section>

      <section aria-label="Scheduled jobs" className="space-y-2">
        <h2 className="text-lg font-semibold">Scheduled jobs</h2>
        <p className="text-sm text-muted-foreground">A job that has not succeeded for more than two and a half times its usual interval shows as stopped, and HR is told. The host&apos;s own scheduler also runs the health check every 15 minutes in case the job service is down.</p>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last success</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.jobs.map((job) => (
                <TableRow key={job.job}>
                  <TableCell className="font-medium">{job.label}</TableCell>
                  <TableCell>{every(job.everyMinutes)}</TableCell>
                  <TableCell>
                    <Badge variant={STATE_VARIANT[job.state]}>{STATE_TEXT[job.state]}</Badge>
                  </TableCell>
                  <TableCell>{job.lastSuccessAt ? formatInZone(job.lastSuccessAt, undefined, "MMM d, h:mm a") : "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{job.lastError ? `${job.lastError} (${job.lastErrorAt ? formatInZone(job.lastErrorAt, undefined, "MMM d, h:mm a") : ""})` : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
