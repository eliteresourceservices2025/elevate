"use client";

import { Phone, PhoneCall } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useCall } from "./call-provider";
import { CallControls } from "./call-screen";

/** Plays everyone's voice, always mounted while a call is active, so the sound keeps going in the mini window and on every page. */
function CallAudio() {
  const call = useCall();
  const streams = Object.entries(call.remote).flatMap(([userId, media]) => (media.main && media.main.getAudioTracks().length > 0 ? [[userId, media.main] as const] : []));
  return (
    <div hidden aria-hidden>
      {streams.map(([userId, stream]) => (
        <AudioSink key={userId} stream={stream} />
      ))}
    </div>
  );
}

function AudioSink({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

/** The small floating window shown while you are in a call and not looking at it. */
function MiniCall() {
  const call = useCall();
  const pathname = usePathname();
  if (call.phase !== "active" || !call.state || pathname.startsWith(`/messages/call/${call.state.call.id}`)) return null;
  return (
    <section aria-label="Call in progress" className="fixed right-4 bottom-4 z-50 flex w-72 flex-col gap-2 rounded-xl border bg-card p-3 shadow-lg print:hidden">
      <div className="flex items-center gap-2">
        <PhoneCall className="size-4 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{call.state.call.title}</p>
          <p className="text-xs text-muted-foreground">{call.state.participants.length} in call</p>
        </div>
        <Link href={`/messages/call/${call.state.call.id}`} className="text-sm font-medium text-primary hover:underline">
          Return
        </Link>
      </div>
      <CallControls compact />
    </section>
  );
}

/** The ring: who is calling, with Join and Decline. The ringtone plays while it shows (once the page has been clicked or typed on). */
function IncomingCall() {
  const call = useCall();
  const router = useRouter();
  if (!call.incoming || call.phase === "active" || call.phase === "joining") return null;
  const { incoming } = call;
  return (
    <section role="alertdialog" aria-label="Incoming call" className="fixed top-4 right-4 z-50 flex w-80 flex-col gap-3 rounded-xl border bg-card p-4 shadow-lg print:hidden">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-success text-success-foreground">
          <Phone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{incoming.title}</p>
          <p className="truncate text-xs text-muted-foreground">{incoming.startedByName} is calling</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => {
            const id = call.answerIncoming();
            if (id) router.push(`/messages/call/${id}?join=1`);
          }}
        >
          Join
        </Button>
        <Button type="button" variant="outline" onClick={call.dismissIncoming}>
          Decline
        </Button>
      </div>
    </section>
  );
}

/** Everything a call adds to the page frame (sound, mini window, ring). Mounted once inside CallProvider. */
export function CallOverlays() {
  return (
    <>
      <CallAudio />
      <MiniCall />
      <IncomingCall />
    </>
  );
}
