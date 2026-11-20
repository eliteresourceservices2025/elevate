"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatInZone } from "@/lib/time";
import { searchChatMessages } from "../actions";
import type { SearchHit } from "../queries";

/** The search box above the chat list, and (while there is something typed) the results in place of the list. */
export function MessageSearch({ onOpen, timeZone, children }: { onOpen: (conversationId: string) => void; timeZone: string; children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searching = q.trim().length >= 2;

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await searchChatMessages({ q });
        if (cancelled) return;
        setError(result.ok ? null : result.error);
        setHits(result.ok ? result.data : []);
      } catch {
        if (!cancelled) setError("Could not reach ELEVATE. Check your connection and try again.");
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, searching]);

  return (
    <>
      <div className="relative border-b px-3 py-2">
        <label htmlFor="chat-search" className="sr-only">
          Search messages
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input id="chat-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" autoComplete="off" className="pr-8 pl-8" />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-5 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {searching ? (
        <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
          {!error && hits === null ? <p className="p-4 text-sm text-muted-foreground">Searching…</p> : null}
          {!error && hits && hits.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No messages match. Search finds whole words and the start of a word, in chats you are in.</p> : null}
          <ul>
            {(hits ?? []).map((h) => (
              <li key={h.messageId}>
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    onOpen(h.conversationId);
                  }}
                  className="flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    <span className="truncate font-semibold text-foreground">{h.conversationTitle}</span>
                    <span className="ml-auto shrink-0">{formatInZone(h.createdAt, timeZone, "MMM d, h:mm a")}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{h.senderName}</span>
                  <span className="line-clamp-2 text-sm">{h.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        children
      )}
    </>
  );
}
