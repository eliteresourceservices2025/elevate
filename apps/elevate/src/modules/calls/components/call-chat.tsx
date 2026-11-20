"use client";

import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadChatMessages, markConversationRead, sendChatMessage } from "@/modules/messages/actions";
import { useChatLive } from "@/modules/messages/components/use-chat-live";
import type { ChatMessage } from "@/modules/messages/queries";
import type { ChatSignal } from "@/modules/messages/realtime-types";

// The call's chat: the SAME conversation the call belongs to (so what is typed here is in the chat afterwards, and the other way round),
// shown beside the picture. Text only here: a picture, file or voice note shows as a line pointing to the chat. Everything goes through
// the ordinary Messages actions (membership and the guest rules are checked there), and live updates come from the shared connection.

const MAX_SHOWN = 60;

function describe(m: ChatMessage): string {
  if (m.deleted) return "Message removed";
  if (m.kind === "text") return m.body ?? "";
  if (m.kind === "gif") return "Sent a GIF";
  if (m.kind === "image") return "Sent a picture";
  if (m.kind === "voice") return "Sent a voice note";
  if (m.kind === "poll") return "Started a poll";
  return "Sent a file";
}

/** Chat beside the call. Stays mounted while the panel is closed so new messages still count (`onNew`) and nothing is missed. */
export function CallChat({ conversationId, userId, open, onNew }: { conversationId: string; userId: string; open: boolean; onNew: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  const request = useRef(0);
  const latestSeq = useRef(0);
  const needFull = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    openRef.current = open;
  });

  /**
   * `full` loads the last messages again (needed when one was edited, removed or reacted to); otherwise only what came after the newest
   * one is fetched, so a busy chat in a big call does not make everyone reload 60 messages for every new one.
   */
  const load = useCallback(async (full = true) => {
    const mine = ++request.current;
    try {
      const after = latestSeq.current;
      const result = await loadChatMessages(full || after === 0 ? { conversationId } : { conversationId, afterSeq: after });
      if (mine !== request.current) return;
      if (!result.ok) return void setError(result.error);
      setError(null);
      latestSeq.current = Math.max(latestSeq.current, result.data.latestSeq);
      setMessages((previous) => (full || after === 0 ? result.data.messages : [...previous, ...result.data.messages.filter((m) => !previous.some((p) => p.id === m.id))]).slice(-MAX_SHOWN));
      // Looking at it (the tab is in front and the panel is open): it counts as read, so the chat list does not show these as unread.
      if (openRef.current && document.visibilityState === "visible" && document.hasFocus() && latestSeq.current > 0) void markConversationRead({ conversationId, seq: latestSeq.current }).catch(() => {});
    } catch {
      if (mine === request.current) setError("Couldn't load the chat. It will try again.");
    }
  }, [conversationId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useChatLive(
    userId,
    useCallback(
      (signal: ChatSignal) => {
        if (signal.conversationId !== conversationId || signal.type === "call" || signal.type === "read") return;
        if (signal.type === "message" && signal.senderUserId && signal.senderUserId !== userId && !openRef.current) onNew();
        // Several signals in a moment become one load (the strongest kind wins: an edit or removal needs the full list).
        if (signal.type !== "message") needFull.current = true;
        if (timer.current) return;
        timer.current = setTimeout(() => {
          timer.current = null;
          const full = needFull.current;
          needFull.current = false;
          void load(full);
        }, 700);
      },
      [conversationId, userId, load, onNew],
    ),
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Opening the panel marks what is there as read; the newest message is kept in view.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [open, load]);
  useEffect(() => {
    // Scroll the chat's own box, never the page (scrollIntoView would also pull the whole page down to the newest message).
    const log = end.current?.parentElement;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length, open]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const result = await sendChatMessage({ conversationId, body });
      if (!result.ok) return void setError(result.error);
      setDraft("");
      setError(null);
      await load(false);
    } catch {
      setError("Couldn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", !open && "hidden")} data-testid="call-chat">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" role="log" aria-label="Call chat" aria-live="polite">
        {messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet. What you write here is in the chat too.</p> : null}
        {messages.map((m) =>
          m.kind === "system" ? (
            <p key={m.id} className="text-center text-xs text-muted-foreground">
              {m.body}
            </p>
          ) : (
            <div key={m.id} className={cn("flex max-w-[90%] flex-col gap-0.5", m.senderUserId === userId ? "items-end self-end" : "items-start")}>
              {m.senderUserId === userId ? null : <span className="text-xs text-muted-foreground">{m.senderName}</span>}
              <span className={cn("rounded-2xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap", m.senderUserId === userId ? "bg-primary text-primary-foreground" : "bg-muted", m.deleted || m.kind !== "text" ? "italic opacity-80" : "")}>{describe(m)}</span>
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      {error ? (
        <p role="alert" className="px-3 pb-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <form
        className="flex items-center gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="call-chat-input" className="sr-only">
          Message the call
        </label>
        <input
          id="call-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          placeholder="Message the call"
          autoComplete="off"
          className="h-(--control-h-sm) min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
        />
        <Button type="submit" size="icon-sm" disabled={sending || draft.trim().length === 0} aria-label="Send message">
          <Send aria-hidden />
        </Button>
      </form>
    </div>
  );
}
