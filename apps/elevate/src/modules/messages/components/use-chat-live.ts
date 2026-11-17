"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { ChatSignal } from "../realtime-types";
import { connectChatLive, type LiveClient } from "./connect-live";

/** Calls `onSignal` whenever something changes in the person's conversations. `live` is false while it falls back to polling. */
export function useChatLive(userId: string, onSignal: (signal: ChatSignal) => void): { live: boolean } {
  const [live, setLive] = useState(false);
  const latest = useRef(onSignal);
  useEffect(() => {
    latest.current = onSignal;
  });
  useEffect(() => {
    const client = createSupabaseBrowserClient() as unknown as LiveClient;
    return connectChatLive(client, userId, (signal) => latest.current(signal), setLive);
  }, [userId]);
  return { live };
}
