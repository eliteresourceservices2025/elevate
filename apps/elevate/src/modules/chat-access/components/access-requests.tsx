"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { EmptyState } from "@/components/empty-state";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { cancelChatAccess, decideChatAccess, requestChatAccess } from "../actions";
import type { AccessItem, Requestable } from "../queries";
import { ACCESS_HOURS } from "../constants";

// The access requests page. HR Admins ask (a chat for some dates, or one recording) and open what was approved; Super Admins decide on
// requests that are not their own. Facts only: the people in a chat and its messages are never shown here.

const STATE: Record<AccessItem["state"], { label: string; className: string }> = {
  pending: { label: "Waiting for a decision", className: "bg-warning-surface text-warning" },
  approved: { label: "Open", className: "bg-success-surface text-success" },
  expired: { label: "Ended", className: "bg-muted text-muted-foreground" },
  lapsed: { label: "Not decided in time", className: "bg-muted text-muted-foreground" },
  denied: { label: "Denied", className: "bg-destructive-surface text-destructive" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

const day = (iso: string, zone: string) => formatInZone(iso, zone, "MMM d, yyyy");
const stamp = (iso: string, zone: string) => formatInZone(iso, zone, "MMM d, h:mm a");

function RequestChat({ chats, today }: { chats: Requestable["chats"]; today: string }) {
  const router = useRouter();
  const dialog = useFormDialog();
  const [pending, startTransition] = useTransition();
  const [conversationId, setConversationId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const ready = conversationId && from && to && from <= to && reason.trim().length >= 10;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        startTransition(async () => {
          const result = await requestChatAccess({ kind: "chat", conversationId, from, to, reason });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Request sent. A Super Admin has to approve it.");
          await dialog?.close(true);
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="access-chat" className="text-sm font-medium">
          Chat
        </label>
        <select id="access-chat" className="h-(--control-h) rounded-lg border bg-background px-2 text-sm" value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
          <option value="">Choose a chat…</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.memberCount} {c.memberCount === 1 ? "person" : "people"})
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Chats you are not in. Direct messages can&apos;t be requested.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="access-from" className="text-sm font-medium">
            First day
          </label>
          <Input id="access-from" type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="access-to" className="text-sm font-medium">
            Last day
          </label>
          <Input id="access-to" type="date" max={today} min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="access-reason" className="text-sm font-medium">
          Why do you need to read it?
        </label>
        <Textarea id="access-reason" rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="text-xs text-muted-foreground">Only the Super Admins who decide, and you, can read this. Up to 90 days at a time.</p>
      </div>
      <Button type="submit" disabled={!ready || pending} className="self-start">
        Send request
      </Button>
    </form>
  );
}

function RequestRecording({ recordings, zone }: { recordings: Requestable["recordings"]; zone: string }) {
  const router = useRouter();
  const dialog = useFormDialog();
  const [pending, startTransition] = useTransition();
  const [recordingId, setRecordingId] = useState("");
  const [reason, setReason] = useState("");
  const ready = recordingId && reason.trim().length >= 10;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        startTransition(async () => {
          const result = await requestChatAccess({ kind: "recording", recordingId, reason });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Request sent. A Super Admin has to approve it.");
          await dialog?.close(true);
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="access-recording" className="text-sm font-medium">
          Recording
        </label>
        <select id="access-recording" className="h-(--control-h) rounded-lg border bg-background px-2 text-sm" value={recordingId} onChange={(e) => setRecordingId(e.target.value)}>
          <option value="">Choose a recording…</option>
          {recordings.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}, {stamp(r.startedAt, zone)}, {r.minutes} min
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Recordings of calls you were not in. Recordings of direct messages can&apos;t be requested.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="access-recording-reason" className="text-sm font-medium">
          Why do you need to watch it?
        </label>
        <Textarea id="access-recording-reason" rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button type="submit" disabled={!ready || pending} className="self-start">
        Send request
      </Button>
    </form>
  );
}

function Card({ item, zone, canDecide }: { item: AccessItem; zone: string; canDecide: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const state = STATE[item.state];
  const what = item.kind === "chat" ? "Messages" : "Recording";
  const when =
    item.kind === "chat" && item.windowFrom && item.windowTo
      ? `${day(item.windowFrom, zone)} to ${day(new Date(new Date(item.windowTo).getTime() - 1000).toISOString(), zone)}`
      : item.recordingStartedAt
        ? stamp(item.recordingStartedAt, zone)
        : "";
  // A Super Admin never decides their own request: the buttons only show for someone else's.
  const mayDecide = canDecide && item.state === "pending" && !item.mine;

  async function decide(approve: boolean) {
    // The question is asked outside the transition: a state change made inside one waits for it to finish, and it would be waiting for the answer.
    const sure = await confirm(
        approve
          ? {
              title: `Open ${item.title} for HR?`,
              description: `${item.requestedByName} will be able to read ${item.kind === "chat" ? `the messages from ${when}` : "this recording"} for ${ACCESS_HOURS} hours, read-only. Everything they open is logged, and the people in the chat are told afterwards if it was used. This can't be undone.`,
              confirmLabel: "Approve",
              cancelLabel: "Not yet",
            }
          : { title: "Deny this request?", description: `${item.requestedByName} will be told it was denied.`, confirmLabel: "Deny", cancelLabel: "Not yet", destructive: true },
    );
    if (!sure) return;
    startTransition(async () => {
      const result = await decideChatAccess({ requestId: item.id, approve, note: note.trim() || undefined });
      if (!result.ok) return void toast.error(result.error);
      toast.success(approve ? "Approved." : "Denied.");
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-card p-4" data-testid="access-request" data-state={item.state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-heading text-base font-semibold">{item.title}</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", state.className)}>{state.label}</span>
        <span className="text-sm text-muted-foreground">
          {what}: {when}
        </span>
        <span className="text-sm text-muted-foreground">{item.memberCount} {item.memberCount === 1 ? "person" : "people"} in the chat</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Asked by {item.mine ? "you" : item.requestedByName} on {stamp(item.requestedAt, zone)}
        {item.decidedByName ? `. ${item.state === "denied" ? "Denied" : "Decided"} by ${item.decidedByName} on ${stamp(item.decidedAt!, zone)}` : ""}.
      </p>
      {item.reason ? (
        <p className="text-sm">
          <span className="font-medium">Reason: </span>
          {item.reason}
        </p>
      ) : null}
      {item.note ? (
        <p className="text-sm">
          <span className="font-medium">Decision note: </span>
          {item.note}
        </p>
      ) : null}
      {item.state === "approved" && item.accessExpiresAt ? <p className="text-sm text-success">Open until {stamp(item.accessExpiresAt, zone)}. Read-only, and every opening is logged.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {item.state === "approved" && item.mine ? (
          <Link href={`/messages/access/${item.id}`} className={buttonVariants({ size: "sm" })}>
            {item.kind === "chat" ? "Read the messages" : "Watch the recording"}
          </Link>
        ) : null}
        {item.state === "pending" && item.mine ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await cancelChatAccess({ requestId: item.id });
                if (!result.ok) return void toast.error(result.error);
                toast.success("Cancelled.");
                router.refresh();
              })
            }
          >
            Cancel request
          </Button>
        ) : null}
        {mayDecide ? (
          <>
            <Input aria-label={`Note about ${item.title} (optional)`} placeholder="Note (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="h-(--control-h-sm) max-w-64" />
            <Button type="button" size="sm" disabled={pending} onClick={() => void decide(true)}>
              Approve
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void decide(false)}>
              Deny
            </Button>
          </>
        ) : null}
        {canDecide && item.state === "pending" && item.mine ? <span className="text-sm text-muted-foreground">You asked for this, so a different Super Admin decides it.</span> : null}
      </div>
    </li>
  );
}

export function AccessRequests({ items, requestable, canRequest, canDecide, today, timeZone }: { items: AccessItem[]; requestable: Requestable | null; canRequest: boolean; canDecide: boolean; today: string; timeZone: string }) {
  const waiting = items.filter((i) => i.state === "pending" && (canDecide ? !i.mine : i.mine));
  const paged = usePaged(items, "", 10);
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">
        <AlertDescription>
          HR can read a chat or watch a recording they are not part of only when an HR Admin asks and a different Super Admin approves. Access is read-only, for the requested days, and lasts {ACCESS_HOURS} hours. Everything is logged, and the people in a chat are told afterwards if their chat was read. Direct messages can&apos;t be requested.
        </AlertDescription>
      </Alert>
      {canRequest && requestable ? (
        <div className="flex flex-wrap gap-2">
          <FormDialog label="Ask to read a chat" title="Ask to read a chat" description="A different Super Admin has to approve this before you can read anything.">
            <RequestChat chats={requestable.chats} today={today} />
          </FormDialog>
          <FormDialog label="Ask to watch a recording" title="Ask to watch a recording" variant="outline" description="A different Super Admin has to approve this before you can watch it.">
            <RequestRecording recordings={requestable.recordings} zone={timeZone} />
          </FormDialog>
        </div>
      ) : null}
      {canDecide && waiting.length > 0 ? (
        <p className="text-sm font-medium" role="status">
          {waiting.length} {waiting.length === 1 ? "request is" : "requests are"} waiting for your decision.
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="No requests" description={canRequest ? "When you ask to read a chat or watch a recording, it appears here." : "When HR asks to read a chat or watch a recording, it appears here for you to decide."} />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {paged.rows.map((item) => (
              <Card key={item.id} item={item} zone={timeZone} canDecide={canDecide} />
            ))}
          </ul>
          <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="requests" />
        </>
      )}
    </div>
  );
}
