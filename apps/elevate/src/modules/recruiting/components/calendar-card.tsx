"use client";

import { Button } from "@/components/ui/button";
import { disconnectCalendar } from "../actions";
import type { CalendarStatus } from "../calendar";
import { useRun } from "./use-run";

const FLASH: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Google Calendar is connected. New interviews you schedule will be created on it with a Meet link." },
  denied: { tone: "bad", text: "You did not allow access, so nothing was connected." },
  failed: { tone: "bad", text: "The connection could not be completed. Please try again." },
  not_configured: { tone: "bad", text: "Google Calendar is not set up on this server yet. Ask the developer to add the Google credentials." },
};

/** Connect or disconnect your own Google Calendar. Only for HR, Super Admin and recruiters. */
export function CalendarCard({ status, flash }: { status: CalendarStatus; flash?: string }) {
  const { run, pending } = useRun();
  // eslint-disable-next-line security/detect-object-injection -- looked up only after Object.hasOwn confirms it is one of our own keys
  const note = flash && Object.hasOwn(FLASH, flash) ? FLASH[flash] : undefined;
  return (
    <section aria-label="Google Calendar" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Google Calendar</h2>
      {note ? (
        <p role="status" className={`rounded-lg border p-3 text-sm ${note.tone === "ok" ? "border-green-600/40 bg-green-600/10" : "border-amber-500/50 bg-amber-500/10"}`}>
          {note.text}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Connect your own Google Calendar so interviews you schedule are created there with a Google Meet link, and Google sends the invites to the interviewers and the applicant. Without it, invites go out as calendar files by email. ELEVATE only asks to create and remove calendar events, and only uses the connection for interviews you schedule.
      </p>
      {!status.configured ? (
        <p className="text-sm">Not set up on this server yet, so the email calendar files are used. The developer needs to add the Google credentials.</p>
      ) : status.connected ? (
        <div className="space-y-2">
          <p className="text-sm">
            Connected as <strong>{status.email}</strong>.
            {status.needsReconnect ? " Google stopped accepting the connection (access was removed or expired). Reconnect to use it again." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {status.needsReconnect ? (
              <a href="/api/google/connect" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                Reconnect
              </a>
            ) : null}
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => window.confirm("Disconnect Google Calendar? Interviews already on your calendar stay there.") && run(() => disconnectCalendar(), "Disconnected.")}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <a href="/api/google/connect" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
          Connect Google Calendar
        </a>
      )}
    </section>
  );
}
