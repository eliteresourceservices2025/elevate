"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/time";
import { retryJibbleSend, setJibblePerson, syncJibblePeopleNow, testJibbleConnection } from "../actions";
import type { JibbleOverview } from "../queries";

const BREAK_TEXT = { clock: "Breaks stop screenshots (clock out and back in)", native: "Breaks use Jibble's own break entries", off: "Breaks are not sent (screenshots keep running)" } as const;
const STATUS_VARIANT = new Map<string, "default" | "secondary" | "outline" | "destructive">([["sent", "default"], ["queued", "secondary"], ["failed", "destructive"], ["skipped", "outline"]]);

/** The Jibble tab for HR: is it connected, who is matched, what was sent. Screenshots themselves stay in Jibble. */
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
  return (
    <div className="space-y-6">
      <section aria-label="Connection" className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Jibble</h2>
          <Badge variant={overview.configured ? "default" : "destructive"}>{overview.configured ? "Token set" : "Not set up"}</Badge>
          <Badge variant="outline">{overview.mode === "mirror" ? "ELEVATE starts and stops Jibble" : "Fallback: people clock into both apps"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          ELEVATE is the time clock and the only source of hours. Jibble is used only for screenshots; they stay in Jibble and are never copied here. {BREAK_TEXT[overview.breakMode]}. Mirroring works for a team once the monitoring
          policy is published{overview.monitoringPublished ? " (it is)" : " (it is not yet)"} and the switch for the team is on in the Rules tab ({overview.teamsOn} {overview.teamsOn === 1 ? "team is" : "teams are"} on). Each night ELEVATE compares totals and flags days that differ by more than {overview.toleranceMinutes} minutes.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending || !overview.configured} onClick={() => run(() => testJibbleConnection(), (d) => `Connected. Jibble has ${(d as { people: number }).people} people.`)}>
            Test connection
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
          <div className="overflow-x-auto rounded-xl border bg-card">
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
                {overview.log.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{formatInZone(l.createdAt, undefined, "MMM d, h:mm a")}</TableCell>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell>{l.action}</TableCell>
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
      </section>

      <section aria-label="People" className="space-y-2">
        <h2 className="text-lg font-semibold">
          People <span className="text-sm font-normal text-muted-foreground">({overview.people.length - unmatched.length} matched, {unmatched.length} not matched)</span>
        </h2>
        <p className="text-sm text-muted-foreground">Matched automatically by work email. If someone uses a different email in Jibble, paste their Jibble person id to match them by hand. People with no match are skipped.</p>
        <div className="overflow-x-auto rounded-xl border bg-card">
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
              {overview.people.map((p) => (
                <TableRow key={p.employeeId}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.team ?? "No team"}</TableCell>
                  <TableCell>{p.jibblePersonId ? <Badge variant="default">Matched by {p.matchedBy}</Badge> : <Badge variant="outline">Not matched</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`jp-${p.employeeId}`} className="sr-only">
                        Jibble person id for {p.name}
                      </Label>
                      <Input id={`jp-${p.employeeId}`} className="h-8 w-64" placeholder="Jibble person id" value={manual[p.employeeId] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [p.employeeId]: e.target.value }))} />
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
      </section>
    </div>
  );
}
