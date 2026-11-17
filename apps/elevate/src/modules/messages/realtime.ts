import "server-only";
import type { ChatSignal } from "./realtime-types";

// Live signals for chat (see realtime-types.ts: ids only). The browser then asks a server action, which checks membership and decrypts.

export type { ChatSignal };

const TIMEOUT_MS = 2000;

/**
 * Sends the signal to each person's private channel `user:<id>` through Supabase Realtime's REST broadcast.
 * Never throws: if it fails, the browser's polling fallback (every 20 s while not subscribed) catches up.
 * Does nothing when Supabase is not configured (tests, a fresh checkout).
 */
export async function broadcastChatSignal(userIds: string[], signal: ChatSignal): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || userIds.length === 0) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: userIds.map((id) => ({ topic: `user:${id}`, event: "chat", payload: signal, private: true })) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Swallowed on purpose: a missed signal is recovered by polling, and nothing sensitive is logged.
  }
}
