import "server-only";

// Signals on a call's private channel call:<id>, sent by the server only (the database policy lets a browser do nothing but presence
// there). Ids only, like every live signal: "the tracks changed", "the roster changed", "the call ended". Clients then ask a server
// action for the real state. Never throws: heartbeats catch up if one is missed.

export type CallEvent = { type: "tracks" | "roster" | "ended"; callId: string };

export async function broadcastCallEvent(event: CallEvent): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: `call:${event.callId}`, event: "call", payload: event, private: true }] }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // A missed signal is recovered by the next heartbeat.
  }
}
