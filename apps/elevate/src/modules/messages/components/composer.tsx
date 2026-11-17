"use client";

import { SendHorizontal } from "lucide-react";
import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendChatMessage } from "../actions";
import { MAX_BODY } from "../validators";

const COUNTER_FROM = 3500;

export function Composer({ conversationId, label, onSent }: { conversationId: string; label: string; onSent: () => void }) {
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);
  const tooLong = draft.length > MAX_BODY;
  const canSend = draft.trim().length > 0 && !tooLong && !pending;

  function send() {
    if (!canSend) return;
    const body = draft;
    startTransition(async () => {
      const result = await sendChatMessage({ conversationId, body });
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

  return (
    <div className="border-t p-3">
      <div className="flex items-end gap-2">
        <label htmlFor="chat-composer" className="sr-only">
          Message {label}
        </label>
        <Textarea
          id="chat-composer"
          ref={field}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={`Message ${label}`}
          aria-invalid={tooLong}
          className="max-h-40 min-h-12 resize-none"
        />
        <Button type="button" onClick={send} disabled={!canSend} aria-label="Send message">
          <SendHorizontal aria-hidden />
          Send
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Enter to send, Shift+Enter for a new line. Don&apos;t share client or patient details here.</span>
        {draft.length >= COUNTER_FROM ? (
          <span className={tooLong ? "font-semibold text-destructive" : undefined} aria-live="polite">
            {draft.length} / {MAX_BODY}
          </span>
        ) : null}
      </div>
    </div>
  );
}
