"use client";

import { ChevronDown, Clock, Coffee, LogOut, Play, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { fromZonedTime } from "date-fns-tz";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/run-action";
import { formatInZone } from "@/lib/time";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { BREAK_CHOICES, EOD_TEMPLATE, HEARTBEAT_MS, MINUTE, breakLabel, formatClock, needsWelcomeBack } from "@/modules/attendance/clock";
import { coveringWindow } from "@/modules/attendance/extra-hours";
import { answerIdlePrompt, cancelCorrection, clockIn, clockOut, endBreak, pingPresence, reportIdlePrompt, requestClockSelfie, requestCorrection, saveShiftNote, startBreak } from "@/modules/attendance/actions";
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

const LOCAL = "yyyy-MM-dd'T'HH:mm";
const CAUSES = [
  { key: "connection_problem", label: "My internet connection dropped", reason: "My internet connection dropped." },
  { key: "device_problem", label: "My device restarted or failed", reason: "My device restarted or failed." },
  { key: "forgot", label: "I forgot to clock out", reason: "I forgot to clock out." },
] as const;

/** After a long gap while clocked in: "Still working?" or "I stopped at ..." (a clock-out request for the lead, prefilled with the last time seen). */
function WelcomeBack({ seenMs, startMs, zone, online, onDone }: { seenMs: number; startMs: number; zone: string; online: boolean; onDone: () => void }) {
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  const [at, setAt] = useState(() => formatInZone(seenMs, zone, LOCAL));
  const [cause, setCause] = useState<(typeof CAUSES)[number]["key"]>("connection_problem");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const picked = CAUSES.find((c) => c.key === cause)!;
      const result = await requestCorrection({ reason: picked.reason, kind: picked.key, events: [{ type: "clock_out", at: fromZonedTime(at, zone).toISOString() }] });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Sent to your lead. You stay clocked in until it is approved, or you can cancel it.");
      onDone();
      router.refresh();
    } catch {
      toast.error("No connection. Try again when you are back online.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="welcome-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-card p-6 shadow-2xl">
        <h2 id="welcome-title" className="text-xl font-bold">
          Welcome back
        </h2>
        <p className="text-sm">
          You are still clocked in since {formatInZone(startMs, zone, "h:mm a")}. We last saw you at <strong>{formatInZone(seenMs, zone, "h:mm a")}</strong>. Are you still working?
        </p>
        {stopping ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="wb-at" className="text-sm font-medium">
                I stopped working at
              </label>
              <input id="wb-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-2 text-sm" />
            </div>
            <div className="space-y-1">
              <label htmlFor="wb-cause" className="text-sm font-medium">
                What happened?
              </label>
              <select id="wb-cause" value={cause} onChange={(e) => setCause(e.target.value as typeof cause)} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                {CAUSES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">Your lead approves this. Until then you stay clocked in, and your hours are not final.</p>
            <div className="flex gap-2">
              <Button disabled={busy || !online || !at} onClick={() => void send()}>
                Ask my lead to clock me out
              </Button>
              <Button variant="ghost" onClick={() => setStopping(false)}>
                Back
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button size="lg" className="h-11 text-base font-semibold" onClick={onDone}>
              Yes, I am still working
            </Button>
            <Button variant="outline" onClick={() => setStopping(true)}>
              No, I stopped earlier
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** After clocking out: an optional note for the day, with a template. Skipping is always fine. */
function EodNote({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const result = await saveShiftNote({ sessionId, body });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Note saved.");
      onDone();
    } catch {
      toast.error("No connection. Your note was not saved. You can add it later from My time.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="eod-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-2xl bg-card p-6 shadow-2xl">
        <h2 id="eod-title" className="text-xl font-bold">
          Wrap up your day
        </h2>
        <p className="text-sm text-muted-foreground">Optional. Your lead and HR can read it. Never include client or patient information.</p>
        <label htmlFor="eod-body" className="sr-only">
          End-of-day note
        </label>
        <Textarea id="eod-body" rows={9} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did you get done today?" />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !body.trim()} onClick={() => void save()}>
            Save note
          </Button>
          <Button variant="outline" onClick={() => setBody((b) => (b.trim() ? b : EOD_TEMPLATE))}>
            Use template
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}

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
  /** The shift end (and approved window end) whose reminder the person has already dismissed. */
  const [dismissedShiftEnd, setDismissedShiftEnd] = useState<number | null>(null);
  const [dismissedWindowEnd, setDismissedWindowEnd] = useState<number | null>(null);
  // Offline: the browser says so, or a request just failed. The server stays the only source of time, so buttons pause.
  const [requestFailed, setRequestFailed] = useState(false);
  const browserOnline = useSyncExternalStore(
    (notify) => {
      const back = () => {
        setRequestFailed(false); // the connection is back: forget the earlier failure
        notify();
      };
      window.addEventListener("online", back);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", back);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  const online = browserOnline && !requestFailed;
  /** Shown when the page comes back after a long gap: when the person was last seen. */
  const [welcome, setWelcome] = useState<{ seenMs: number } | null>(null);
  /** The session (its clock-in event) whose end-of-day note is being written. */
  const [eodSession, setEodSession] = useState<string | null>(null);
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

  // Heartbeat: while clocked in, the open page tells the server "still here". The answer says when it was last seen, so a
  // long gap (restart, sleep, lost connection) shows "welcome back" instead of silently counting.
  const waitingOnClockOut = status?.pendingClockOut ?? null;
  useEffect(() => {
    if (!working || welcome || waitingOnClockOut) return;
    // Never drop an answer: the ping itself counts as "seen", so a discarded reply would hide the gap it reported.
    const beat = async () => {
      try {
        const r = await pingPresence();
        setRequestFailed(false);
        if (r.ok && r.data.working && needsWelcomeBack(r.data.previousSeenMs, r.data.serverNowMs)) setWelcome({ seenMs: r.data.previousSeenMs! });
      } catch {
        setRequestFailed(true);
      }
    };
    void beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    const visible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [working, welcome, waitingOnClockOut]);

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
        <span className="sm:hidden">Time clock</span>
        <span className="hidden sm:inline">Set up your time clock</span>
      </Link>
    );
  }

  const run = <T,>(fn: () => Promise<ActionResult<T>>, success?: string, after?: (data: T) => void) =>
    startTransition(async () => {
      try {
        const result = await fn();
        setRequestFailed(false);
        if (!result.ok) return void toast.error(result.error);
        if (success) toast.success(success);
        after?.(result.data);
        router.refresh();
      } catch {
        // The request never reached the server, so nothing was recorded.
        setRequestFailed(true);
        toast.error("No connection. Your click was not recorded. Try again when you are back online.");
      }
    });
  const blocked = pending || !browserOnline; // a failed request only shows the notice; buttons stay usable so the person can retry

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

  // Past the end of the shift with no approved extra hours: ask whether they are working extra. Near the end of approved extra hours: remind them.
  // Neither ever clocks anyone out.
  const covered = coveringWindow(status.extraWindows, nowMs);
  const shiftOver = working && status.shiftEndMs !== null && nowMs > status.shiftEndMs + 5 * MINUTE && !covered && !status.pendingClockOut;
  const showShiftPrompt = shiftOver && dismissedShiftEnd !== status.shiftEndMs;
  const showWindowReminder = working && covered !== null && covered.endMs - nowMs <= 5 * MINUTE && dismissedWindowEnd !== covered.endMs;

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

      {!online ? (
        <span role="status" className="flex items-center gap-1 rounded-full bg-red-600/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400">
          <WifiOff className="size-3.5" aria-hidden />
          {browserOnline ? "Cannot reach ELEVATE: refresh, or sign in again" : "Offline: clock paused"}
        </span>
      ) : null}

      {!working ? (
        <Button
          size="lg"
          disabled={blocked}
          onClick={() => (status.needsSelfie ? setSelfie(true) : void doClockIn())}
          className="h-11 gap-2 px-3 text-base font-bold shadow-lg shadow-primary/30 sm:min-w-36 sm:px-6 ring-2 ring-primary/40 transition-transform hover:scale-[1.03]"
        >
          <Clock className="size-5" aria-hidden />
          Clock in
        </Button>
      ) : waitingOnClockOut ? (
        <>
          <span className="max-w-56 text-xs leading-tight text-muted-foreground" role="status">
            Waiting for approval of your clock-out at {formatInZone(waitingOnClockOut.atMs, status.zone, "h:mm a")}
          </span>
          <Button variant="outline" size="sm" disabled={blocked} onClick={() => run(() => cancelCorrection({ correctionId: waitingOnClockOut.id }), "Request cancelled. You are still clocked in.")}>
            Cancel request
          </Button>
        </>
      ) : (
        <>
          {onBreak ? (
            <Button variant="default" size="lg" className="h-10 gap-2 px-4 font-semibold" disabled={blocked} onClick={() => run(() => endBreak(), "Break ended.")}>
              <Play aria-hidden />
              End break
            </Button>
          ) : (
            <div className="relative">
              <Button variant="ghost" size="lg" className="h-10 gap-1 px-3" disabled={blocked} aria-haspopup="menu" aria-expanded={breakMenu} onClick={() => setBreakMenu((v) => !v)}>
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
          <Button
            variant="outline"
            size="lg"
            className="h-10 gap-2 px-4 font-semibold"
            disabled={blocked}
            onClick={() =>
              run(
                () => clockOut(),
                "Clocked out.",
                (data) => {
                  if (data.sessionId) setEodSession(data.sessionId);
                },
              )
            }
          >
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
                disabled={blocked}
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

      {showShiftPrompt ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="shift-over-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-card p-6 shadow-2xl">
            <h2 id="shift-over-title" className="text-xl font-bold">
              Your shift has ended
            </h2>
            <p className="text-sm">
              Your shift ended at {formatInZone(status.shiftEndMs!, status.zone, "h:mm a")}. If you are working extra hours, ask for approval so they count. If not, please clock out.
            </p>
            <div className="flex flex-col gap-2">
              <Link href="/extra-hours" onClick={() => setDismissedShiftEnd(status.shiftEndMs)} className={cn(buttonVariants({ size: "lg" }), "h-11 text-base font-semibold")}>
                Ask for extra hours
              </Link>
              <Button
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  setDismissedShiftEnd(status.shiftEndMs);
                  run(
                    () => clockOut(),
                    "Clocked out.",
                    (data) => {
                      if (data.sessionId) setEodSession(data.sessionId);
                    },
                  );
                }}
              >
                Clock out now
              </Button>
              <Button variant="ghost" onClick={() => setDismissedShiftEnd(status.shiftEndMs)}>
                Not now
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showWindowReminder && covered ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="window-end-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-card p-6 shadow-2xl">
            <h2 id="window-end-title" className="text-xl font-bold">
              Your approved extra hours end soon
            </h2>
            <p className="text-sm">They end at {formatInZone(covered.endMs, status.zone, "h:mm a")}. Please wrap up and clock out, or ask for more time.</p>
            <div className="flex flex-col gap-2">
              <Button size="lg" className="h-11 text-base font-semibold" onClick={() => setDismissedWindowEnd(covered.endMs)}>
                OK
              </Button>
              <Link href="/extra-hours" onClick={() => setDismissedWindowEnd(covered.endMs)} className={cn(buttonVariants({ variant: "outline" }))}>
                Ask for more time
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {welcome && status.sessionStartMs !== null ? <WelcomeBack seenMs={welcome.seenMs} startMs={status.sessionStartMs} zone={status.zone} online={online} onDone={() => setWelcome(null)} /> : null}

      {eodSession ? <EodNote sessionId={eodSession} onDone={() => setEodSession(null)} /> : null}

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
