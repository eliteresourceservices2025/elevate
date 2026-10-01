"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/time";
import { decideCorrectionBatch, fileBulkCorrections, type BulkResult } from "../actions";
import type { CorrectionBatch } from "../queries";

const ZONES = ["Asia/Manila", "America/Phoenix", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "UTC"];
const EXAMPLE = "email,type,time\nana.reyes@example.com,clock_in,2026-10-05 21:00\nana.reyes@example.com,clock_out,2026-10-06 05:00";

/** HR: file missing clock events for many people at once (an outage), and decide a batch another HR admin filed. */
export function BulkCorrectionsPanel({ batches }: { batches: CorrectionBatch[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [csv, setCsv] = useState("");
  const [zone, setZone] = useState("Asia/Manila");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"forgot" | "connection_problem" | "device_problem" | "other">("other");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const run = <T,>(fn: () => Promise<{ ok: boolean; error?: string; data?: T }>, success: (data: T | undefined) => string, after?: (data: T | undefined) => void) =>
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) return void toast.error(r.error ?? "Something went wrong.");
        toast.success(success(r.data));
        after?.(r.data);
        router.refresh();
      } catch {
        toast.error("No connection. Nothing was sent. Try again.");
      }
    });

  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run<BulkResult>(
            () => fileBulkCorrections({ csv, timeZone: zone, reason, kind }),
            (d) => `Filed ${d?.created ?? 0} ${(d?.created ?? 0) === 1 ? "correction" : "corrections"}. Another HR admin decides them.`,
            (d) => {
              setResult(d ?? null);
              if (d && d.failed.length === 0 && d.parseErrors.length === 0) setCsv("");
            },
          );
        }}
      >
        <h3 className="font-semibold">File many corrections from a spreadsheet</h3>
        <p className="text-sm text-muted-foreground">
          For an outage or when many people are missing events. One row per event with the columns <code>email</code>, <code>type</code> (clock_in, clock_out, break_start, break_end) and <code>time</code> (like 2026-10-05 21:00, in the time zone you choose). Each person gets an ordinary correction request with the same checks. A different HR admin approves
          the whole batch, never the one who filed it. Jibble&apos;s timesheet can be the source of the times.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="bc-csv">Spreadsheet (paste the CSV text, or choose a file)</Label>
          <Textarea id="bc-csv" rows={7} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={EXAMPLE} className="font-mono text-xs" />
          <input
            aria-label="Choose a CSV file"
            type="file"
            accept=".csv,text/csv"
            className="block text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setCsv(await file.text());
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField id="bc-zone" label="Times are in" list="bc-zones" value={zone} onChange={(e) => setZone(e.target.value)} required />
          <datalist id="bc-zones">
            {ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <SelectField id="bc-kind" label="Why?" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="other">Something else</option>
            <option value="connection_problem">Connection or outage</option>
            <option value="device_problem">Device problem</option>
            <option value="forgot">Forgot</option>
          </SelectField>
          <TextField id="bc-reason" label="Reason (everyone is told)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
        </div>
        <Button type="submit" disabled={pending || csv.trim().length < 10 || !reason.trim()}>
          File the batch
        </Button>
      </form>

      {result ? (
        <div role="status" className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          <p>
            <strong>{result.created}</strong> {result.created === 1 ? "person was" : "people were"} filed. {result.failed.length + result.parseErrors.length > 0 ? "These rows were not filed:" : ""}
          </p>
          {result.parseErrors.length > 0 || result.failed.length > 0 ? (
            <ul className="list-disc pl-5">
              {result.parseErrors.map((p) => (
                <li key={`l${p.line}`}>
                  Line {p.line}: {p.message}
                </li>
              ))}
              {result.failed.map((f) => (
                <li key={f.email}>
                  {f.email}: {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Batches waiting" className="space-y-2">
        <h3 className="font-semibold">Batches waiting for a decision</h3>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No batches are waiting.</p>
        ) : (
          <ul className="space-y-3">
            {batches.map((b) => (
              <li key={b.batchId} className="space-y-2 rounded-xl border bg-card p-4">
                <p className="text-sm">
                  <strong>{b.waiting}</strong> {b.waiting === 1 ? "correction" : "corrections"} for {b.people} {b.people === 1 ? "person" : "people"}, filed by {b.filedBy} on {formatInZone(b.createdAt, undefined, "MMM d, h:mm a")}.
                  <span className="block text-muted-foreground">{b.reason}</span>
                </p>
                {b.mine ? (
                  <p className="text-xs text-muted-foreground">You filed this batch, so another HR admin must decide it.</p>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`bn-${b.batchId}`} className="text-xs">
                        Note (needed to reject)
                      </Label>
                      <input id={`bn-${b.batchId}`} className="h-8 w-64 rounded-lg border bg-background px-2 text-sm" maxLength={300} value={notes[b.batchId] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [b.batchId]: e.target.value }))} />
                    </div>
                    <Button size="sm" disabled={pending} onClick={() => run<{ done: number; failed: string[] }>(() => decideCorrectionBatch({ batchId: b.batchId, decision: "approve", note: notes[b.batchId] }), (d) => `Approved ${d?.done ?? 0}.${d?.failed.length ? ` Some could not be applied: ${d.failed.join(" ")}` : ""}`)}>
                      Approve all
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run<{ done: number; failed: string[] }>(() => decideCorrectionBatch({ batchId: b.batchId, decision: "reject", note: notes[b.batchId] }), (d) => `Rejected ${d?.done ?? 0}.`)}>
                      Reject all
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
