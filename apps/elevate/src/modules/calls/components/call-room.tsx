"use client";

import { ChevronLeft, ChevronRight, Circle, Hand, MessageCircle, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, Smile, Square, Users, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { REACTIONS } from "../browser/call-channel";
import type { CallState } from "../service";
import { CallChat } from "./call-chat";
import { DevicesDialog } from "./call-devices";
import { PeoplePanel, ReactionFeed, RecordingNotice, Surface, Tile } from "./call-parts";
import { useCall } from "./call-provider";

// The call itself (the page's main part): a bar with the call's name, time and who is here; the picture (a shared screen with a strip of
// people, or a gallery); the chat and the people list beside it; and one control bar. Layout follows the approved design (2026-11-19).

/** "12:41" or "1:02:03": how long the call has been going. A component of its own, so the tick re-renders only this text, not the whole call room. */
export function Elapsed({ startedAt, className }: { startedAt: string; className?: string }) {
  const text = useElapsed(startedAt);
  return (
    <span className={className} aria-label={`Call time ${text}`}>
      {text}
    </span>
  );
}

function useElapsed(startedAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** One round control with its label under it. `pressed` shows it is on; `tone` makes a switched-off microphone red. */
function BarButton({ icon, label, name, pressed, tone, badge, onClick, expanded }: { icon: ReactNode; label: string; name: string; pressed?: boolean; tone?: "danger"; badge?: number; onClick: () => void; expanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={name}
      aria-pressed={pressed}
      aria-expanded={expanded}
      className={cn(
        "relative flex w-14 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        pressed && "text-primary",
        tone === "danger" && "text-destructive",
      )}
    >
      <span className={cn("flex size-9 items-center justify-center rounded-full [&_svg]:size-5", pressed ? "bg-primary/10" : "bg-background", tone === "danger" && "bg-destructive-surface")} aria-hidden>
        {icon}
      </span>
      <span aria-hidden>{label}</span>
      {badge ? (
        <span aria-hidden className="absolute top-0.5 right-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/** Closes a popup on a click outside it or on Escape, from anywhere (not only while its button has focus). */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  return ref;
}

/** The five fixed reactions, in a small tray above the bar. Each is a tiny hint on the call channel; nothing typed. */
function ReactionTray() {
  const call = useCall();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <span className="relative" ref={ref}>
      <BarButton icon={<Smile />} label="React" name="Send a reaction" expanded={open} pressed={open} onClick={() => setOpen((v) => !v)} />
      {open ? (
        <span role="group" aria-label="Reactions" className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 gap-1 rounded-full border bg-popover p-1.5 shadow-md">
          {REACTIONS.map((emoji) => (
            <Button
              key={emoji}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Send ${emoji}`}
              onClick={() => {
                call.sendReaction(emoji);
                setOpen(false);
              }}
            >
              <span aria-hidden className="text-lg">
                {emoji}
              </span>
            </Button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

type Panel = "chat" | "people" | null;

function ControlBar({ panel, setPanel, unread, people }: { panel: Panel; setPanel: (p: Panel) => void; unread: number; people: number }) {
  const call = useCall();
  const confirm = useConfirm();
  const [more, setMore] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const moreRef = useDismiss(more, () => setMore(false));
  const isHost = call.state?.me.role === "host";
  const recording = call.state?.recording ?? null;
  const iRecord = recording?.recorderUserId === call.userId;
  const toggle = (p: Exclude<Panel, null>) => setPanel(panel === p ? null : p);

  async function endForEveryone() {
    setMore(false);
    const others = (call.state?.participants.length ?? 1) - 1;
    const sure = await confirm({
      title: "End the call for everyone?",
      description: others > 0 ? `${others} ${others === 1 ? "person" : "people"} will be disconnected right now. This can't be undone. To go without ending it for them, use Leave instead.` : "The call will end. This can't be undone.",
      confirmLabel: "End for everyone",
      cancelLabel: "Keep the call going",
      destructive: true,
    });
    if (sure) void call.endForEveryone();
  }

  return (
    <div className="flex justify-center px-3 pt-2 pb-3">
      <div className="flex flex-wrap items-center justify-center gap-1 rounded-3xl bg-muted p-1.5" role="toolbar" aria-label="Call controls">
        {call.canPublish ? (
          <>
            <BarButton icon={call.micOn ? <Mic /> : <MicOff />} label={call.micOn ? "Mute" : "Unmute"} name={call.micOn ? "Mute microphone" : "Unmute microphone"} pressed={call.micOn} tone={call.micOn ? undefined : "danger"} onClick={() => void call.toggleMic()} />
            <BarButton icon={call.cameraOn ? <Video /> : <VideoOff />} label="Camera" name={call.cameraOn ? "Turn camera off" : "Turn camera on"} pressed={call.cameraOn} onClick={() => void call.toggleCamera()} />
            <BarButton icon={<MonitorUp />} label={call.screenOn ? "Stop" : "Share"} name={call.screenOn ? "Stop sharing your screen" : "Share your screen"} pressed={call.screenOn} onClick={() => void call.toggleScreen()} />
          </>
        ) : null}
        <ReactionTray />
        <BarButton icon={<Hand />} label="Hand" name={call.handUp ? "Lower your hand" : "Raise your hand"} pressed={call.handUp} onClick={call.toggleHand} />
        <BarButton icon={<MessageCircle />} label="Chat" name={unread > 0 ? `Chat (${unread} new)` : "Chat"} pressed={panel === "chat"} badge={unread} onClick={() => toggle("chat")} />
        <BarButton icon={<Users />} label="People" name={`People (${people})`} pressed={panel === "people"} onClick={() => toggle("people")} />
        {call.canPublish && call.abilities.record && !recording ? <BarButton icon={<Circle className="fill-destructive text-destructive" />} label="Record" name="Start recording" onClick={() => void call.startRecording()} /> : null}
        {recording && (iRecord || isHost) ? <BarButton icon={<Square className="fill-current" />} label="Stop rec." name="Stop recording" tone="danger" onClick={() => void call.stopRecording()} /> : null}
        <Button type="button" variant="destructive" className="mx-1 h-11 rounded-full bg-destructive px-4 text-white hover:bg-destructive/90" onClick={() => void call.leave()} aria-label="Leave call">
          <PhoneOff aria-hidden />
          Leave
        </Button>
        <span className="relative" ref={moreRef}>
            <Button type="button" variant="ghost" size="icon" aria-label="More call options" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((v) => !v)}>
              <MoreHorizontal aria-hidden />
            </Button>
            {more ? (
              <div
                role="menu"
                aria-label="More call options"
                className="absolute right-0 bottom-full z-10 mb-2 w-48 rounded-xl border bg-popover p-1 shadow-md"
                onKeyDown={(e) => {
                  // Arrow keys move between the items (the menu's own rule).
                  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
                  const at = items.indexOf(document.activeElement as HTMLElement);
                  items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
                  e.preventDefault();
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setMore(false);
                    setDevicesOpen(true);
                  }}
                >
                  Devices
                </button>
                {isHost ? (
                  <button type="button" role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive-surface" onClick={() => void endForEveryone()}>
                    End for everyone
                  </button>
                ) : null}
              </div>
            ) : null}
          </span>
      </div>
      <DevicesDialog open={devicesOpen} onOpenChange={setDevicesOpen} />
    </div>
  );
}

/** At most this many other people's tiles: video for one page, then name circles (they cost nothing to show). The People list has everyone. */
const MAX_OTHER_TILES = 11;

export function ActiveCall({ state }: { state: CallState }) {
  const call = useCall();
  // On a wide screen the chat is open from the start (the design); on a narrow one the picture gets the whole width. (This part only
  // renders after joining, in the browser, so reading the window here is safe.)
  const [panel, setPanelState] = useState<Panel>(() => (typeof window !== "undefined" && window.innerWidth >= 1024 ? "chat" : null));
  const [unread, setUnread] = useState(0);
  const setPanel = (next: Panel) => {
    setPanelState(next);
    if (next === "chat") setUnread(0); // looking at the chat: nothing is unread
  };

  const me = state.participants.find((p) => p.userId === call.userId);
  const townhall = state.call.mode === "townhall";
  // In an all-hands the stage is the host and speakers; the audience is a count and the People list, not 100 name circles.
  const others = state.participants.filter((p) => p.userId !== call.userId && (!townhall || p.role !== "attendee"));
  const watching = townhall ? state.participants.filter((p) => p.role === "attendee").length : 0;
  const withVideo = call.visibleUserIds;
  const shown = [...others.filter((p) => withVideo.includes(p.userId)), ...others.filter((p) => !withVideo.includes(p.userId))].slice(0, MAX_OTHER_TILES);
  const hidden = others.length - shown.length;
  const sharers = [
    ...(call.screenOn && call.localScreen ? [{ key: "me", name: "Your screen", stream: call.localScreen }] : []),
    ...others.flatMap((p) => (call.remote[p.userId]?.screen ? [{ key: p.userId, name: `${p.name}'s screen`, stream: call.remote[p.userId].screen }] : [])),
  ];
  const recording = state.recording;

  return (
    <section aria-label="Call" className="flex flex-col overflow-clip rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <Video className="size-4 text-primary" aria-hidden />
        <h2 className="font-heading text-sm font-semibold">{state.call.title}</h2>
        <Elapsed startedAt={state.call.startedAt} className="text-sm text-muted-foreground tabular-nums" />
        <p className="text-sm text-muted-foreground" role="status">
          {townhall ? `All-hands: ${watching} watching, ${state.participants.length - watching} on stage.` : `${state.participants.length} ${state.participants.length === 1 ? "person" : "people"} in this call${others.length === 0 ? ". Waiting for others to join." : "."}`}
        </p>
        {recording ? (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-destructive-surface px-2.5 py-0.5 text-xs font-medium text-destructive">
            <span className="size-2 rounded-full bg-destructive" aria-hidden /> Recording
          </span>
        ) : null}
      </div>

      {/* On a wide screen the room has a fixed height (the rest of the window, between 26 and 48 rem), so a long chat scrolls inside its own panel
          and the control bar below always stays in view. The videos scroll inside their own column when there are many. */}
      <div className={cn("grid min-h-[26rem] lg:h-[clamp(26rem,calc(100dvh-15rem),48rem)]", panel !== null && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        <div className="relative flex min-w-0 flex-col gap-3 p-3 lg:min-h-0 lg:overflow-y-auto">
          <RecordingNotice />
          {sharers.length > 0 ? (
            <ul aria-label="Shared screens" className="grid gap-3">
              {sharers.map((s, i) => (
                <li key={s.key} className={cn("relative aspect-video", i === 0 ? "max-h-[56vh]" : "max-h-40")} data-testid="screen-share">
                  <Surface stream={s.stream} label={s.name} className="size-full bg-muted" />
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                    <MonitorUp className="size-3" aria-hidden /> {s.name}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <ul aria-label="People in the call" className={cn("grid gap-2", sharers.length > 0 ? "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]" : "grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3")}>
            {me && call.canPublish ? <Tile seat={me} mine strip={sharers.length > 0} /> : null}
            {shown.map((p) => (
              <Tile key={p.userId} seat={p} mine={false} strip={sharers.length > 0} />
            ))}
          </ul>
          {hidden > 0 || call.pages > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {hidden > 0 ? (
                <span>
                  {hidden} more {hidden === 1 ? "person is" : "people are"} in the call (see People).
                </span>
              ) : null}
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
          <div className="pointer-events-none absolute right-4 bottom-4 left-4 flex justify-end">
            <ReactionFeed />
          </div>
        </div>

        <aside aria-label="Chat and people" className={cn("flex min-h-0 flex-col overflow-clip border-t lg:border-t-0 lg:border-l", panel === null && "hidden lg:hidden")}>
          <div className="flex border-b" role="group" aria-label="Side panel">
            <button type="button" aria-pressed={panel === "chat"} onClick={() => setPanel("chat")} className={cn("flex-1 border-b-2 py-2.5 text-sm font-medium", panel === "chat" ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}>
              Chat{unread > 0 ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{unread}</span> : null}
            </button>
            <button type="button" aria-pressed={panel === "people"} onClick={() => setPanel("people")} className={cn("flex-1 border-b-2 py-2.5 text-sm font-medium", panel === "people" ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}>
              Participants {state.participants.length}
            </button>
          </div>
          <div className="flex max-h-[32rem] min-h-72 flex-1 flex-col lg:max-h-none lg:min-h-0">
            {/* The chat stays mounted while the panel shows People or is closed, so new messages still count and nothing is missed. */}
            <CallChat conversationId={state.call.conversationId} userId={call.userId} open={panel === "chat"} onNew={() => setUnread((n) => n + 1)} />
            {panel === "people" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <PeoplePanel state={state} />
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <ControlBar panel={panel} setPanel={setPanel} unread={unread} people={state.participants.length} />
    </section>
  );
}
