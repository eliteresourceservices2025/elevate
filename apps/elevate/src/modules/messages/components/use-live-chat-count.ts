"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadChatUnreadCount } from "../actions";
import { useChatLive } from "./use-chat-live";

/**
 * The unread chat count for the header and the menu, kept current from any page. The server render gives the starting number; any live
 * signal (a message, a chat read, someone muting) asks the server for the count again, a moment later and at most once in that moment.
 * A new server render replaces what was fetched. Chat text never travels here: only a number comes back.
 */
export function useLiveChatCount(userId: string, serverCount: number): number {
  const [state, setState] = useState({ base: serverCount, value: serverCount });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      try {
        const result = await loadChatUnreadCount();
        if (result.ok) setState((s) => ({ ...s, value: result.data }));
      } catch {
        // Keep showing the last number.
      }
    }, 400);
  }, []);
  useChatLive(userId, refresh);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  // A fresh server render (a new page load) is newer than anything fetched before it.
  return state.base === serverCount ? state.value : serverCount;
}
