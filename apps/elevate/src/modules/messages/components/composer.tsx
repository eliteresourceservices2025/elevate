"use client";

import { AtSign, SendHorizontal } from "lucide-react";
import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendChatMessage } from "../actions";
import { mentionToken } from "../mentions";
import { MAX_BODY } from "../validators";
import { EmojiPicker } from "./emoji-picker";

const COUNTER_FROM = 3500;

/**
 * The message box. `members` fills the @mention list; `threadRootId` makes it a thread reply; `restricted` shows why a person cannot post
 * (a channel only HR posts in).
 */
export function Composer({
  conversationId,
  label,
  onSent,
  members = [],
  threadRootId,
  restricted = false,
  idSuffix = "",
}: {
  conversationId: string;
  label: string;
  onSent: () => void;
  members?: { userId: string; name: string }[];
  threadRootId?: string;
  restricted?: boolean;
  idSuffix?: string;
}) {
  const [draft, setDraft] = useState("");
  const [mentioning, setMentioning] = useState(false);
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);
  const tooLong = draft.length > MAX_BODY;
  const canSend = draft.trim().length > 0 && !tooLong && !pending;

  function send() {
    if (!canSend) return;
    const body = draft;
    startTransition(async () => {
      const result = await sendChatMessage({ conversationId, body, threadRootId });
      if (!result.ok) return void toast.error(result.error);
      setDraft("");
      onSent();
      field.current?.focus();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function insert(text: string) {
    setDraft((d) => (d && !d.endsWith(" ") && !d.endsWith("\n") ? `${d} ${text}` : `${d}${text}`));
    field.current?.focus();
  }

  if (restricted) {
    return <div className="border-t p-3 text-center text-sm text-muted-foreground">Only HR can post in this channel. You can react and reply in a thread.</div>;
  }

  return (
    <div className="border-t p-3">
      <div className="flex items-end gap-2">
        <label htmlFor={`chat-composer${idSuffix}`} className="sr-only">
          {threadRootId ? "Reply in thread" : `Message ${label}`}
        </label>
        <Textarea
          id={`chat-composer${idSuffix}`}
          ref={field}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={threadRootId ? "Reply in thread" : `Message ${label}`}
          aria-invalid={tooLong}
          className="max-h-40 min-h-12 resize-none"
        />
        <Button type="button" onClick={send} disabled={!canSend} aria-label={threadRootId ? "Send reply" : "Send message"}>
          <SendHorizontal aria-hidden />
          Send
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <EmojiPicker onPick={insert} label="Add an emoji to your message" />
        {members.length > 0 ? (
          <span className="relative inline-flex">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Mention someone" aria-expanded={mentioning} onClick={() => setMentioning((v) => !v)}>
              <AtSign aria-hidden />
            </Button>
            {mentioning ? (
              <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-56 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
                {members.map((m) => (
                  <li key={m.userId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => {
                        insert(`${mentionToken(m.name, m.userId)} `);
                        setMentioning(false);
                      }}
                    >
                      {m.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">Enter to send, Shift+Enter for a new line. Don&apos;t share client or patient details here.</span>
        {draft.length >= COUNTER_FROM ? (
          <span className={tooLong ? "font-semibold text-destructive" : undefined} aria-live="polite">
            {draft.length} / {MAX_BODY}
          </span>
        ) : null}
      </div>
    </div>
  );
}
