"use client";

import { Hand, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CallState, Seat } from "../service";
import { useCall } from "./call-provider";

// The call page: a lobby (choose microphone and camera, then Join), then the call itself (tiles and controls). The call lives in
// CallProvider, so leaving this page keeps it running in the mini window.

/** A picture, or a name circle when there is no video. Always muted: the sound plays through CallAudio so it continues in the mini window. */
export function Surface({ stream, mirrored = false, label, className }: { stream: MediaStream | null; mirrored?: boolean; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  const hasPicture = Boolean(stream && stream.getVideoTracks().length > 0);
  return (
    <div className={cn("relative flex items-center justify-center overflow-clip rounded-xl bg-muted", className)}>
      <video ref={ref} autoPlay playsInline muted aria-label={hasPicture ? `Video of ${label}` : undefined} className={cn("size-full object-cover", mirrored && "-scale-x-100", !hasPicture && "hidden")} />
      {!hasPicture ? (
        <span aria-hidden className="flex size-16 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
          {initials(label)}
        </span>
      ) : null}
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

function Tile({ seat, mine }: { seat: Seat; mine: boolean }) {
  const call = useCall();
  const media = mine ? { main: call.localCamera, screen: call.localScreen } : (call.remote[seat.userId] ?? { main: null, screen: null });
  const muted = mine ? !call.micOn : (call.presence[seat.userId]?.muted ?? false);
  const hand = mine ? call.handUp : (call.presence[seat.userId]?.hand ?? false);
  return (
    <li className="relative aspect-video min-h-36" data-testid="call-tile" data-user={seat.userId}>
      <Surface stream={media.main} mirrored={mine} label={seat.name} className="size-full" />
      <span className="absolute bottom-2 left-2 flex max-w-[80%] items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
        {muted ? <MicOff className="size-3" aria-label="Muted" /> : null}
        <span className="truncate">{mine ? "You" : seat.name}</span>
      </span>
      {hand ? (
        <span className="absolute top-2 right-2 rounded-full bg-warning p-1 text-warning-foreground" role="img" aria-label={`${mine ? "You have" : `${seat.name} has`} a hand raised`}>
          <Hand className="size-4" />
        </span>
      ) : null}
    </li>
  );
}

export function CallControls({ compact = false }: { compact?: boolean }) {
  const call = useCall();
  const isHost = call.state?.me.role === "host";
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-2", compact && "gap-1")} role="toolbar" aria-label="Call controls">
      <Button type="button" variant={call.micOn ? "secondary" : "destructive"} size={compact ? "icon-sm" : "default"} onClick={() => void call.toggleMic()} aria-pressed={call.micOn} aria-label={call.micOn ? "Mute microphone" : "Unmute microphone"}>
        {call.micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        {compact ? null : call.micOn ? "Mute" : "Unmute"}
      </Button>
      {compact ? null : (
        <>
          <Button type="button" variant={call.cameraOn ? "secondary" : "outline"} onClick={() => void call.toggleCamera()} aria-pressed={call.cameraOn} aria-label={call.cameraOn ? "Turn camera off" : "Turn camera on"}>
            {call.cameraOn ? <Video aria-hidden /> : <VideoOff aria-hidden />}
            {call.cameraOn ? "Camera on" : "Camera off"}
          </Button>
          <Button type="button" variant={call.screenOn ? "secondary" : "outline"} onClick={() => void call.toggleScreen()} aria-pressed={call.screenOn} aria-label={call.screenOn ? "Stop sharing your screen" : "Share your screen"}>
            <MonitorUp aria-hidden />
            {call.screenOn ? "Stop sharing" : "Share screen"}
          </Button>
          <Button type="button" variant={call.handUp ? "secondary" : "outline"} onClick={call.toggleHand} aria-pressed={call.handUp} aria-label={call.handUp ? "Lower your hand" : "Raise your hand"}>
            <Hand aria-hidden />
            {call.handUp ? "Lower hand" : "Raise hand"}
          </Button>
        </>
      )}
      <Button type="button" variant="destructive" size={compact ? "icon-sm" : "default"} onClick={() => void call.leave()} aria-label="Leave call">
        <PhoneOff aria-hidden />
        {compact ? null : "Leave"}
      </Button>
      {isHost && !compact ? (
        <Button type="button" variant="outline" onClick={() => void call.endForEveryone()}>
          End for everyone
        </Button>
      ) : null}
    </div>
  );
}

function ActiveCall({ state }: { state: CallState }) {
  const call = useCall();
  const me = state.participants.find((p) => p.userId === call.userId);
  const others = state.participants.filter((p) => p.userId !== call.userId);
  const sharers = [
    ...(call.screenOn && call.localScreen ? [{ key: "me", name: "Your screen", stream: call.localScreen }] : []),
    ...others.flatMap((p) => (call.remote[p.userId]?.screen ? [{ key: p.userId, name: `${p.name}'s screen`, stream: call.remote[p.userId].screen }] : [])),
  ];
  return (
    <section aria-label="Call" className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" role="status">
        {state.participants.length} {state.participants.length === 1 ? "person" : "people"} in this call
        {others.length === 0 ? ". Waiting for others to join." : "."}
      </p>
      {sharers.length > 0 ? (
        <ul aria-label="Shared screens" className="grid gap-3">
          {sharers.map((s) => (
            <li key={s.key} className="relative aspect-video max-h-[60vh]" data-testid="screen-share">
              <Surface stream={s.stream} label={s.name} className="size-full" />
              <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">{s.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul aria-label="People in the call" className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
        {me ? <Tile seat={me} mine /> : null}
        {others.map((p) => (
          <Tile key={p.userId} seat={p} mine={false} />
        ))}
      </ul>
      <CallControls />
    </section>
  );
}

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
      <p className="text-sm text-muted-foreground">Your browser will ask to use your microphone and camera. Share a window, not your whole screen, and never show patient or client details.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={call.prefs.mic} onChange={(e) => call.setPrefs({ ...call.prefs, mic: e.target.checked })} /> Join with my microphone on
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={call.prefs.camera} onChange={(e) => call.setPrefs({ ...call.prefs, camera: e.target.checked })} /> Join with my camera on
      </label>
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
