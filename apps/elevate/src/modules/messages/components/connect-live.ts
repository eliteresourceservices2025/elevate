import type { ChatSignal } from "../realtime-types";

// Browser side of live chat, as plain functions so it can be tested without React. It listens on the person's own private channel
// (user:<id>); the database policy lets a person join only their own. Signals carry ids only, so the caller then asks a server action
// for what changed. While the socket is not subscribed it asks anyway every 20 seconds, so a dropped connection only costs seconds.

export const POLL_MS = 20_000;

type LiveChannel = {
  on(type: "broadcast", filter: { event: string }, callback: (message: { payload: ChatSignal }) => void): LiveChannel;
  subscribe(callback: (status: string) => void): LiveChannel;
};

/** The few parts of the Supabase browser client this uses. */
export type LiveClient = {
  auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> };
  realtime: { setAuth(token?: string): unknown };
  channel(topic: string, options: { config: { private: boolean } }): LiveChannel;
  removeChannel(channel: LiveChannel): unknown;
};

/** The signal sent when the socket is down: "something may have changed, look at everything". */
export const REFRESH_ALL: ChatSignal = { type: "message", conversationId: "" };

/** Starts listening. Returns the function that stops it. `onStatus(true)` means the live connection is up. */
export function connectChatLive(client: LiveClient, userId: string, onSignal: (signal: ChatSignal) => void, onStatus?: (live: boolean) => void): () => void {
  let stopped = false;
  let live = false;
  let channel: LiveChannel | null = null;

  const timer = setInterval(() => {
    if (!live && !stopped) onSignal(REFRESH_ALL);
  }, POLL_MS);

  void (async () => {
    try {
      const { data } = await client.auth.getSession();
      if (stopped || !data.session) return;
      client.realtime.setAuth(data.session.access_token);
      channel = client
        .channel(`user:${userId}`, { config: { private: true } })
        .on("broadcast", { event: "chat" }, (message) => onSignal(message.payload))
        .subscribe((status) => {
          const now = status === "SUBSCRIBED";
          if (now !== live) onStatus?.(now);
          live = now;
        });
    } catch {
      // No live connection: the polling above keeps the page current.
    }
  })();

  return () => {
    stopped = true;
    clearInterval(timer);
    if (channel) void client.removeChannel(channel);
  };
}
