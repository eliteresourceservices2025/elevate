"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/time";
import { retryJibbleSend, setJibblePaused, setJibblePerson, syncJibblePeopleNow, testJibbleConnection } from "../actions";
import { SLOW_SEND_MINUTES, isSendingSlow } from "../mirror-rules";
import type { JibbleOverview } from "../queries";

const BREAK_TEXT = { clock: "Breaks stop screenshots (clock out and back in)", native: "Breaks use Jibble's own breaks from each person's schedule (an unpaid one, preferring a flexible one)", off: "Breaks are not sent (screenshots keep running)" } as const;
const STATUS_VARIANT = new Map<string, "default" | "secondary" | "outline" | "destructive">([["sent", "default"], ["queued", "secondary"], ["failed", "destructive"], ["skipped", "outline"]]);

/** The Jibble page for HR: is it connected, who is matched, what was sent. Screenshots themselves stay in Jibble. */
export function JibblePanel({ overview }: { overview: JibbleOverview }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [manual, setManual] = useState<Record<string, string>>({});
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: (data: unknown) => string) =>
    startTransition(async () => {
      try {
        const result = (await fn()) as { ok: boolean; error?: string; data?: unknown };
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        toast.success(success(result.data));
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  const unmatched = overview.people.filter((p) => !p.jibblePersonId);
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const peopleShown = onlyUnmatched ? unmatched : overview.people;
  const logPaged = usePaged(overview.log);
  const peoplePaged = usePaged(peopleShown, String(onlyUnmatched));
  return (
    <div className="space-y-6">
      {overview.paused ? (
        <div role="status" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <strong>Sending to Jibble is paused.</strong> Nothing is being sent, so screenshots may not be running. The ELEVATE clock is not affected. {overview.counts.queued} {overview.counts.queued === 1 ? "call is" : "calls are"} waiting. When you resume, calls that waited more than 10 minutes are dropped and everyone&apos;s Jibble status is set right from ELEVATE.
        </div>
      ) : null}
      {isSendingSlow(overview.sendDelay.slow, overview.sendDelay.total) ? (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <strong>Calls are reaching Jibble late.</strong> {overview.sendDelay.slow} of the last {overview.sendDelay.total} waited over {SLOW_SEND_MINUTES} minutes, so screenshots start and stop late.
          The usual cause is the job service&apos;s event key (INNGEST_EVENT_KEY) missing or from the wrong environment in the host settings. Check Settings &gt; Go-live, then the events in the job service.
        </p>
      ) : null}
      {!overview.paused && overview.oldestQueuedMinutes !== null && overview.oldestQueuedMinutes >= 15 ? (
        <div role="status" className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm">
          The oldest waiting call to Jibble has waited <strong>{overview.oldestQueuedMinutes} minutes</strong>. Jibble may be slow or refusing calls: check the recent calls below.
        </div>
      ) : null}
      <section aria-label="Connection" className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Connection</h2>
          <Badge variant={overview.configured ? "default" : "destructive"}>{overview.configured ? "Token set" : "Not set up"}</Badge>
          <Badge variant="outline">{overview.mode === "mirror" ? "ELEVATE starts and stops Jibble" : "Fallback: people clock into both apps"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          ELEVATE is the time clock and the only source of hours. Jibble is used only for screenshots; they stay in Jibble and are never copied here. {BREAK_TEXT[overview.breakMode]}. Mirroring works for a team once the monitoring
          policy is published{overview.monitoringPublished ? " (it is)" : " (it is not yet)"} and the switch for the team is on in the Rules tab ({overview.teamsOn} {overview.teamsOn === 1 ? "team is" : "teams are"} on). Each night ELEVATE compares totals and flags days that differ by more than {overview.toleranceMinutes} minutes.
        </p>
        {overview.selfTestPeople > 0 ? (
          <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <strong>Self-test is on</strong> for {overview.selfTestPeople} {overview.selfTestPeople === 1 ? "person" : "people"} (set in the host settings as JIBBLE_SELF_TEST_EMAILS). Their clock is mirrored to Jibble even
            without the published policy or the team switch. Remove the setting when testing is finished.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending || !overview.configured} onClick={() => run(() => testJibbleConnection(), (d) => { const r = d as { people: number; breaks: number | null }; return `Connected. Jibble has ${r.people} people${r.breaks === null ? "" : ` and ${r.breaks} break ${r.breaks === 1 ? "type" : "types"}`}.${overview.breakMode === "native" && r.breaks === 0 ? " Breaks will fail until breaks are set up for people in Jibble (Settings > Breaks, and on their schedule)." : ""}`; })}>
            Test connection
          </Button>
          <Button size="sm" variant={overview.paused ? "default" : "outline"} disabled={pending} onClick={() => run(() => setJibblePaused({ paused: !overview.paused }), (d) => (overview.paused ? `Resumed. ${(d as { dropped: number }).dropped} old calls were dropped.` : "Paused. Nothing will be sent to Jibble."))}>
            {overview.paused ? "Resume sending to Jibble" : "Pause sending to Jibble"}
          </Button>
          <Button size="sm" variant="outline" disabled={pending || !overview.configured} onClick={() => run(() => syncJibblePeopleNow(), (d) => `Matched ${(d as { matched: number }).matched} people; ${(d as { unmatched: number }).unmatched} still unmatched.`)}>
            Match people by email now
          </Button>
        </div>
        <p className="text-sm">
          Waiting: <strong>{overview.counts.queued}</strong> · Sent in the last 24 hours: <strong>{overview.counts.sent24h}</strong> · Failed: <strong className={overview.counts.failed ? "text-red-600" : undefined}>{overview.counts.failed}</strong>
        </p>
      </section>

      <section aria-label="Recent calls" className="space-y-2">
        <h2 className="text-lg font-semibold">Recent calls to Jibble</h2>
        {overview.log.length === 0 ? (
          <p className="text-muted-foreground">Nothing has been sent yet.</p>
        ) : (
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Call</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {logPaged.rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{formatInZone(l.createdAt, undefined, "MMM d, h:mm a")}</TableCell>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell>
                      {l.action}
                      {l.source === "repair" ? <Badge variant="outline" className="ml-1">repair</Badge> : null}
                      {l.fallback ? <Badge variant="outline" className="ml-1">clock-out instead</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT.get(l.status) ?? "outline"}>{l.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.lastError ?? (l.attempts > 1 ? `${l.attempts} tries` : "")}</TableCell>
                    <TableCell>
                      {l.status === "failed" ? (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryJibbleSend({ logId: l.id }), () => "Sent again.")}>
                          Retry
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {overview.log.length > 0 ? <ClientPager info={logPaged.info} onPage={logPaged.setPage} onSize={logPaged.setPageSize} label="calls" /> : null}
      </section>

      <section aria-label="People" className="space-y-2">
        <h2 className="text-lg font-semibold">
          People <span className="text-sm font-normal text-muted-foreground">({overview.people.length - unmatched.length} matched, {unmatched.length} not matched)</span>
        </h2>
        <p className="text-sm text-muted-foreground">Matched automatically by work email. If someone uses a different email in Jibble, type the email they use in Jibble or their Jibble member code (as in Jibble&apos;s exports) to match them by hand. People with no match are skipped.</p>
        <label htmlFor="jp-unmatched" className="flex items-center gap-1.5 text-sm">
          <input id="jp-unmatched" type="checkbox" className="size-4 accent-primary" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
          Only people not matched
        </label>
        <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Jibble</TableHead>
                <TableHead>Match by hand</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {peoplePaged.rows.map((p) => (
                <TableRow key={p.employeeId}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.team ?? "No team"}</TableCell>
                  <TableCell>{p.jibblePersonId ? <Badge variant="default">Matched by {p.matchedBy}</Badge> : <Badge variant="outline">Not matched</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`jp-${p.employeeId}`} className="sr-only">
                        Email in Jibble or member code for {p.name}
                      </Label>
                      <Input id={`jp-${p.employeeId}`} className="h-8 w-64" placeholder="Email in Jibble or member code" value={manual[p.employeeId] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [p.employeeId]: e.target.value }))} />
                      <Button size="sm" variant="outline" disabled={pending || !(manual[p.employeeId] ?? "").trim()} onClick={() => run(() => setJibblePerson({ employeeId: p.employeeId, jibblePersonId: manual[p.employeeId] }), () => "Matched.")}>
                        Save
                      </Button>
                      {p.matchedBy === "manual" ? (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setJibblePerson({ employeeId: p.employeeId, jibblePersonId: "" }), () => "Match removed.")}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ClientPager info={peoplePaged.info} onPage={peoplePaged.setPage} onSize={peoplePaged.setPageSize} label="people" />
      </section>
    </div>
  );
}
