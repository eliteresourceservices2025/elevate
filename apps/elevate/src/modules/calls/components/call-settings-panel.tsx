"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatInZone } from "@/lib/time";
import { saveCallSettings } from "../actions";
import type { CallSettingsView } from "../settings";

/** Super Admin: this month's estimated media against Cloudflare's free 1,000 GB, the warning level, and the all-hands switch. */
export function CallSettingsPanel({ view, timeZone }: { view: CallSettingsView; timeZone: string }) {
  const router = useRouter();
  const [warning, setWarning] = useState(String(view.warningGb));
  const [townhall, setTownhall] = useState(view.townhallEnabled);
  const [pending, startTransition] = useTransition();
  const percent = Math.min(100, Math.round((view.monthGb / view.freeGb) * 100));
  const level = Number(warning);
  const valid = Number.isInteger(level) && level >= 50 && level <= 5000;

  return (
    <div className="flex flex-col gap-6">
      {!view.available ? (
        <Alert variant="warning">
          <AlertDescription>Calls are off: the four Cloudflare settings are not set on this server yet (see docs/modules/messages.md).</AlertDescription>
        </Alert>
      ) : view.usingFake ? (
        <Alert variant="info">
          <AlertDescription>This server is using the test media layer (no real video or audio). It never runs in production.</AlertDescription>
        </Alert>
      ) : null}
      {view.overWarning ? (
        <Alert variant="warning">
          <AlertDescription>
            This month&apos;s estimate has passed your warning level of {view.warningGb} GB. Cloudflare&apos;s free allowance is {view.freeGb} GB a month; after that it costs about $0.05 per GB.
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-label="This month" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <h2 className="font-heading text-lg font-semibold">This month</h2>
        <p className="text-sm">
          About <strong>{view.monthGb.toLocaleString()} GB</strong> of {view.freeGb.toLocaleString()} GB free, from {view.callsThisMonth} {view.callsThisMonth === 1 ? "call" : "calls"} and {view.participantMinutesThisMonth.toLocaleString()} participant-minutes.
        </p>
        <div role="progressbar" aria-label="Estimated media this month" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-2.5 w-full overflow-clip rounded-full bg-muted">
          <div className={view.overWarning ? "h-full bg-warning" : "h-full bg-primary"} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">This is our own estimate (minutes in calls times a typical bitrate). The real figure is in Cloudflare&apos;s dashboard under Realtime.</p>
      </section>

      <form
        aria-label="Call settings"
        className="flex flex-col gap-4 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          startTransition(async () => {
            const result = await saveCallSettings({ monthlyGbWarning: level, townhallEnabled: townhall });
            if (!result.ok) return void toast.error(result.error);
            toast.success("Saved.");
            router.refresh();
          });
        }}
      >
        <h2 className="font-heading text-lg font-semibold">Settings</h2>
        <div className="flex max-w-xs flex-col gap-1.5">
          <label htmlFor="gb-warning" className="text-sm font-medium">
            Warn me at (GB a month)
          </label>
          <Input id="gb-warning" type="number" inputMode="numeric" min={50} max={5000} value={warning} onChange={(e) => setWarning(e.target.value)} aria-invalid={!valid} />
          <p className="text-xs text-muted-foreground">A number from 50 to 5,000. The free allowance is 1,000.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={townhall} onChange={(e) => setTownhall(e.target.checked)} />
          <span>
            <span className="block font-medium">Allow all-hands calls</span>
            <span className="block text-muted-foreground">Big calls where a few people speak and everyone else watches. Coming in a later release.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm opacity-70">
          <input type="checkbox" className="mt-0.5 size-4" checked={view.recordingEnabled} disabled readOnly />
          <span>
            <span className="block font-medium">Allow recording</span>
            <span className="block text-muted-foreground">Off until the recording feature and the updated Monitoring policy are published.</span>
          </span>
        </label>
        <div>
          <Button type="submit" disabled={!valid || pending}>
            Save
          </Button>
        </div>
      </form>

      <section aria-label="Recent calls" className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-semibold">Recent calls</h2>
        <p className="text-sm text-muted-foreground">When, how long and how many. Never who said or showed what.</p>
        {view.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {view.recent.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-medium">{formatInZone(c.startedAt, timeZone, "MMM d, h:mm a")}</span>
                <span className="text-muted-foreground">{c.minutes > 0 ? `${c.minutes} min` : "still going or never started"}</span>
                <span className="text-muted-foreground">up to {c.people} {c.people === 1 ? "person" : "people"}</span>
                <span className="ml-auto text-muted-foreground">{c.estimatedGb.toLocaleString()} GB</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
