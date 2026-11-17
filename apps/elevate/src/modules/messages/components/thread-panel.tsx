"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadChatThread } from "../actions";
import type { ChatMessage } from "../queries";
import { Composer } from "./composer";
import { MessageRow, type ThreadMember } from "./thread";

type Data = { root: ChatMessage; replies: ChatMessage[] };

/** The replies to one message, beside the chat. Reloads when `version` changes (a live signal or a change made here). */
export function ThreadPanel({
  conversationId,
  conversationTitle,
  rootId,
  members,
  myUserId,
  timeZone,
  version,
  onClose,
  onChanged,
}: {
  conversationId: string;
  conversationTitle: string;
  rootId: string;
  members: ThreadMember[];
  myUserId: string;
  timeZone: string;
  version: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reload, setReload] = useState(0);

  // Loads (and reloads when a live signal or a change here bumps a counter). The answer is ignored if the panel moved on meanwhile.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await loadChatThread({ conversationId, rootId });
        if (cancelled) return;
        if (result.ok) {
          setError(null);
          setData(result.data);
        } else setError(result.error);
      } catch {
        if (!cancelled) setError("Could not reach ELEVATE. Check your connection and try again.");
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conversationId, rootId, version, reload]);

  const changed = () => {
    setReload((v) => v + 1);
    onChanged();
  };

  return (
    <aside aria-label="Thread" className="flex w-full shrink-0 flex-col border-l md:w-80">
      <div className="flex items-center justify-between border-b p-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold">Thread</h3>
          <p className="truncate text-xs text-muted-foreground">{conversationTitle}</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close thread">
          <X aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {error ? <p className="py-6 text-sm text-destructive">{error}</p> : null}
        {!data && !error ? (
          <p className="py-6 text-sm text-muted-foreground" role="status">
            Loading…
          </p>
        ) : null}
        {data ? (
          <div className="flex flex-col">
            <MessageRow message={data.root} previous={null} mine={data.root.senderUserId === myUserId} myUserId={myUserId} timeZone={timeZone} status={null} inThread onChanged={changed} />
            <p className="my-3 text-xs text-muted-foreground">{data.replies.length} {data.replies.length === 1 ? "reply" : "replies"}</p>
            {data.replies.map((m, i) => (
              <MessageRow key={m.id} message={m} previous={data.replies[i - 1] ?? data.root} mine={m.senderUserId === myUserId} myUserId={myUserId} timeZone={timeZone} status={null} inThread onChanged={changed} />
            ))}
          </div>
        ) : null}
      </div>
      <Composer conversationId={conversationId} label={conversationTitle} threadRootId={rootId} members={members.filter((m) => m.userId !== myUserId)} idSuffix="-thread" onSent={changed} />
    </aside>
  );
}
