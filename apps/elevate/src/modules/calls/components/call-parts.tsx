"use client";

import { Circle, Hand, Mic, MicOff, PhoneOff, Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CallState, Seat } from "../service";
import { useCall } from "./call-provider";

// The pieces the call page and the mini window share: a picture or name circle, a person's tile, the recording notice, the people list.

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

export function Tile({ seat, mine, strip = false }: { seat: Seat; mine: boolean; strip?: boolean }) {
  const call = useCall();
  const media = mine ? { main: call.localCamera, screen: call.localScreen } : (call.remote[seat.userId] ?? { main: null, screen: null });
  const muted = mine ? !call.micOn : (call.presence[seat.userId]?.muted ?? false);
  const hand = mine ? call.handUp : (call.presence[seat.userId]?.hand ?? false);
  return (
    <li className={cn("relative rounded-xl", strip ? "h-24" : "aspect-video min-h-36", call.activeSpeakerId === seat.userId && "ring-2 ring-brand-gold")} data-testid="call-tile" data-user={seat.userId}>
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

/** Reactions that just arrived, floating for a few seconds (announced politely for screen readers, with the name). */
export function ReactionFeed() {
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

/** The small controls of the mini window: microphone and leave. (The full call page has its own control bar.) */
export function CallControls() {
  const call = useCall();
  return (
    <div className="flex items-center justify-center gap-1" role="toolbar" aria-label="Call controls">
      {call.canPublish ? (
        <Button type="button" variant={call.micOn ? "secondary" : "destructive"} size="icon-sm" onClick={() => void call.toggleMic()} aria-pressed={call.micOn} aria-label={call.micOn ? "Mute microphone" : "Unmute microphone"}>
          {call.micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        </Button>
      ) : null}
      <Button type="button" variant="destructive" size="icon-sm" onClick={() => void call.leave()} aria-label="Leave call">
        <PhoneOff aria-hidden />
      </Button>
    </div>
  );
}

/** The people list: who is here, who is muted or has a hand up, who is speaking; and, for the host, mute and remove. */
export function PeoplePanel({ state }: { state: CallState }) {
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
