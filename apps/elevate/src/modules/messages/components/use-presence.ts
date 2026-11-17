"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { connectPresence, type PresenceClient } from "./connect-presence";

/** The ids of the people looking at this conversation right now (empty when presence is unavailable). */
export function usePresence(conversationId: string | null, userId: string, announce: boolean): Set<string> {
  const [state, setState] = useState<{ conversationId: string | null; online: Set<string> }>({ conversationId: null, online: new Set() });
  useEffect(() => {
    if (!conversationId) return;
    const client = createSupabaseBrowserClient() as unknown as PresenceClient;
    return connectPresence(client, conversationId, userId, announce, (online) => setState({ conversationId, online }));
  }, [conversationId, userId, announce]);
  // Ignore a stale answer from the previously open conversation.
  return state.conversationId === conversationId ? state.online : new Set();
}
