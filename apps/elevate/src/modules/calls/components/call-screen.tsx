"use client";

import { ChevronLeft, ChevronRight, Circle, Hand, Mic, MicOff, MonitorUp, PhoneOff, Pin, Smile, Square, Users, Video, VideoOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { REACTIONS } from "../browser/call-channel";
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

/** Five fixed reactions for an all-hands. Each travels as a tiny hint on the call channel; nothing typed. */
function ReactionButtons() {
  const call = useCall();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <Button type="button" variant="outline" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)} aria-label="Send a reaction">
        <Smile aria-hidden />
        React
      </Button>
      {open ? (
        <span role="group" aria-label="Reactions" className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 gap-1 rounded-xl border bg-popover p-1.5 shadow-md">
          {REACTIONS.map((emoji) => (
            <Button key={emoji} type="button" variant="ghost" size="icon-sm" aria-label={`Send ${emoji}`} onClick={() => { call.sendReaction(emoji); setOpen(false); }}>
              <span aria-hidden>{emoji}</span>
            </Button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** Reactions that just arrived, floating for a few seconds (announced politely for screen readers, with the name). */
function ReactionFeed() {
  const call = useCall();
  if (call.reactions.length === 0) return null;
  return (
    <ul aria-label="Reactions" aria-live="polite" className="pointer-events-none flex flex-wrap justify-center gap-2">
      {call.reactions.map((r) => (
        <li key={r.key} className="rounded-full border bg-card px-2.5 py-1 text-sm shadow-sm">
          <span aria-hidden>{r.emoji}</span> <span className="sr-only">{r.name} reacted with {r.emoji}</span>
          <span aria-hidden className="text-xs text-muted-foreground">{r.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Recording is never silent: a red badge for everyone while it runs, and each person is asked yes or no. Until someone says yes they are
 * not part of the recording, and they can change their mind at any time.
 */
export function RecordingNotice() {
  const call = useCall();
  const recording = call.state?.recording ?? null;
  if (!recording) return null;
  const mine = recording.recorderUserId === call.userId;
  return (
    <section aria-label="Recording" className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive-surface p-3 text-sm" data-testid="recording-notice">
      <p className="flex items-center gap-2 font-medium" role="status">
        <Circle className="size-3 shrink-0 fill-destructive text-destructive" aria-hidden />
        {mine ? "You are recording this call." : `${recording.recorderName} is recording this call.`}
      </p>
      {mine ? (
        <p className="text-muted-foreground">
          Only people who said yes are included ({recording.allowedUserIds.length} so far, you among them). Keep this tab open while recording. The recording is kept for 30 days.
        </p>
      ) : recording.myAnswer === null ? (
        <>
          <p>Are you OK with being recorded? Until you say yes, you are not in the recording.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void call.answerRecording("allow")}>
              Yes, record me
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void call.answerRecording("decline")}>
              No, don&apos;t record me
            </Button>
          </div>
        </>
      ) : recording.myAnswer === "allow" ? (
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          You said yes.
          <Button type="button" size="xs" variant="outline" onClick={() => void call.answerRecording("decline")}>
            Stop recording me
          </Button>
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          You are not being recorded.
          <Button type="button" size="xs" variant="outline" onClick={() => void call.answerRecording("allow")}>
            I&apos;m OK with it now
          </Button>
        </p>
      )}
    </section>
  );
}

export function CallControls({ compact = false }: { compact?: boolean }) {
  const call = useCall();
  const isHost = call.state?.me.role === "host";
  const recording = call.state?.recording ?? null;
  const iRecord = recording?.recorderUserId === call.userId;
  const [reacting, setReacting] = useState(false);
  // The audience of an all-hands only watches: no microphone, camera or screen buttons, just a hand, reactions and Leave.
  if (!call.canPublish) {
    return (
      <div className={cn("flex flex-wrap items-center justify-center gap-2", compact && "gap-1")} role="toolbar" aria-label="Call controls">
        {compact ? null : (
          <>
            <Button type="button" variant={call.handUp ? "secondary" : "outline"} onClick={call.toggleHand} aria-pressed={call.handUp} aria-label={call.handUp ? "Lower your hand" : "Raise your hand"}>
              <Hand aria-hidden />
              {call.handUp ? "Lower hand" : "Raise hand"}
            </Button>
            <ReactionButtons />
          </>
        )}
        <Button type="button" variant="destructive" size={compact ? "icon-sm" : "default"} onClick={() => void call.leave()} aria-label="Leave call">
          <PhoneOff aria-hidden />
          {compact ? null : "Leave"}
        </Button>
      </div>
    );
  }
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
          {call.state?.call.mode === "townhall" ? <ReactionButtons /> : null}
          {call.abilities.record && !recording ? (
            <Button type="button" variant="outline" onClick={() => void call.startRecording()} aria-label="Start recording">
              <Circle className="fill-destructive text-destructive" aria-hidden />
              Record
            </Button>
          ) : null}
          {recording && (iRecord || isHost) ? (
            <Button type="button" variant="outline" onClick={() => void call.stopRecording()} aria-label="Stop recording">
              <Square className="fill-current" aria-hidden />
              Stop recording
            </Button>
          ) : null}
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

/** The people list: who is here, who is muted or has a hand up, who is speaking; and, for the host, mute and remove. */
function PeoplePanel({ state }: { state: CallState }) {
  const call = useCall();
  const isHost = state.me.role === "host";
  const townhall = state.call.mode === "townhall";
  const [confirming, setConfirming] = useState<string | null>(null);
  const sorted = [...state.participants].sort((a, b) => Number(call.presence[b.userId]?.hand ?? false) - Number(call.presence[a.userId]?.hand ?? false));
  return (
    <section aria-label="People in this call" className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <h2 className="font-heading text-base font-semibold">People ({state.participants.length})</h2>
      <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto text-sm">
        {sorted.map((p) => {
          const mine = p.userId === call.userId;
          const muted = mine ? !call.micOn : (call.presence[p.userId]?.muted ?? false);
          const hand = mine ? call.handUp : (call.presence[p.userId]?.hand ?? false);
          return (
            <li key={p.userId} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted" data-testid="person-row" data-user={p.userId}>
              <span className="min-w-0 flex-1 truncate">
                {mine ? "You" : p.name}
                {p.role === "host" ? <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">Host</span> : null}
                {p.role === "speaker" ? <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">Speaker</span> : null}
                {call.activeSpeakerId === p.userId ? <span className="ml-1.5 text-xs text-success">Speaking</span> : null}
              </span>
              {hand ? <Hand className="size-4 text-warning" role="img" aria-label="Hand raised" /> : null}
              {muted ? <MicOff className="size-4 text-muted-foreground" role="img" aria-label="Muted" /> : null}
              {!mine ? (
                <Button type="button" variant="ghost" size="xs" aria-pressed={call.pinnedUserId === p.userId} onClick={() => call.pin(call.pinnedUserId === p.userId ? null : p.userId)} aria-label={`${call.pinnedUserId === p.userId ? "Unpin" : "Pin"} ${p.name}`}>
                  <Pin aria-hidden />
                </Button>
              ) : null}
              {isHost && !mine ? (
                confirming === p.userId ? (
                  <span className="flex items-center gap-1">
                    <Button type="button" variant="destructive" size="xs" onClick={() => void call.removeOther(p.userId).then(() => setConfirming(null))}>
                      Remove {p.name}?
                    </Button>
                    <Button type="button" variant="ghost" size="xs" onClick={() => setConfirming(null)}>
                      No
                    </Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    {townhall ? (
                      <Button type="button" variant="outline" size="xs" onClick={() => void call.makeSpeaker(p.userId, p.role !== "speaker")} aria-label={p.role === "speaker" ? `Put ${p.name} back in the audience` : `Make ${p.name} a speaker`}>
                        {p.role === "speaker" ? "Audience" : "Speaker"}
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" size="xs" onClick={() => void call.muteOther(p.userId)} aria-label={`Mute ${p.name}`}>
                      Mute
                    </Button>
                    <Button type="button" variant="outline" size="xs" onClick={() => setConfirming(p.userId)} aria-label={`Remove ${p.name} from the call`}>
                      Remove
                    </Button>
                  </span>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** At most this many tiles beside your own: video for one page, then name circles (they cost nothing to show). The People list has everyone. */
const MAX_OTHER_TILES = 11;

function ActiveCall({ state }: { state: CallState }) {
  const call = useCall();
  const [showPeople, setShowPeople] = useState(false);
  const me = state.participants.find((p) => p.userId === call.userId);
  const townhall = state.call.mode === "townhall";
  // In an all-hands the stage is the host and speakers; the audience is a count and the People list, not 100 name circles.
  const others = state.participants.filter((p) => p.userId !== call.userId && (!townhall || p.role !== "attendee"));
  const watching = townhall ? state.participants.filter((p) => p.role === "attendee").length : 0;
  const withVideo = call.visibleUserIds;
  // Video tiles first (the page showing), then people without video, up to a sensible number.
  const shown = [...others.filter((p) => withVideo.includes(p.userId)), ...others.filter((p) => !withVideo.includes(p.userId))].slice(0, MAX_OTHER_TILES);
  const hidden = others.length - shown.length;
  const sharers = [
    ...(call.screenOn && call.localScreen ? [{ key: "me", name: "Your screen", stream: call.localScreen }] : []),
    ...others.flatMap((p) => (call.remote[p.userId]?.screen ? [{ key: p.userId, name: `${p.name}'s screen`, stream: call.remote[p.userId].screen }] : [])),
  ];
  return (
    <section aria-label="Call" className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" role="status">
        {townhall ? `All-hands: ${watching} watching, ${state.participants.length - watching} on stage.` : `${state.participants.length} ${state.participants.length === 1 ? "person" : "people"} in this call${others.length === 0 ? ". Waiting for others to join." : "."}`}
      </p>
      <RecordingNotice />
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
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-3">
          <ul aria-label="People in the call" className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
            {me && call.canPublish ? <Tile seat={me} mine /> : null}
            {shown.map((p) => (
              <Tile key={p.userId} seat={p} mine={false} />
            ))}
          </ul>
          {hidden > 0 || call.pages > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {hidden > 0 ? <span>{hidden} more {hidden === 1 ? "person is" : "people are"} in the call (see People).</span> : null}
              {call.pages > 1 ? (
                <span className="ml-auto flex items-center gap-1" role="group" aria-label="Video pages">
                  <Button type="button" variant="outline" size="icon-sm" disabled={call.page === 0} onClick={() => call.setPage(call.page - 1)} aria-label="Previous page of video">
                    <ChevronLeft aria-hidden />
                  </Button>
                  <span aria-live="polite">
                    Page {call.page + 1} of {call.pages}
                  </span>
                  <Button type="button" variant="outline" size="icon-sm" disabled={call.page >= call.pages - 1} onClick={() => call.setPage(call.page + 1)} aria-label="Next page of video">
                    <ChevronRight aria-hidden />
                  </Button>
                </span>
              ) : null}
            </div>
          ) : null}
          <ReactionFeed />
          {townhall ? (
            <p className="text-center text-xs text-muted-foreground">
              Questions go in the chat: <Link href={`/messages/${state.call.conversationId}`} target="_blank" rel="noopener" className="underline">open the chat in a new tab</Link>.
            </p>
          ) : null}
          <CallControls />
          <Button type="button" variant="outline" className="self-center" aria-expanded={showPeople} onClick={() => setShowPeople((v) => !v)}>
            <Users aria-hidden /> {showPeople ? "Hide people" : `People (${state.participants.length})`}
          </Button>
        </div>
        {showPeople ? <PeoplePanel state={state} /> : null}
      </div>
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
      <p className="text-sm text-muted-foreground">Your browser will ask to use your microphone and camera. Share a window, not your whole screen, and never show patient or client details. In an all-hands only the speakers use a microphone and camera; everyone else watches.</p>
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
