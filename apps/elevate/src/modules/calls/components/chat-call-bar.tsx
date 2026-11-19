"use client";

import { Megaphone, PhoneCall, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useChatLive } from "@/modules/messages/components/use-chat-live";
import type { ChatSignal } from "@/modules/messages/realtime-types";
import { callApi } from "../browser/api";
import type { LiveCall } from "../service";
import { useCall } from "./call-provider";

/**
 * The strip under a chat's header: "Start a call" when none is live, or "Call in progress: Join" when one is. It looks again whenever a
 * call signal arrives for this chat and every 30 seconds, so a banner never lingers after a call ends. Guests can join but not start.
 */
export function ChatCallBar({ conversationId, userId, canStart, canAllHands = false }: { conversationId: string; userId: string; canStart: boolean; canAllHands?: boolean }) {
  const call = useCall();
  const router = useRouter();
  const [seen, setSeen] = useState<{ conversationId: string; live: LiveCall | null } | null>(null);
  // What was seen for another chat (a quick switch) is not this chat's call.
  const live = seen?.conversationId === conversationId ? seen.live : null;
  const [busy, setBusy] = useState(false);

  const look = useCallback(async () => {
    try {
      setSeen({ conversationId, live: await callApi.live(conversationId) });
    } catch {
      setSeen({ conversationId, live: null });
    }
  }, [conversationId]);

  useEffect(() => {
    const first = setTimeout(() => void look(), 0);
    const every = setInterval(() => void look(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [look]);

  useChatLive(
    userId,
    useCallback(
      (signal: ChatSignal) => {
        if (signal.type === "call" && (signal.conversationId === conversationId || signal.conversationId === "")) void look();
      },
      [conversationId, look],
    ),
  );

  const youAreIn = call.phase === "active" && call.state?.call.conversationId === conversationId;
  if (live || youAreIn) {
    const callId = live?.callId ?? call.callId;
    return (
      <div className="flex flex-wrap items-center gap-2 border-b bg-success-surface px-3 py-2 text-sm" role="status">
        <PhoneCall className="size-4 text-success" aria-hidden />
        <span className="min-w-0 flex-1">
          {youAreIn ? "You're in this call." : `${live?.startedByName ?? "Someone"} started ${live?.mode === "townhall" ? "an all-hands" : "a call"}. ${live?.participantCount ?? 0} in it.`}
        </span>
        <Button type="button" size="sm" onClick={() => callId && router.push(`/messages/call/${callId}?join=1`)} disabled={!callId}>
          {youAreIn ? "Return to call" : live?.mode === "townhall" ? "Join all-hands" : "Join call"}
        </Button>
      </div>
    );
  }
  if (!canStart) return null;
  const busyNow = busy || call.phase === "active" || call.phase === "joining";
  async function begin(mode: "meeting" | "townhall") {
    setBusy(true);
    const id = await call.start(conversationId, mode);
    setBusy(false);
    if (id) router.push(`/messages/call/${id}?join=1`);
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1 border-b px-3 py-1.5">
      <Link href="/messages/recordings" className="mr-auto text-xs text-muted-foreground underline-offset-2 hover:underline">
        Call recordings
      </Link>
      {canAllHands && call.abilities.townhall ? (
        <Button type="button" variant="ghost" size="sm" disabled={busyNow} onClick={() => void begin("townhall")}>
          <Megaphone aria-hidden /> Start an all-hands
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" disabled={busyNow} onClick={() => void begin("meeting")}>
        <Video aria-hidden /> Start a call
      </Button>
    </div>
  );
}
