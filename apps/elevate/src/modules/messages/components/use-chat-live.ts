"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { ChatSignal } from "../realtime-types";
import { connectChatLive, type LiveClient } from "./connect-live";

// One live connection per signed-in person for the whole tab, shared by everything that listens (the Messages page and the header and
// menu unread count). A second subscription to the same private channel would not work, so the first listener opens it and the last
// one to leave closes it.

type Shared = { userId: string; signals: Set<(signal: ChatSignal) => void>; statuses: Set<(live: boolean) => void>; live: boolean; stop: () => void };
let shared: Shared | null = null;

function acquire(userId: string, onSignal: (signal: ChatSignal) => void, onStatus: (live: boolean) => void): () => void {
  if (!shared || shared.userId !== userId) {
    shared?.stop();
    const next: Shared = { userId, signals: new Set(), statuses: new Set(), live: false, stop: () => {} };
    const client = createSupabaseBrowserClient() as unknown as LiveClient;
    next.stop = connectChatLive(
      client,
      userId,
      (signal) => next.signals.forEach((fn) => fn(signal)),
      (live) => {
        next.live = live;
        next.statuses.forEach((fn) => fn(live));
      },
    );
    shared = next;
  }
  const mine = shared;
  mine.signals.add(onSignal);
  mine.statuses.add(onStatus);
  onStatus(mine.live);
  return () => {
    mine.signals.delete(onSignal);
    mine.statuses.delete(onStatus);
    if (mine.signals.size === 0 && shared === mine) {
      mine.stop();
      shared = null;
    }
  };
}

/** Calls `onSignal` whenever something changes in the person's conversations. `live` is false while it falls back to polling. */
export function useChatLive(userId: string, onSignal: (signal: ChatSignal) => void): { live: boolean } {
  const [live, setLive] = useState(false);
  const latest = useRef(onSignal);
  useEffect(() => {
    latest.current = onSignal;
  });
  useEffect(() => {
    if (!userId) return; // no signed-in person known: no live connection
    return acquire(userId, (signal) => latest.current(signal), setLive);
  }, [userId]);
  return { live };
}
