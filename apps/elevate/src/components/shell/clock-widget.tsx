"use client";

import { ChevronDown, Clock, Coffee, LogOut, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { BREAK_CHOICES, MINUTE, breakLabel, formatClock } from "@/modules/attendance/clock";
import { answerIdlePrompt, clockIn, clockOut, endBreak, reportIdlePrompt, requestClockSelfie, startBreak } from "@/modules/attendance/actions";
import type { ClockStatus } from "@/modules/attendance/queries";

type IdleDetectorLike = EventTarget & { userState: "active" | "idle"; screenState: string; start(options: { threshold: number; signal?: AbortSignal }): Promise<void> };
type IdleDetectorCtor = { new (): IdleDetectorLike; requestPermission(): Promise<"granted" | "denied"> };

/** Takes one photo from the camera and sends it to private storage. The server checks it again before accepting it. */
function SelfieCapture({ onDone, onCancel }: { onDone: (path: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: 480, height: 360 }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("The camera is not available. Allow camera access, or ask HR."));
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function capture() {
    const el = video.current;
    if (!el || !el.videoWidth) return;
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 360;
    canvas.getContext("2d")?.drawImage(el, 0, 0, 480, 360);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
    const ticket = await requestClockSelfie();
    if (!blob || !ticket.ok) {
      setBusy(false);
      return void toast.error(ticket.ok ? "Could not take the photo." : ticket.error);
    }
    const { error: uploadError } = await createSupabaseBrowserClient().storage.from("employee-docs").uploadToSignedUrl(ticket.data.path, ticket.data.token, blob, { contentType: "image/jpeg" });
    setBusy(false);
    if (uploadError) return void toast.error("The photo did not upload. Try again.");
    onDone(ticket.data.path);
  }

  return (
    <div role="dialog" aria-label="Clock-in selfie" className="absolute right-0 top-full z-50 mt-2 w-72 space-y-2 rounded-xl border bg-popover p-3 shadow-lg">
      <p className="text-sm">Your team asks for a selfie when you clock in. It is deleted after 30 days.</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : <video ref={video} autoPlay playsInline muted className="w-full rounded-lg bg-muted" aria-label="Camera preview" />}
      <div className="flex gap-2">
        <Button size="sm" onClick={capture} disabled={busy || Boolean(error)}>
          Take selfie and clock in
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const here = () =>
  new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60_000 },
    );
  });

/**
 * The time clock in the header. Elapsed time counts from the SERVER's timestamps (offset against this browser's clock),
 * so changing the computer's clock changes nothing. All the rules are enforced on the server; this only shows state.
 */
