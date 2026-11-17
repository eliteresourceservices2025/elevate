"use client";

import { ArrowLeft, Pencil, Trash2, Users } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/feedback-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { deleteChatMessage, editChatMessage } from "../actions";
import type { ChatMessage, ConversationSummary } from "../queries";
import { MAX_BODY } from "../validators";
import { Composer } from "./composer";
import { ConversationAvatar } from "./conversation-list";

export type ThreadMember = { userId: string; name: string; lastReadSeq: number };

const GROUP_GAP_MS = 5 * 60_000;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

function dayLabel(iso: string, zone: string, now = new Date()): string {
  const day = formatInZone(iso, zone, "yyyy-MM-dd");
  if (day === formatInZone(now, zone, "yyyy-MM-dd")) return "Today";
  if (day === formatInZone(new Date(now.getTime() - 86_400_000), zone, "yyyy-MM-dd")) return "Yesterday";
  return formatInZone(iso, zone, "EEEE, MMM d, yyyy");
}

export function Thread({
  conversation,
  messages,
  hasMore,
  members,
  myUserId,
  timeZone,
  loadingEarlier,
  onLoadEarlier,
  onBack,
  onChanged,
  onToggleDetails,
}: {
  conversation: ConversationSummary;
  messages: ChatMessage[];
  hasMore: boolean;
  members: ThreadMember[];
  myUserId: string;
  timeZone: string;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  onBack: () => void;
  onChanged: () => void;
  onToggleDetails: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastId = messages.at(-1)?.id;

  // Follow new messages only while the person is already at the bottom (never yank them away from what they are reading).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, conversation.id]);
  useEffect(() => {
    stickToBottom.current = true;
  }, [conversation.id]);

  const otherRead = useMemo(() => {
    if (conversation.kind !== "dm") return null;
    return members.find((m) => m.userId !== myUserId)?.lastReadSeq ?? 0;
  }, [conversation.kind, members, myUserId]);
  const lastOwnSeq = useMemo(() => [...messages].reverse().find((m) => m.senderUserId === myUserId && !m.deleted && m.kind === "text")?.seq ?? null, [messages, myUserId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <Button type="button" variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back to chats">
          <ArrowLeft aria-hidden />
        </Button>
        <ConversationAvatar conversation={conversation} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-base font-semibold">{conversation.title}</h2>
          <p className="truncate text-xs text-muted-foreground">{conversation.kind === "group" ? `${conversation.memberCount} people` : "Direct message"}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onToggleDetails} aria-label="Show people in this chat">
          <Users aria-hidden />
          <span className="hidden sm:inline">People</span>
        </Button>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {hasMore ? (
          <div className="flex justify-center py-2">
            <Button type="button" variant="outline" size="sm" onClick={onLoadEarlier} disabled={loadingEarlier}>
              {loadingEarlier ? "Loading…" : "Load earlier messages"}
            </Button>
          </div>
        ) : null}
        <div role="log" aria-live="polite" aria-label={`Messages with ${conversation.title}`} className="flex flex-col">
          {messages.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p> : null}
          {messages.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              previous={messages[i - 1] ?? null}
              mine={m.senderUserId === myUserId}
              timeZone={timeZone}
              status={m.seq === lastOwnSeq && otherRead !== null ? (otherRead >= m.seq ? "Seen" : "Sent") : null}
              onChanged={onChanged}
            />
          ))}
        </div>
      </div>

      <Composer conversationId={conversation.id} label={conversation.title} onSent={onChanged} />
    </div>
  );
}

function MessageRow({ message: m, previous, mine, timeZone, status, onChanged }: { message: ChatMessage; previous: ChatMessage | null; mine: boolean; timeZone: string; status: string | null; onChanged: () => void }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body ?? "");
  const [pending, startTransition] = useTransition();

  const newDay = !previous || formatInZone(previous.createdAt, timeZone, "yyyy-MM-dd") !== formatInZone(m.createdAt, timeZone, "yyyy-MM-dd");
  const grouped = !newDay && previous && previous.kind === "text" && m.kind === "text" && previous.senderUserId === m.senderUserId && new Date(m.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_GAP_MS;

  function save() {
    startTransition(async () => {
      const result = await editChatMessage({ messageId: m.id, body: draft });
      if (!result.ok) return void toast.error(result.error);
      setEditing(false);
      onChanged();
    });
  }

  async function remove() {
    const ok = await confirm({ title: "Remove this message?", description: "It disappears for everyone in this chat.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteChatMessage({ messageId: m.id });
      if (!result.ok) return void toast.error(result.error);
      onChanged();
    });
  }

  return (
    <>
      {newDay ? (
        <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground" role="separator">
          <span className="h-px flex-1 bg-border" />
          {dayLabel(m.createdAt, timeZone)}
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      {m.kind === "system" ? (
        <p className="my-1 self-center rounded-full bg-muted px-3 py-0.5 text-xs text-muted-foreground">{m.body}</p>
      ) : (
        <div className={cn("group flex gap-2", grouped ? "mt-0.5" : "mt-3", mine ? "flex-row-reverse" : "flex-row")}>
          <div className="w-8 shrink-0">
            {!grouped && !mine ? (
              <Avatar size="sm">
                <AvatarFallback className="bg-secondary text-[0.65rem] font-semibold text-secondary-foreground">{initials(m.senderName)}</AvatarFallback>
              </Avatar>
            ) : null}
          </div>
          <div className={cn("flex max-w-[78%] flex-col gap-0.5", mine ? "items-end" : "items-start")}>
            {!grouped ? (
              <p className="text-xs text-muted-foreground">
                {!mine ? <span className="font-semibold text-foreground">{m.senderName}</span> : null} {formatInZone(m.createdAt, timeZone, "h:mm a")}
              </p>
            ) : null}
            {m.deleted ? (
              <p className="rounded-2xl border border-dashed px-3 py-1.5 text-sm text-muted-foreground italic">This message was removed</p>
            ) : editing ? (
              <div className="flex w-72 max-w-full flex-col gap-2">
                <label htmlFor={`edit-${m.id}`} className="sr-only">
                  Edit your message
                </label>
                <Textarea id={`edit-${m.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={MAX_BODY} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={save} disabled={pending || !draft.trim()}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                {mine ? (
                  <span className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit message" onClick={() => { setDraft(m.body ?? ""); setEditing(true); }}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove message" onClick={remove} disabled={pending}>
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                ) : null}
                <p className={cn("rounded-2xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap", mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card")}>{m.body}</p>
              </div>
            )}
            {m.edited && !m.deleted ? <span className="text-[0.7rem] text-muted-foreground">edited</span> : null}
            {status ? <span className="text-[0.7rem] text-muted-foreground">{status}</span> : null}
          </div>
        </div>
      )}
    </>
  );
}
