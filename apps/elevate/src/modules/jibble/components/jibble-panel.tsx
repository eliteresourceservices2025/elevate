"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatInZone } from "@/lib/time";
import { confirmUncertainJibbleOperation, retryJibbleSend, reviewFailedJibbleCall, reviewJibbleMismatch, setJibblePaused, setJibblePerson, syncJibblePeopleNow, testJibbleConnection } from "../actions";
import { SLOW_SEND_MINUTES, isSendingSlow } from "../mirror-rules";
import type { JibbleOverview } from "../queries";
import { Alert } from "@/components/ui/alert";

const BREAK_TEXT = { clock: "Breaks stop screenshots (clock out and back in)", native: "Breaks use Jibble's own breaks from each person's schedule (an unpaid one, preferring a flexible one)", off: "Breaks are not sent (screenshots keep running)" } as const;
const STATUS_VARIANT = new Map<string, "default" | "secondary" | "outline" | "destructive">([["sent", "default"], ["queued", "secondary"], ["failed", "destructive"], ["skipped", "outline"]]);

/** The Jibble page for HR: is it connected, who is matched, what was sent. Screenshots themselves stay in Jibble. */
export function JibblePanel({ overview, previewMode }: { overview: JibbleOverview; previewMode?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [manual, setManual] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [tab, setTab] = useState("shifts");
  useEffect(() => {
    const sync = () => {
      const name = window.location.hash.replace("#jibble-", "");
      if (["shifts", "calls", "people"].includes(name) || (overview.reviewEnabled && name === "exceptions")) setTab(name);
      else if (name === "exceptions") setTab("shifts");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [overview.reviewEnabled]);
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
  const [peopleSearch, setPeopleSearch] = useState("");
  const peopleShown = (onlyUnmatched ? unmatched : overview.people).filter((p) => `${p.name} ${p.email ?? ""} ${p.team ?? ""}`.toLowerCase().includes(peopleSearch.trim().toLowerCase()));
  const shiftsPaged = usePaged(overview.shifts);
  const peoplePaged = usePaged(peopleShown, `${onlyUnmatched}:${peopleSearch}`);
  const historyLink = (page: number) => {
    const params = new URLSearchParams();
    if (previewMode) params.set("preview", previewMode);
    if (overview.callHistory.search) params.set("callSearch", overview.callHistory.search);
    if (overview.callHistory.status !== "all") params.set("callStatus", overview.callHistory.status);
    params.set("callPage", String(page));
    return `/jibble?${params.toString()}#jibble-calls`;
  };
  const exceptionLink = (page: number) => {
    const params = new URLSearchParams();
    if (previewMode) params.set("preview", previewMode);
    if (overview.callHistory.search) params.set("callSearch", overview.callHistory.search);
    if (overview.callHistory.status !== "all") params.set("callStatus", overview.callHistory.status);
    params.set("exceptionPage", String(page));
    return `/jibble?${params.toString()}#jibble-exceptions`;
  };
  return (
    <div className="space-y-6">
      {overview.paused ? (
        <Alert variant="warning" role="status" className="rounded-xl p-4 text-sm">
          <strong>Sending to Jibble is paused.</strong> New calls wait, so screenshots may not be running. The ELEVATE clock is not affected. {overview.counts.queued} {overview.counts.queued === 1 ? "call is" : "calls are"} waiting. {overview.reviewEnabled ? "When you resume, calls that waited more than 10 minutes stay queued for review." : "When you resume, calls that waited more than 10 minutes are dropped and eligible people are checked for repair. Some repairs may fail or be skipped."}
        </Alert>
      ) : null}
      {isSendingSlow(overview.sendDelay.slow, overview.sendDelay.total) ? (
        <Alert variant="warning" role="alert" className="rounded-lg p-3 text-sm">
          <strong>Calls are reaching Jibble late.</strong> {overview.sendDelay.slow} of the last {overview.sendDelay.total} waited over {SLOW_SEND_MINUTES} minutes. This can delay when screenshots start or stop.
          Check the delivery times below, the job service and the host logs. The desktop app must also be running for screenshots to be captured.
        </Alert>
      ) : null}
      {!overview.paused && overview.oldestQueuedMinutes !== null && overview.oldestQueuedMinutes >= 15 ? (
        <Alert variant="destructive" role="status" className="rounded-xl p-4 text-sm">
          The oldest waiting call to Jibble has waited <strong>{overview.oldestQueuedMinutes} minutes</strong>. Jibble may be slow or refusing calls: check the recent calls below.
        </Alert>
      ) : null}
      <section aria-label="Connection" className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Connection</h2>
          <Badge variant={overview.configured ? "default" : "destructive"}>{overview.configured ? "Token set" : "Not set up"}</Badge>
          <Badge variant="outline">{overview.mode === "mirror" ? "ELEVATE starts and stops Jibble" : "Fallback: people clock into both apps"}</Badge>
        </div>
        <p className="hidden text-sm text-muted-foreground sm:block">
          ELEVATE is the time clock and the only source of hours. Jibble is used only for screenshots; they stay in Jibble and are never copied here. {BREAK_TEXT[overview.breakMode]}. Mirroring works for a team once the monitoring
          policy is published{overview.monitoringPublished ? " (it is)" : " (it is not yet)"} and the switch for the team is on in the Rules tab ({overview.teamsOn} {overview.teamsOn === 1 ? "team is" : "teams are"} on). Each night ELEVATE compares totals and flags days that differ by more than {overview.toleranceMinutes} minutes.
        </p>
        <details className="text-sm text-muted-foreground sm:hidden">
          <summary className="cursor-pointer font-medium text-foreground">About the Jibble link</summary>
          <p className="mt-2">ELEVATE is the time clock and the only source of hours. Jibble is used only for screenshots; they stay in Jibble and are never copied here. {BREAK_TEXT[overview.breakMode]}. Mirroring works for a team once the monitoring policy is published{overview.monitoringPublished ? " (it is)" : " (it is not yet)"} and the team switch is on in the Rules tab ({overview.teamsOn} {overview.teamsOn === 1 ? "team is" : "teams are"} on). Each night ELEVATE compares totals and flags days that differ by more than {overview.toleranceMinutes} minutes.</p>
        </details>
        {overview.selfTestPeople > 0 ? (
          <Alert variant="warning" role="status" className="rounded-lg p-3 text-sm">
            <strong>Self-test is on</strong> for {overview.selfTestPeople} {overview.selfTestPeople === 1 ? "person" : "people"} (set in the host settings as JIBBLE_SELF_TEST_EMAILS). Their clock is mirrored to Jibble even
            without the published policy or the team switch. Remove the setting when testing is finished.
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending || !overview.configured} onClick={() => run(() => testJibbleConnection(), (d) => { const r = d as { people: number; breaks: number | null }; return `Connected. Jibble has ${r.people} people${r.breaks === null ? "" : `; the sampled person has ${r.breaks} available ${r.breaks === 1 ? "break" : "breaks"}`}.${overview.breakMode === "native" && r.breaks === 0 ? " Check their Jibble schedule; ELEVATE may clock out instead when a native break is unavailable." : ""}`; })}>
            Test connection
          </Button>
          <Button size="sm" variant={overview.paused ? "default" : "outline"} disabled={pending} onClick={() => run(() => setJibblePaused({ paused: !overview.paused }), (d) => (overview.paused ? overview.reviewEnabled ? "Resumed. Old calls remain queued for review." : `Resumed. ${(d as { dropped: number }).dropped} old calls were dropped.` : "Paused. New calls will wait; a request already in flight may still finish."))}>
            {overview.paused ? "Resume sending to Jibble" : "Pause sending to Jibble"}
          </Button>
          <Button size="sm" variant="outline" disabled={pending || !overview.configured} onClick={() => run(() => syncJibblePeopleNow(), (d) => `Matched ${(d as { matched: number }).matched} people; ${(d as { unmatched: number }).unmatched} still unmatched.`)}>
            Match people by email now
          </Button>
        </div>
        <p className="text-sm">
          Waiting: <strong>{overview.counts.queued}</strong> · Sent in the last 24 hours: <strong>{overview.counts.sent24h}</strong> · Failed: <strong className={overview.counts.failed ? "text-destructive" : undefined}>{overview.counts.failed}</strong>
        </p>
      </section>

      <Tabs value={tab} onValueChange={(value) => {
        if (typeof value !== "string") return;
        setTab(value);
        window.history.replaceState(null, "", `#jibble-${value}`);
      }} className="gap-4">
        <div>
          <TabsList aria-label="Jibble sections" className="!h-auto min-h-11 w-full flex-wrap justify-start gap-1 p-1 sm:w-fit">
            <TabsTrigger value="shifts" className="min-h-9 px-3">Recent shifts</TabsTrigger>
            <TabsTrigger value="calls" className="min-h-9 px-3">Call history{overview.counts.failed > 0 ? ` (${overview.counts.failed} failed)` : ""}</TabsTrigger>
            {overview.reviewEnabled ? <TabsTrigger value="exceptions" className="min-h-9 px-3">Needs attention{overview.exceptions.total ? ` (${overview.exceptions.total})` : ""}</TabsTrigger> : null}
            <TabsTrigger value="people" className="min-h-9 px-3">People matching{unmatched.length > 0 ? ` (${unmatched.length} unmatched)` : ""}</TabsTrigger>
          </TabsList>
        </div>
      <TabsContent value="shifts">
      <section id="jibble-shifts" aria-label="Recent shifts" className="scroll-mt-20 space-y-2">
        <h2 className="text-lg font-semibold">Recent shifts</h2>
        <p className="text-sm text-muted-foreground">Clock-in and clock-out times from ELEVATE for shifts with Jibble calls. Check call history for delivery status, breaks and repairs. Times shown in {overview.viewerTimeZone}.</p>
        <>
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table stack>
              <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Clock in</TableHead><TableHead>Clock out</TableHead></TableRow></TableHeader>
              <TableBody>{shiftsPaged.rows.map((shift) => <TableRow key={shift.id}>
                <TableCell className="font-medium">{shift.name}</TableCell>
                <TableCell label="Clock in">{formatInZone(shift.clockIn, overview.viewerTimeZone, "MMM d, yyyy h:mm a")}</TableCell>
                <TableCell label="Clock out">{shift.clockOut ? formatInZone(shift.clockOut, overview.viewerTimeZone, "MMM d, yyyy h:mm a") : "No clock-out recorded"}</TableCell>
              </TableRow>)}{overview.shifts.length === 0 ? <TableRow><TableCell colSpan={3} className="text-muted-foreground">No shifts with Jibble calls yet.</TableCell></TableRow> : null}</TableBody>
            </Table>
          </div>
          {overview.shifts.length > 0 ? <ClientPager info={shiftsPaged.info} onPage={shiftsPaged.setPage} onSize={shiftsPaged.setPageSize} label="shifts" /> : null}
        </>
      </section>
      </TabsContent>

      {overview.reviewEnabled ? <TabsContent value="exceptions">
        <section id="jibble-exceptions" aria-label="Needs attention" className="scroll-mt-20 space-y-2">
          <h2 className="text-lg font-semibold">Needs attention</h2>
          <p className="text-sm text-muted-foreground">Open mismatches and guarded operations are separate from historical call failures. An in-progress or uncertain operation must not be replayed. Times shown in {overview.viewerTimeZone}.</p>
          <p className="text-sm text-muted-foreground">Check request looks for the exact saved request in Jibble without sending it again. If it cannot be confirmed, it stays blocked for investigation.</p>
          {overview.exceptions.rows.length ? <Table stack>
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Issue</TableHead><TableHead>Last update</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
            <TableBody>{overview.exceptions.rows.map((item) => <TableRow key={`${item.category}:${item.id}`}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell label="Issue" className="whitespace-normal">{item.category === "mismatch" ? item.detail === "working_jibble_out" ? "ELEVATE working; Jibble clocked out" : item.detail === "working_jibble_break" ? "ELEVATE working; Jibble on break" : item.detail === "possible_jibble_only" ? "Possible Jibble-only start; verify the entry" : "ELEVATE clocked out; Jibble has an active entry" : item.detail === "uncertain" ? "Jibble operation outcome uncertain" : item.detail === "in_flight" ? "Jibble operation in flight" : "Jibble operation reserved"}</TableCell>
              <TableCell label="Last update">{formatInZone(item.at, overview.viewerTimeZone, "MMM d, yyyy h:mm a")}</TableCell>
              <TableCell label="Action">{item.category === "mismatch" ? item.detail === "possible_jibble_only" ? <div className="min-w-48 space-y-2"><a className="text-sm underline" href="/attendance?tab=corrections">Review time correction</a><Label htmlFor={`review-${item.id}`}>Review findings</Label><Input id={`review-${item.id}`} value={reviewNotes[item.id] ?? ""} onChange={(event) => setReviewNotes((notes) => ({ ...notes, [item.id]: event.target.value }))} maxLength={300} placeholder="Describe what you found" /><Button size="sm" variant="outline" disabled={pending || Boolean(previewMode) || (reviewNotes[item.id]?.trim().length ?? 0) < 10} onClick={() => run(() => reviewJibbleMismatch({ mismatchId: item.id, note: reviewNotes[item.id] }), () => "Review recorded; current statuses match.")}>Mark reviewed</Button></div> : <Button size="sm" variant="outline" disabled={pending || Boolean(previewMode)} onClick={() => run(() => reviewJibbleMismatch({ mismatchId: item.id }), () => "Current statuses match; mismatch marked reviewed.")}>Review status</Button> : item.recoverable ? <Button size="sm" variant="outline" disabled={pending || Boolean(previewMode)} onClick={() => run(() => confirmUncertainJibbleOperation({ employeeId: item.id }), () => "The exact request was confirmed. Check current status before any further action.")}>Check request</Button> : <span className="text-muted-foreground">Investigation required</span>}</TableCell>
            </TableRow>)}</TableBody>
          </Table> : <p className="text-sm text-muted-foreground">No open mismatches or guarded operations.</p>}
          {overview.exceptions.total ? <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p className="text-muted-foreground">Showing {overview.exceptions.from} to {overview.exceptions.to} of {overview.exceptions.total} items</p><div className="flex items-center gap-3">{overview.exceptions.page > 1 ? <a className="underline" href={exceptionLink(overview.exceptions.page - 1)}>Previous</a> : null}<span>Page {overview.exceptions.page} of {overview.exceptions.pages}</span>{overview.exceptions.page < overview.exceptions.pages ? <a className="underline" href={exceptionLink(overview.exceptions.page + 1)}>Next</a> : null}</div></div> : null}
        </section>
      </TabsContent> : null}

      <TabsContent value="calls">
      <section id="jibble-calls" aria-label="Call history" className="scroll-mt-20 space-y-2">
        <h2 className="text-lg font-semibold">Call history</h2>
        <p className="text-sm text-muted-foreground">Each row is one call, including breaks and repairs. Sent time shows when ELEVATE marked the call sent, which can include a state check; it does not confirm when the desktop app began taking screenshots. Times shown in {overview.viewerTimeZone}.</p>
        <p className="text-sm text-muted-foreground">Completed and failed calls are kept for 90 days; queued calls are retained while waiting.</p>
        <form action="/jibble#jibble-calls" method="get" className="flex flex-wrap items-end gap-2">
          {previewMode ? <input type="hidden" name="preview" value={previewMode} /> : null}
          <div className="min-w-0 flex-1 basis-48"><Label htmlFor="call-search">Person</Label><Input id="call-search" name="callSearch" defaultValue={overview.callHistory.search} placeholder="Search by name" maxLength={100} /></div>
          <div><Label htmlFor="call-status">Status</Label><select id="call-status" name="callStatus" defaultValue={overview.callHistory.status} className="flex h-9 rounded-md border bg-background px-3 text-sm"><option value="all">All statuses</option><option value="queued">Waiting</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Skipped</option></select></div>
          <div className="flex h-9 items-center gap-3">
            <Button type="submit" size="sm" className="h-9">Filter</Button>
            {overview.callHistory.search || overview.callHistory.status !== "all" ? <a href={previewMode ? `/jibble?preview=${encodeURIComponent(previewMode)}#jibble-calls` : "/jibble#jibble-calls"} className="inline-flex h-9 items-center text-sm underline">Clear filters</a> : null}
          </div>
        </form>
        {overview.counts.failed > 0 ? <Alert variant="warning" className="rounded-lg p-3 text-sm">{overview.reviewEnabled ? "Review checks the current ELEVATE and Jibble status. It records a review only when the statuses match; the original failure remains in history." : "Before retrying, check the person's current status in ELEVATE and Jibble. Older or superseded calls cannot be retried here."}</Alert> : null}
        {overview.log.length === 0 ? (
          <p className="text-muted-foreground">No calls match these filters.</p>
        ) : (
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Call</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent at</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.log.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell label="When">{formatInZone(l.createdAt, overview.viewerTimeZone, "MMM d, yyyy h:mm a")}</TableCell>
                    <TableCell label="Call">
                      {l.action}
                      {l.source === "repair" ? <Badge variant="outline" className="ml-1">repair</Badge> : null}
                      {l.fallback ? <Badge variant="outline" className="ml-1">clock-out instead</Badge> : null}
                    </TableCell>
                    <TableCell label="Status">
                      <Badge variant={STATUS_VARIANT.get(l.status) ?? "outline"}>{l.status}</Badge>
                    </TableCell>
                    <TableCell label="Sent at" className="text-sm">{l.sentAt ? formatInZone(l.sentAt, overview.viewerTimeZone, "MMM d, yyyy h:mm a") : "—"}</TableCell>
                    <TableCell label="Note" className="max-w-xs whitespace-normal break-words text-xs text-muted-foreground md:min-w-36">{l.lastError ?? (l.attempts > 1 ? `${l.attempts} tries` : "—")}</TableCell>
                    <TableCell label="Actions">
                      {l.status === "failed" ? overview.reviewEnabled ? l.reviewed ? <span className="text-muted-foreground">Reviewed</span> : (
                        <Button size="sm" variant="outline" disabled={pending || Boolean(previewMode)} onClick={() => run(() => reviewFailedJibbleCall({ logId: l.id }), () => "Current statuses match; failure marked reviewed.")}>Review</Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={pending || Boolean(previewMode)} onClick={() => run(() => retryJibbleSend({ logId: l.id }), () => "Retry requested. Check the call status.")}>Retry</Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {overview.callHistory.total > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p className="text-muted-foreground">Showing {overview.callHistory.from} to {overview.callHistory.to} of {overview.callHistory.total} calls</p><div className="flex items-center gap-3">{overview.callHistory.page > 1 ? <a className="underline" href={historyLink(overview.callHistory.page - 1)}>Previous</a> : null}<span>Page {overview.callHistory.page} of {overview.callHistory.pages}</span>{overview.callHistory.page < overview.callHistory.pages ? <a className="underline" href={historyLink(overview.callHistory.page + 1)}>Next</a> : null}</div></div> : null}
      </section>
      </TabsContent>

      <TabsContent value="people">
      <section id="jibble-people" aria-label="People matching" className="scroll-mt-20 space-y-2">
        <h2 className="text-lg font-semibold">
          People matching <span className="text-sm font-normal text-muted-foreground">({overview.people.length - unmatched.length} matched, {unmatched.length} not matched)</span>
        </h2>
        <p className="text-sm text-muted-foreground">Matched automatically by work email. If someone uses a different email in Jibble, type the email they use in Jibble or their Jibble member code (as in Jibble&apos;s exports) to match them by hand. People with no match are skipped.</p>
        <div className="max-w-sm"><Label htmlFor="jp-search">Find a person</Label><Input id="jp-search" value={peopleSearch} onChange={(e) => setPeopleSearch(e.target.value)} placeholder="Search name, email or team" /></div>
        {overview.people.length === 1000 ? <p className="text-sm text-muted-foreground">Only the first 1,000 people are shown; search applies to this list.</p> : null}
        <label htmlFor="jp-unmatched" className="flex items-center gap-1.5 text-sm">
          <input id="jp-unmatched" type="checkbox" className="size-4 accent-primary" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
          Only people not matched
        </label>
        <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table stack>
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
                  <TableCell label="Team">{p.team ?? "No team"}</TableCell>
                  <TableCell label="Jibble">{p.jibblePersonId ? <Badge variant="default">Matched by {p.matchedBy}</Badge> : <Badge variant="outline">Not matched</Badge>}</TableCell>
                  <TableCell label="Match by hand" className="max-md:!flex-col max-md:!items-stretch max-md:!gap-1">
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-md:w-full max-md:justify-start">
                      <Label htmlFor={`jp-${p.employeeId}`} className="sr-only">
                        Email in Jibble or member code for {p.name}
                      </Label>
                      <Input id={`jp-${p.employeeId}`} className="h-8 w-64 max-w-full min-w-0 max-lg:w-36 max-md:flex-1" placeholder="Email in Jibble or member code" value={manual[p.employeeId] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [p.employeeId]: e.target.value }))} />
                      <Button size="sm" variant="outline" disabled={pending || !(manual[p.employeeId] ?? "").trim()} onClick={() => run(() => setJibblePerson({ employeeId: p.employeeId, jibblePersonId: manual[p.employeeId] }), () => { setManual((m) => ({ ...m, [p.employeeId]: "" })); return "Matched."; })}>
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
              {peopleShown.length === 0 ? <TableRow><TableCell colSpan={4} className="text-muted-foreground">No people match these filters.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
        <ClientPager info={peoplePaged.info} onPage={peoplePaged.setPage} onSize={peoplePaged.setPageSize} label="people" />
      </section>
      </TabsContent>
      </Tabs>
    </div>
  );
}
