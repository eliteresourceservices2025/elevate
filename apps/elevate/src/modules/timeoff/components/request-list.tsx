"use client";

import { useRouter } from "next/navigation";
import { ClientPager, usePaged } from "@/components/client-pager";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateOnly } from "@/lib/time";
import { formatDays } from "../ledger";
import { cancelRequest, decideRequest, getLeaveInvite } from "../request-actions";
import type { RequestItem } from "../request-queries";

const STATUS: Record<RequestItem["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending_lead: { label: "Waiting for lead", variant: "secondary" },
  pending_hr: { label: "Waiting for HR", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  declined: { label: "Declined", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

const STEP_TEXT = { approved: "approved", declined: "declined", escalated: "did not answer in time, so it went to HR" } as const;

function RequestCard({ item, showPerson }: { item: RequestItem; showPerson: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const status = STATUS[item.status];
  const range = item.startDate === item.endDate ? formatDateOnly(item.startDate) : `${formatDateOnly(item.startDate)} to ${formatDateOnly(item.endDate)}`;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      setNote("");
      router.refresh();
    });

  function download() {
    startTransition(async () => {
      const result = await getLeaveInvite({ requestId: item.id });
      if (!result.ok) return void toast.error(result.error);
      const url = URL.createObjectURL(new Blob([result.data.content], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.data.fileName;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <li className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {showPerson ? (
          <span className="font-semibold">
            {item.employeeName} <span className="font-normal text-muted-foreground">{item.employeeNumber}</span>
          </span>
        ) : null}
        <span className="font-medium">{range}</span>
        <span className="text-muted-foreground">
          {formatDays(item.days)}
          {item.halfDay ? " (half day)" : ""} · {item.leaveTypeName}
        </span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      {item.note ? <p className="text-sm">{item.note}</p> : null}
      {item.steps.length > 0 || item.cancelReason ? (
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          {item.steps.map((s, i) => (
            <li key={i}>
              {s.by === "System" ? "The lead" : s.level === "lead" ? `${s.by === "You" ? "You" : "The lead"}` : s.by === "You" ? "You (HR)" : "HR"} {STEP_TEXT[s.decision]}
              {s.note ? `: ${s.note}` : ""}
            </li>
          ))}
          {item.cancelReason ? <li>Cancelled: {item.cancelReason}</li> : null}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        {item.canDecide ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`note-${item.id}`} className="text-xs">
                Note (needed to decline)
              </Label>
              <Input id={`note-${item.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="w-64" />
            </div>
            <Button size="sm" disabled={pending} onClick={() => run(() => decideRequest({ requestId: item.id, decision: "approve", note }), "Approved.")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideRequest({ requestId: item.id, decision: "decline", note }), "Declined.")}>
              Decline
            </Button>
          </>
        ) : null}
        {item.status === "approved" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={download}>
            Add to calendar
          </Button>
        ) : null}
        {item.canCancel ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Cancel this request?") && run(() => cancelRequest({ requestId: item.id }), "Request cancelled.")}>
            Cancel request
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function RequestList({ items, showPerson = false, empty }: { items: RequestItem[]; showPerson?: boolean; empty: string }) {
  const paged = usePaged(items, "", 10);
  if (items.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {paged.rows.map((i) => (
          <RequestCard key={i.id} item={i} showPerson={showPerson} />
        ))}
      </ul>
      <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="requests" />
    </div>
  );
}
