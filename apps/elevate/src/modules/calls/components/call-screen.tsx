"use client";

import { PhoneOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useCall } from "./call-provider";
import { DeviceCheck, DeviceSelects } from "./call-devices";
import { ActiveCall } from "./call-room";

// The call page: a lobby (choose microphone and camera, then Join), then the call itself (call-room.tsx). The call lives in
// CallProvider, so leaving this page keeps it running in the mini window.

/** What the call page shows: the lobby, joining, or the call. `autoJoin` is for the person who just pressed the call button. */
export function CallScreen({ callId, autoJoin }: { callId: string; autoJoin: boolean }) {
  const call = useCall();
  const router = useRouter();
  const joined = useRef(false);
  const conversationId = useRef<string | null>(null);
  const wasActive = useRef(false);

  useEffect(() => {
    call.open(callId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open only when the page's call changes
  }, [callId]);

  useEffect(() => {
    if (autoJoin && !joined.current && call.phase === "lobby" && call.callId === callId) {
      joined.current = true;
      void call.join();
    }
  }, [autoJoin, call, callId]);

  useEffect(() => {
    if (call.state) conversationId.current = call.state.call.conversationId;
    if (call.phase === "active") wasActive.current = true;
    // After leaving or the call ending, go back to the chat it was in.
    if (call.phase === "idle" && wasActive.current) {
      wasActive.current = false;
      router.replace(conversationId.current ? `/messages/${conversationId.current}` : "/messages");
    }
  }, [call.phase, call.state, router]);

  if (call.phase === "active" && call.state && call.state.call.id === callId) return <ActiveCall state={call.state} />;
  if (call.phase === "active" || (call.phase === "joining" && call.callId !== callId)) {
    return (
      <EmptyState icon={PhoneOff} title="You're in another call" description="Leave that call before joining this one." action={<Button type="button" variant="outline" onClick={() => void call.leave()}>Leave the other call</Button>} />
    );
  }
  if (call.phase === "joining") {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted-foreground">
        Joining the call…
      </p>
    );
  }
  return (
    <section aria-label="Join the call" className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border bg-card p-5">
      <h2 className="font-heading text-lg font-semibold">Ready to join?</h2>
      <p className="text-sm text-muted-foreground">Your browser will ask to use your microphone and camera. Share a window, not your whole screen, and never show patient or client details. In an all-hands only the speakers use a microphone and camera; everyone else watches.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={call.prefs.mic} onChange={(e) => call.setPrefs({ ...call.prefs, mic: e.target.checked })} /> Join with my microphone on
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={call.prefs.camera} onChange={(e) => call.setPrefs({ ...call.prefs, camera: e.target.checked })} /> Join with my camera on
      </label>
      <DeviceSelects idPrefix="lobby" />
      <DeviceCheck />
      {call.error ? (
        <p role="alert" className="text-sm text-destructive">
          {call.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void call.join()} disabled={call.phase !== "lobby"}>
          Join call
        </Button>
        <Link href="/messages" className="inline-flex h-(--control-h) items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          Back to messages
        </Link>
      </div>
    </section>
  );
}
