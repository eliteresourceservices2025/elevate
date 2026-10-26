"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_TIMEZONE, SECONDARY_TIMEZONE, formatDateOnly, formatInZone } from "@/lib/time";
import { popupStartsAt } from "../popup-schedule";
import { movePopup, setPopup } from "../popup-actions";
import type { PopupQueueRow } from "../popup-queries";

function PopupForm({ kind, itemId, current, today }: { kind: "announcement" | "policy"; itemId: string; current: { showFrom: string } | null; today: string }) {
  const router = useRouter();
  const dialog = useFormDialog();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(current !== null);
  const [showFrom, setShowFrom] = useState(current?.showFrom ?? today);
  const startsAt = popupStartsAt(showFrom);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const result = await setPopup({ kind, itemId, enabled, showFrom });
            if (!result.ok) return void toast.error(result.error);
            toast.success(enabled ? "Queued as a pop-up." : "Taken out of the pop-up queue.");
            dialog?.close(true);
            router.refresh();
          } catch {
            toast.error("No connection. Try again.");
          }
        });
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Show this as a pop-up when people sign in
      </label>
      {enabled ? (
        <div className="space-y-1">
          <Label htmlFor="popup-from">Show from (Phoenix date)</Label>
          <Input id="popup-from" type="date" value={showFrom} onChange={(e) => setShowFrom(e.target.value)} required className="max-w-48" />
          <p className="text-xs text-muted-foreground">Starts at midnight in {DEFAULT_TIMEZONE}.</p>
          {startsAt ? <p className="text-sm">In Manila: <strong>{formatInZone(startsAt, SECONDARY_TIMEZONE, "MMM d, yyyy, h:mm a")}</strong>.</p> : null}
          <p className="text-xs text-muted-foreground">
            It joins the end of the line. Change the order under Announcements, Pop-up queue. {kind === "policy" ? "A new published version pops up again for everyone." : ""}
          </p>
        </div>
      ) : null}
      <Button type="submit" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

/** On an announcement's or policy's own page (HR): put it in the sign-in pop-up queue, or take it out, and say from when. */
export function PopupControl({ kind, itemId, current, today }: { kind: "announcement" | "policy"; itemId: string; current: { showFrom: string } | null; today: string }) {
  return (
    <FormDialog
      label={current ? `Pop-up: from ${formatDateOnly(current.showFrom)}` : "Show as a pop-up"}
      title="Sign-in pop-up"
      description="Eligible recipients see queued items one at a time when they sign in. An item they already acknowledged or closed is not shown again. Changing its start date does not reset that history."
      variant="outline"
    >
      <PopupForm kind={kind} itemId={itemId} current={current} today={today} />
      {kind === "announcement" ? <p className="text-xs text-muted-foreground">Only the announcement&apos;s original recipients see it. The account that posted it is not a recipient.</p> : null}
    </FormDialog>
  );
}

/** HR: the whole queue in the order people see it, with a place to move or remove each. */
export function PopupQueueAdmin({ rows }: { rows: PopupQueueRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const move = (popupId: string, direction: "up" | "down") =>
    start(async () => {
      try {
        const result = await movePopup({ popupId, direction });
        if (!result.ok) return void toast.error(result.error);
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  const remove = (row: PopupQueueRow) =>
    start(async () => {
      try {
        const result = await setPopup({ kind: row.kind, itemId: row.itemId, enabled: false });
        if (!result.ok) return void toast.error(result.error);
        toast.success("Taken out of the pop-up queue.");
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  return (
    <section aria-label="Pop-up queue" className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Eligible recipients see these one at a time, in this order, starting on their date in {DEFAULT_TIMEZONE}. Live means that date has started; previously acknowledged or closed items stay hidden for that person. After the last one, new accounts get the quick tour.
        Add an item from its own page with &quot;Show as a pop-up&quot;.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">Nothing is queued.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.popupId} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
              <span className="w-6 text-center text-sm font-semibold text-muted-foreground">{r.position}</span>
              <div className="min-w-0 flex-1">
                <Link href={r.kind === "announcement" ? `/announcements/${r.itemId}` : `/announcements/policies/${r.itemId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {r.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {r.kind === "policy" ? "Policy" : "Announcement"} · from {formatDateOnly(r.showFrom)} · {r.requiresAck ? "needs acknowledgment" : "can be closed"}
                </p>
              </div>
              <Badge variant={r.state === "live" ? "default" : "outline"}>{r.state === "live" ? "Showing" : "Scheduled"}</Badge>
              <div className="flex gap-1">
                <Button type="button" size="icon-sm" variant="outline" aria-label={`Move ${r.title} earlier`} disabled={pending || i === 0} onClick={() => move(r.popupId, "up")}>
                  <ArrowUp />
                </Button>
                <Button type="button" size="icon-sm" variant="outline" aria-label={`Move ${r.title} later`} disabled={pending || i === rows.length - 1} onClick={() => move(r.popupId, "down")}>
                  <ArrowDown />
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => remove(r)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
