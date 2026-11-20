"use client";

import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canChooseSpeaker, deviceConstraint, type DeviceInfo, type DeviceKind } from "../browser/devices";
import { useCall } from "./call-provider";

// Choosing the microphone, camera and speakers: three lists (used in the lobby, with a test, and in a call, in a dialog). The choice is
// kept in this browser only. A device that was unplugged since last time falls back to the default.

function Select({ id, label, kind, options }: { id: string; label: string; kind: DeviceKind; options: DeviceInfo[] }) {
  const call = useCall();
  const value = call.chosen[kind] ?? "";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} className="h-(--control-h) w-full rounded-lg border bg-background px-2 text-sm" value={value} onChange={(e) => void call.chooseDevice(kind, e.target.value || null)}>
        <option value="">Default</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The three lists. Names appear once the browser has been allowed to use the devices (the test in the lobby asks). */
export function DeviceSelects({ idPrefix }: { idPrefix: string }) {
  const call = useCall();
  const named = call.devices.mics.some((d) => !/^Microphone \d+$/.test(d.label)) || call.devices.cams.some((d) => !/^Camera \d+$/.test(d.label));
  return (
    <div className="flex flex-col gap-3">
      <Select id={`${idPrefix}-mic`} label="Microphone" kind="mic" options={call.devices.mics} />
      <Select id={`${idPrefix}-cam`} label="Camera" kind="cam" options={call.devices.cams} />
      {canChooseSpeaker() ? <Select id={`${idPrefix}-speaker`} label="Speakers" kind="speaker" options={call.devices.speakers} /> : <p className="text-xs text-muted-foreground">Your browser plays the call through your computer&apos;s chosen speakers.</p>}
      {named ? null : <p className="text-xs text-muted-foreground">Names show after your browser has been allowed to use your microphone and camera.</p>}
    </div>
  );
}

/**
 * The lobby's test: shows your own picture and how loud your microphone is, using the devices chosen above, so a muted headset or the wrong
 * camera is found before joining. Nothing is sent anywhere; it stops when you join or leave this page.
 */
export function DeviceCheck() {
  const call = useCall();
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { mic, cam } = call.chosen;
  const { refreshDevices } = call;

  useEffect(() => {
    if (!testing) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: deviceConstraint(mic), video: deviceConstraint(cam) });
      } catch {
        try {
          // No camera (or it is in use): the microphone can still be tested.
          stream = await navigator.mediaDevices.getUserMedia({ audio: deviceConstraint(mic) });
        } catch {
          if (!stopped) {
            setProblem("Couldn't use your microphone or camera. Check the browser's permission for this site, then try again.");
            setTesting(false);
          }
          return;
        }
      }
      if (stopped) return void stream.getTracks().forEach((t) => t.stop());
      setProblem(null);
      if (video.current) video.current.srcObject = stream;
      void refreshDevices(); // the names are known now
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor && stream.getAudioTracks().length > 0) {
        ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buffer = new Uint8Array(512);
        timer = setInterval(() => {
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (const v of buffer) sum += ((v - 128) / 128) ** 2;
          setLevel(Math.min(100, Math.round(Math.sqrt(sum / buffer.length) * 400)));
        }, 120);
      }
    })();
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      if (video.current) video.current.srcObject = null;
      setLevel(0);
    };
  }, [testing, mic, cam, refreshDevices]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      {testing ? (
        <>
          <video ref={video} autoPlay playsInline muted aria-label="Your camera" className="aspect-video w-full -scale-x-100 rounded-lg bg-muted object-cover" />
          <div className="flex items-center gap-2 text-sm">
            <Mic className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} className="h-2 flex-1 overflow-clip rounded-full bg-muted">
              <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${level}%` }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Say something: the bar should move. If your camera is off or dark, choose another one above.</p>
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setTesting(false)}>
            Stop test
          </Button>
        </>
      ) : (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setTesting(true)}>
          Test my microphone and camera
        </Button>
      )}
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** In a call: the same three lists in a dialog, applied at once (no need to leave). */
export function DevicesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Devices</DialogTitle>
          <DialogDescription>Changes apply right away, without leaving the call. Your choice is kept on this computer.</DialogDescription>
        </DialogHeader>
        <DeviceSelects idPrefix="call-dialog" />
      </DialogContent>
    </Dialog>
  );
}
