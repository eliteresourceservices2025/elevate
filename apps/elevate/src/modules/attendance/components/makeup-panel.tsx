"use client";

import { useState } from "react";
import { fromZonedTime } from "date-fns-tz";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { cancelMakeup, decideMakeup, requestMakeup } from "../makeup-actions";
import type { MakeupItem, MyMakeup } from "../makeup-queries";
import { formatDuration, MINUTE } from "../clock";
import { useRun } from "./use-run";

const STATUS_TEXT: Record<string, string> = { pending: "Waiting for approval", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };
const STATUS_VARIANT = new Map<string, "default" | "secondary" | "outline" | "destructive">([["pending", "secondary"], ["approved", "default"], ["declined", "destructive"], ["cancelled", "outline"]]);

const when = (item: MakeupItem, zone: string) => `${formatInZone(Date.parse(item.windowStart), zone, "EEE MMM d, h:mm a")} to ${formatInZone(Date.parse(item.windowEnd), zone, "h:mm a")}`;

function ItemRow({ item, zone, onCancel, onDecide, pending }: { item: MakeupItem; zone: string; onCancel?: () => void; onDecide?: (decision: "approve" | "decline") => void; pending: boolean }) {
  return (
    <li className="space-y-1 rounded-lg border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.employeeName}</span>
        <Badge variant={STATUS_VARIANT.get(item.status) ?? "outline"}>{STATUS_TEXT[item.status] ?? item.status}</Badge>
      </div>
      <p>
        {when(item, zone)} ({formatDuration(item.minutes * MINUTE)}) to make up for {formatDateOnly(item.absenceDate)}, {formatDuration(item.missedMinutes * MINUTE)} short.
      </p>
      <p className="text-muted-foreground">{item.reason}</p>
      {item.status === "approved" && item.madeUpMinutes > 0 ? <p className="text-muted-foreground">Made up so far: {formatDuration(item.madeUpMinutes * MINUTE)}.</p> : null}
      {item.decisionNote ? <p className="text-muted-foreground">Note: {item.decisionNote}</p> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {item.canDecide && onDecide ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => onDecide("approve")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => onDecide("decline")}>
              Decline
            </Button>
          </>
        ) : null}
        {item.canCancel && onCancel ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function RequestForm({ mine }: { mine: MyMakeup }) {
  const { run, pending } = useRun();
  const [absence, setAbsence] = useState(mine.days[0]?.date ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const day = mine.days.find((d) => d.date === absence);
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            requestMakeup({
              absenceDate: absence,
              windowStart: fromZonedTime(start, mine.zone).toISOString(),
              windowEnd: fromZonedTime(end, mine.zone).toISOString(),
              reason,
            }),
          () => "Sent for approval.",
          () => {
            setStart("");
            setEnd("");
            setReason("");
          },
        );
      }}
    >
      <h2 className="text-lg font-semibold">Ask to make up missed hours</h2>
      {mine.days.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no missed hours from the last 31 days to make up. Only days with scheduled hours that were not fully worked show here.</p>
      ) : (
        <>
          <SelectField id="mk-day" label="The day you are making up for" value={absence} onChange={(e) => setAbsence(e.target.value)} required>
            {mine.days.map((d) => (
              <option key={d.date} value={d.date}>
                {formatDateOnly(d.date)}: {formatDuration(d.leftMinutes * MINUTE)} left to make up
              </option>
            ))}
          </SelectField>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id="mk-start" label="Starts" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required hint={`In your time zone (${mine.zone}). Ask before you work it.`} />
            <TextField id="mk-end" label="Ends" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required hint={day ? `Up to ${formatDuration(day.leftMinutes * MINUTE)}.` : undefined} />
          </div>
          <TextField id="mk-reason" label="Why were you away?" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} />
          <p className="text-xs text-muted-foreground">Time worked in an approved window counts as regular hours, not extra hours, and is credited to the day you missed.</p>
          <Button type="submit" disabled={pending || !absence || !start || !end || reason.trim().length < 5}>
            Send for approval
          </Button>
        </>
      )}
    </form>
  );
}

export function MakeupPanel({ mine, queue }: { mine: MyMakeup | null; queue: { pending: MakeupItem[]; recent: MakeupItem[]; scope: "all" | "team" } | null }) {
  const { run, pending } = useRun();
  const [note, setNote] = useState("");
  const zone = mine?.zone ?? "America/Phoenix";
  return (
    <div className="space-y-6">
      {queue ? (
        <section aria-label="Waiting for your decision" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Waiting for your decision</h2>
          {queue.pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is waiting.</p>
          ) : (
            <>
              <TextField id="mk-note" label="Note for the person (required to decline)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              <ul className="space-y-2">
                {queue.pending.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    zone={zone}
                    pending={pending}
                    onDecide={(decision) => run(() => decideMakeup({ requestId: item.id, decision, note }), () => (decision === "approve" ? "Approved." : "Declined."), () => setNote(""))}
                    onCancel={() => run(() => cancelMakeup({ requestId: item.id }), () => "Cancelled.")}
                  />
                ))}
              </ul>
            </>
          )}
          {queue.recent.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Decided in the last 14 days ({queue.recent.length})</summary>
              <ul className="mt-2 space-y-2">
                {queue.recent.map((item) => (
                  <ItemRow key={item.id} item={item} zone={zone} pending={pending} onCancel={() => run(() => cancelMakeup({ requestId: item.id }), () => "Cancelled.")} />
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {mine ? (
        <>
          <RequestForm mine={mine} />
          <section aria-label="My make-up hours" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 className="text-lg font-semibold">My make-up hours</h2>
            {mine.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">You have not asked to make up any hours yet.</p>
            ) : (
              <ul className="space-y-2">
                {mine.items.map((item) => (
                  <ItemRow key={item.id} item={item} zone={zone} pending={pending} onCancel={() => run(() => cancelMakeup({ requestId: item.id }), () => "Cancelled.")} />
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">You do not have a people record yet, so there are no make-up hours to show. Ask HR.</p>
      )}
    </div>
  );
}
