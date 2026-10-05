"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/run-action";
import { decideCorrection } from "@/modules/attendance/actions";
import { decideExtraHours } from "@/modules/attendance/extra-hours-actions";
import { decideRequest } from "@/modules/timeoff/request-actions";
import { KIND_LABEL, type QueueItem } from "../approvals";

function decide(item: QueueItem, approve: boolean, note?: string): Promise<ActionResult> {
  switch (item.kind) {
    case "time_off":
      return decideRequest({ requestId: item.id, decision: approve ? "approve" : "decline", note });
    case "correction":
      return decideCorrection({ correctionId: item.id, decision: approve ? "approve" : "reject", note });
    case "extra_hours":
      return decideExtraHours({ requestId: item.id, decision: approve ? "approve" : "decline", note });
  }
}

/** One waiting request: approve here when it carries nothing to inspect, decline with a reason, or open the full request. */
export function ApprovalRow({ item, waitedDays }: { item: QueueItem; waitedDays: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  function run(approve: boolean, reason?: string) {
    start(async () => {
      try {
        const result = await decide(item, approve, reason);
        if (!result.ok) return void toast.error(result.error);
        toast.success(approve ? "Approved." : "Declined.");
        setDeclining(false);
        setNote("");
        router.refresh();
      } catch {
        toast.error("Could not reach ELEVATE. Nothing was changed. Try again.");
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {item.who} <span className="font-normal text-muted-foreground">· {KIND_LABEL[item.kind]}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {item.what}
          {waitedDays >= 1 ? ` · waiting ${waitedDays} ${waitedDays === 1 ? "day" : "days"}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {item.inlineApprove ? (
          <Button size="sm" disabled={pending} onClick={() => run(true)}>
            Approve
          </Button>
        ) : (
          <Link href={item.href} className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring">
            Review
          </Link>
        )}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setDeclining(true)}>
          Decline
        </Button>
      </div>

      <Dialog open={declining} onOpenChange={(open) => !pending && setDeclining(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline this request?</DialogTitle>
            <DialogDescription>
              {item.who}: {item.what}. They will be told why, so keep it short and kind.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={`reason-${item.key}`} className="text-sm font-medium">
              Reason
            </label>
            <Textarea id={`reason-${item.key}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
            <Button disabled={pending || note.trim().length === 0} onClick={() => run(false, note.trim())}>
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