export function ClockWidget({ status }: { status: ClockStatus | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState<number | null>(null);
  const [selfie, setSelfie] = useState(false);
  const [breakMenu, setBreakMenu] = useState(false);
  const [idlePrompt, setIdlePrompt] = useState<string | null>(null);
  /** The break (by its start time) whose "your break is up" pop-up the person has already dismissed. */
  const [dismissedBreak, setDismissedBreak] = useState<number | null>(null);
  const offset = useRef(0);
  const lastActive = useRef(0);
  const idleRef = useRef<{ detector: IdleDetectorLike | null; abort: AbortController | null }>({ detector: null, abort: null });
  const promptShown = useRef(false);

  const working = status?.state === "working" || status?.state === "break";

  // Count from the server's clock.
  useEffect(() => {
    if (!status) return;
    offset.current = status.serverNowMs - Date.now();
    lastActive.current = Date.now();
    const tick = () => setNow(Date.now() + offset.current);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status]);

  const showPrompt = useCallback(async (source: "idle_api" | "fallback") => {
    if (promptShown.current) return;
    promptShown.current = true;
    const result = await reportIdlePrompt({ source });
    setIdlePrompt(result.ok ? result.data.promptId : "none");
  }, []);

  // "Are you still working?": the browser's Idle Detection where available, otherwise no activity inside ELEVATE.
  useEffect(() => {
    if (!working || !status?.idleMinutes) return;
    const minutes = status.idleMinutes;
    const bump = () => {
      lastActive.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "mousemove", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    const timer = setInterval(() => {
      const apiActive = idleRef.current.detector !== null;
      if (!apiActive && Date.now() - lastActive.current > minutes * 60_000) void showPrompt("fallback");
    }, 15_000);
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(timer);
    };
  }, [working, status?.idleMinutes, showPrompt]);

  async function startIdleApi(minutes: number) {
    const Ctor = (window as unknown as { IdleDetector?: IdleDetectorCtor }).IdleDetector;
    if (!Ctor || idleRef.current.detector) return;
    try {
      if ((await Ctor.requestPermission()) !== "granted") return;
      const detector = new Ctor();
      const abort = new AbortController();
      detector.addEventListener("change", () => {
        if (detector.userState === "idle") void showPrompt("idle_api");
      });
      await detector.start({ threshold: Math.max(60_000, minutes * 60_000), signal: abort.signal });
      idleRef.current = { detector, abort };
    } catch {
      idleRef.current = { detector: null, abort: null }; // fall back to in-page activity
    }
  }
  useEffect(() => {
    // Stop the browser's idle detector when the session ends.
    if (!working) {
      idleRef.current.abort?.abort();
      idleRef.current = { detector: null, abort: null };
      promptShown.current = false;
    }
  }, [working]);

  if (!status) {
    // No people record: say so, and point to where it is fixed, instead of silently showing nothing.
    return (
      <Link href="/attendance" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "font-medium")}>
        <Clock aria-hidden />
        Set up your time clock
      </Link>
    );
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      if (success) toast.success(success);
      after?.();
      router.refresh();
    });

  async function doClockIn(selfiePath?: string) {
    setSelfie(false);
    const position = status!.locationOn ? await here() : null;
    run(
      () => clockIn({ ...(position ?? {}), selfiePath }),
      "Clocked in.",
      () => {
        if (status!.idleMinutes) void startIdleApi(status!.idleMinutes);
      },
    );
  }

  const nowMs = now ?? status.serverNowMs;
  const onBreak = status.state === "break";
  const worked = status.sessionStartMs === null ? 0 : nowMs - status.sessionStartMs - status.breakDoneMs - (status.breakStartMs ? nowMs - status.breakStartMs : 0);

  // On a timed break the clock counts down; past zero it counts how far over the person is. Open breaks count up.
  const plannedMs = status.breakPlannedMinutes === null ? null : status.breakPlannedMinutes * MINUTE;
  const breakElapsed = onBreak && status.breakStartMs ? nowMs - status.breakStartMs : 0;
  const remaining = plannedMs === null ? null : plannedMs - breakElapsed;
  const over = remaining !== null && remaining < 0;
  const showBreakUp = onBreak && remaining !== null && remaining <= 0 && dismissedBreak !== status.breakStartMs;

  const shownTime = onBreak ? (remaining === null ? formatClock(breakElapsed) : over ? `+${formatClock(-remaining)}` : formatClock(remaining)) : formatClock(worked);
  const shownLabel = onBreak ? (remaining === null ? "On break" : over ? "Over break by" : "Break left") : "Working";

  return (
    <div className="relative flex items-center gap-2">
      {working ? (
        <span className="hidden items-center gap-1.5 text-sm sm:flex" aria-live="off">
          <span className={cn("size-2.5 rounded-full", onBreak ? (over ? "bg-red-600" : "bg-amber-500") : "bg-green-600")} aria-hidden />
          <span className={cn("font-medium", over && "text-red-600")}>{shownLabel}</span>
          <span className={cn("font-mono text-base font-semibold", over ? "text-red-600" : "text-foreground")} suppressHydrationWarning>
            {shownTime}
          </span>
        </span>
      ) : null}

      {!working ? (
        <Button
          size="lg"
          disabled={pending}
          onClick={() => (status.needsSelfie ? setSelfie(true) : void doClockIn())}
          className="h-11 min-w-36 gap-2 px-6 text-base font-bold shadow-lg shadow-primary/30 ring-2 ring-primary/40 transition-transform hover:scale-[1.03]"
        >
          <Clock className="size-5" aria-hidden />
          Clock in
        </Button>
      ) : (
        <>
          {onBreak ? (
            <Button variant="default" size="lg" className="h-10 gap-2 px-4 font-semibold" disabled={pending} onClick={() => run(() => endBreak(), "Break ended.")}>
              <Play aria-hidden />
              End break
            </Button>
          ) : (
            <div className="relative">
              <Button variant="ghost" size="lg" className="h-10 gap-1 px-3" disabled={pending} aria-haspopup="menu" aria-expanded={breakMenu} onClick={() => setBreakMenu((v) => !v)}>
                <Coffee aria-hidden />
                Break
                <ChevronDown aria-hidden />
              </Button>
              {breakMenu ? (
                <div role="menu" aria-label="Choose a break" className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border bg-popover py-1 shadow-lg">
                  {[...BREAK_CHOICES, null].map((m) => (
                    <button
                      key={m ?? "open"}
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => {
                        setBreakMenu(false);
                        run(() => startBreak(m === null ? {} : { breakMinutes: m }), "Break started.");
                      }}
                    >
                      {breakLabel(m)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <Button variant="outline" size="lg" className="h-10 gap-2 px-4 font-semibold" disabled={pending} onClick={() => run(() => clockOut(), "Clocked out.")}>
            <LogOut aria-hidden />
            Clock out
          </Button>
        </>
      )}

      {selfie ? <SelfieCapture onCancel={() => setSelfie(false)} onDone={(path) => void doClockIn(path)} /> : null}

      {showBreakUp ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="break-up-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-card p-6 shadow-2xl">
            <h2 id="break-up-title" className="text-xl font-bold text-red-600">
              Your break is up
            </h2>
            <p className="text-sm">
              Your {breakLabel(status.breakPlannedMinutes)} break has ended. Please end your break and get back to work. Time past your break is recorded on your timesheet, and your team lead is told if you stay on break.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                size="lg"
                className="h-11 text-base font-semibold"
                disabled={pending}
                onClick={() => {
                  setDismissedBreak(status.breakStartMs);
                  run(() => endBreak(), "Break ended.");
                }}
              >
                End break and get back to work
              </Button>
              <Button variant="ghost" onClick={() => setDismissedBreak(status.breakStartMs)}>
                Stay on break
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {idlePrompt ? (
        <div role="alertdialog" aria-label="Are you still working?" className="absolute right-0 top-full z-50 mt-2 w-64 space-y-2 rounded-xl border bg-popover p-3 shadow-lg">
          <p className="text-sm font-medium">Are you still working?</p>
          <p className="text-xs text-muted-foreground">You have been inactive for a while. This does not clock you out.</p>
          <Button
            size="sm"
            onClick={() => {
              const id = idlePrompt;
              setIdlePrompt(null);
              promptShown.current = false;
              lastActive.current = Date.now();
              if (id !== "none") void answerIdlePrompt({ promptId: id });
            }}
          >
            Yes, I am here
          </Button>
        </div>
      ) : null}
    </div>
  );
}
