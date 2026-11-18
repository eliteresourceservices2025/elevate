"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/feedback-dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { startRingtone, unlockAudio } from "@/modules/messages/components/play-sound";
import { useChatLive } from "@/modules/messages/components/use-chat-live";
import type { ChatSignal } from "@/modules/messages/realtime-types";
import { callApi } from "../browser/api";
import { connectCallChannel, type CallChannelClient, type CallPresence } from "../browser/call-channel";
import { createTransport, type CallTransport, type MediaApi, type RemoteSlot } from "../browser/transport";
import type { CallState } from "../service";
import { chooseSubscriptions } from "../track-selection";

// Holds a call together while people move around ELEVATE: the lobby, joining, the media connection, who is here, the 30-second heartbeat,
// and the ring for an incoming call. It lives in the app frame (staff) and the guest frame, never in a page, so the call survives
// navigation. The server is the authority (who is in, what may be pulled); this keeps the browser in step with it.

export type Phase = "idle" | "lobby" | "joining" | "active";
export type Incoming = { callId: string; conversationId: string; title: string; startedByName: string };
export type RemoteMedia = { main: MediaStream | null; screen: MediaStream | null };

type Value = {
  phase: Phase;
  callId: string | null;
  state: CallState | null;
  error: string | null;
  incoming: Incoming | null;
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  /** My own camera / screen previews. */
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  remote: Record<string, RemoteMedia>;
  presence: Record<string, CallPresence>;
  handUp: boolean;
  /** What I want when I join (set in the lobby). */
  prefs: { mic: boolean; camera: boolean };
  setPrefs: (next: { mic: boolean; camera: boolean }) => void;
  open: (callId: string) => void;
  start: (conversationId: string) => Promise<string | null>;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  endForEveryone: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  toggleHand: () => void;
  answerIncoming: () => string | null;
  dismissIncoming: () => void;
  /** The one call people are in right now, if any (for the mini window and the call button). */
  userId: string;
};

const Ctx = createContext<Value | null>(null);

export function useCall(): Value {
  const value = useContext(Ctx);
  if (!value) throw new Error("useCall needs a CallProvider");
  return value;
}

const HEARTBEAT_MS = 30_000;
/** A call nobody answered ends on its own after this long, as a missed call. */
const UNANSWERED_MS = 45_000;

export function CallProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [prefs, setPrefs] = useState({ mic: true, camera: false });
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [localCamera, setLocalCamera] = useState<MediaStream | null>(null);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<Record<string, RemoteMedia>>({});
  const [presence, setPresence] = useState<Record<string, CallPresence>>({});
  const [handUp, setHandUp] = useState(false);

  const transport = useRef<CallTransport | null>(null);
  const channel = useRef<{ update: (p: CallPresence) => void; stop: () => void } | null>(null);
  const timers = useRef<{ heartbeat?: ReturnType<typeof setInterval>; unanswered?: ReturnType<typeof setTimeout> }>({});
  const live = useRef({ callId: null as string | null, phase: "idle" as Phase, state: null as CallState | null, micOn: false, handUp: false, othersEverJoined: false });
  const refreshing = useRef(false);
  const again = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const stopRing = useRef<(() => void) | null>(null);

  useEffect(() => {
    live.current.callId = callId;
    live.current.phase = phase;
    live.current.state = state;
    live.current.micOn = micOn;
    live.current.handUp = handUp;
  });

  const reset = useCallback(() => {
    clearInterval(timers.current.heartbeat);
    clearTimeout(timers.current.unanswered);
    timers.current = {};
    transport.current?.stop();
    transport.current = null;
    channel.current?.stop();
    channel.current = null;
    live.current.othersEverJoined = false;
    setState(null);
    setMicOn(false);
    setCameraOn(false);
    setScreenOn(false);
    setLocalCamera(null);
    setLocalScreen(null);
    setRemote({});
    setPresence({});
    setHandUp(false);
    setError(null);
    setCallId(null);
    setPhase("idle");
  }, []);

  // ---- keeping the media in step with the roster -------------------------------------------------------------------------------
  const applyState = useCallback(
    async (next: CallState) => {
      setState(next);
      if (next.participants.some((p) => p.userId !== userId)) live.current.othersEverJoined = true;
      const picked = chooseSubscriptions({ tracks: next.tracks, selfUserId: userId, mode: next.call.mode });
      try {
        await transport.current?.syncRemote(picked.pull);
      } catch {
        // A failed pull is retried on the next heartbeat or event.
      }
    },
    [userId],
  );

  const refresh = useCallback(async () => {
    const id = live.current.callId;
    if (!id || live.current.phase !== "active") return;
    // A change that arrives while a refresh is running gets one more refresh right after it (not dropped until the next heartbeat).
    if (refreshing.current) {
      again.current = true;
      return;
    }
    refreshing.current = true;
    try {
      const beat = await callApi.heartbeat(id);
      if (beat.status === "ended" || beat.status === "removed") {
        toast.message(beat.status === "ended" ? "The call ended." : "You were removed from the call.");
        reset();
        return;
      }
      await applyState(beat.state);
    } catch {
      // Offline for a moment: the next beat tries again. After 90 seconds the server lets the seat go.
    } finally {
      refreshing.current = false;
      if (again.current) {
        again.current = false;
        void refreshRef.current();
      }
    }
  }, [applyState, reset]);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  // ---- lobby, join, leave ------------------------------------------------------------------------------------------------------
  /** Media and the heartbeat stop at once; the page only moves on after the server has recorded the leave, so the chat it returns to already shows "Call ended". */
  const stopQuietly = useCallback(() => {
    clearInterval(timers.current.heartbeat);
    clearTimeout(timers.current.unanswered);
    transport.current?.stop();
    transport.current = null;
  }, []);

  const leaveNow = useCallback(async () => {
    const id = live.current.callId;
    stopQuietly();
    if (id) await callApi.leave(id).catch(() => {});
    reset();
  }, [reset, stopQuietly]);

  const open = useCallback((id: string) => {
    if (live.current.callId === id && live.current.phase !== "idle") return;
    if (live.current.phase === "active" || live.current.phase === "joining") return; // already in another call
    // The refs are set right now (not after the next render) because the page may ask to join in the very same moment.
    live.current.callId = id;
    live.current.phase = "lobby";
    setCallId(id);
    setPhase("lobby");
    setError(null);
  }, []);

  const mediaApiFor = useCallback(
    (id: string): MediaApi => ({
      publish: async (offerSdp, tracks) => {
        const out = await callApi.publish(id, offerSdp, tracks);
        return { answerSdp: out.answer.sdp, tracks: out.tracks };
      },
      close: async (names) => void (await callApi.close(id, names)),
      subscribe: async (names) => {
        const out = await callApi.subscribe(id, names);
        return { offerSdp: out.offer.sdp, tracks: out.tracks };
      },
      answer: async (sdp) => void (await callApi.answer(id, sdp)),
    }),
    [],
  );

  const join = useCallback(async () => {
    const id = live.current.callId;
    if (!id || live.current.phase !== "lobby") return;
    live.current.phase = "joining";
    setPhase("joining");
    setError(null);
    unlockAudio();
    try {
      const joined = await callApi.join(id);
      const t = await createTransport();
      transport.current = t;
      await t.start({
        iceServers: joined.iceServers,
        api: mediaApiFor(id),
        onRemote: (uid: string, slot: RemoteSlot, stream) => setRemote((r) => ({ ...r, [uid]: { main: r[uid]?.main ?? null, screen: r[uid]?.screen ?? null, [slot]: stream } })),
        onLocalEnded: (kind) => {
          if (kind === "screen") {
            setScreenOn(false);
            setLocalScreen(null);
          }
        },
      });
      const client = createSupabaseBrowserClient() as unknown as CallChannelClient;
      channel.current = connectCallChannel(client, id, userId, { muted: !prefs.mic, hand: false }, { presence: setPresence, event: () => void refresh() });
      setState(joined);
      if (joined.participants.some((p) => p.userId !== userId)) live.current.othersEverJoined = true;
      setPhase("active");
      live.current.phase = "active";
      timers.current.heartbeat = setInterval(() => void refresh(), HEARTBEAT_MS);
      // Nobody answered: end it as a missed call instead of waiting forever.
      timers.current.unanswered = setTimeout(() => {
        if (live.current.phase === "active" && !live.current.othersEverJoined && live.current.state?.me.role === "host") {
          toast.message("Nobody joined. The call ended.");
          void leaveNow();
        }
      }, UNANSWERED_MS);
      // Devices last, so a missing microphone doesn't stop you joining.
      if (prefs.mic) {
        try {
          await t.startSending("audio");
          setMicOn(true);
        } catch {
          toast.error("Couldn't use your microphone. Check the browser's permission, then press the microphone button.");
          channel.current?.update({ muted: true, hand: false });
        }
      }
      if (prefs.camera) {
        try {
          setLocalCamera(await t.startSending("video"));
          setCameraOn(true);
        } catch {
          toast.error("Couldn't use your camera. Check the browser's permission.");
        }
      }
      await applyState(joined);
    } catch (e) {
      transport.current?.stop();
      transport.current = null;
      setError(e instanceof Error ? e.message : "Couldn't join the call.");
      live.current.phase = "lobby";
      setPhase("lobby");
    }
  }, [applyState, leaveNow, mediaApiFor, prefs.camera, prefs.mic, refresh, userId]);

  const endForEveryone = useCallback(async () => {
    const id = live.current.callId;
    stopQuietly();
    if (id) await callApi.end(id).catch((e: Error) => toast.error(e.message));
    reset();
  }, [reset, stopQuietly]);

  const start = useCallback(async (conversationId: string) => {
    unlockAudio();
    try {
      return (await callApi.start(conversationId)).callId;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the call.");
      return null;
    }
  }, []);

  // ---- microphone, camera, screen, hand ----------------------------------------------------------------------------------------
  const toggleMic = useCallback(async () => {
    const t = transport.current;
    if (!t) return;
    try {
      if (!t.isSending("audio")) {
        await t.startSending("audio");
        setMicOn(true);
        channel.current?.update({ muted: false, hand: live.current.handUp });
        return;
      }
      const next = !live.current.micOn;
      t.setMicEnabled(next);
      setMicOn(next);
      channel.current?.update({ muted: !next, hand: live.current.handUp });
    } catch {
      toast.error("Couldn't use your microphone. Check the browser's permission.");
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    const t = transport.current;
    if (!t) return;
    try {
      if (t.isSending("video")) {
        await t.stopSending("video");
        setCameraOn(false);
        setLocalCamera(null);
      } else {
        setLocalCamera(await t.startSending("video"));
        setCameraOn(true);
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message !== "No device found." ? e.message : "Couldn't use your camera. Check the browser's permission.");
    }
  }, []);

  const toggleScreen = useCallback(async () => {
    const t = transport.current;
    if (!t) return;
    try {
      if (t.isSending("screen")) {
        await t.stopSending("screen");
        setScreenOn(false);
        setLocalScreen(null);
      } else {
        setLocalScreen(await t.startSending("screen"));
        setScreenOn(true);
      }
    } catch {
      // The person closed the picker: nothing to say.
    }
  }, []);

  const toggleHand = useCallback(() => {
    const next = !live.current.handUp;
    setHandUp(next);
    channel.current?.update({ muted: !live.current.micOn, hand: next });
  }, []);

  // ---- incoming calls ----------------------------------------------------------------------------------------------------------
  const clearIncoming = useCallback(() => {
    stopRing.current?.();
    stopRing.current = null;
    setIncoming(null);
  }, []);

  const onSignal = useCallback(
    async (signal: ChatSignal) => {
      if (signal.type !== "call" || !signal.callId) return;
      const id = signal.callId;
      try {
        const info = await callApi.incoming(id);
        if (!info || live.current.callId === id) {
          setIncoming((current) => {
            if (current?.callId === id) {
              stopRing.current?.();
              stopRing.current = null;
              return null;
            }
            return current;
          });
          return;
        }
        if (live.current.phase === "active" || live.current.phase === "joining") return; // busy in another call: the banner in the chat still shows
        setIncoming((current) => {
          if (current?.callId === id) return current;
          stopRing.current?.();
          stopRing.current = startRingtone(30);
          return { callId: id, conversationId: info.conversationId, title: info.title, startedByName: info.startedByName };
        });
      } catch {
        // Not for me (or gone): nothing rings.
      }
    },
    [],
  );
  useChatLive(userId, onSignal);

  // A ring stops by itself after 30 seconds.
  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(clearIncoming, 30_000);
    return () => clearTimeout(timer);
  }, [incoming, clearIncoming]);

  // Leaving the page for good (closing the tab) is covered by the server: a seat silent for 90 seconds is treated as left.
  useEffect(() => () => void transport.current?.stop(), []);

  const answerIncoming = useCallback(() => {
    const id = incoming?.callId ?? null;
    clearIncoming();
    return id;
  }, [incoming, clearIncoming]);

  const value = useMemo<Value>(
    () => ({
      phase, callId, state, error, incoming, micOn, cameraOn, screenOn, localCamera, localScreen, remote, presence, handUp, prefs, setPrefs,
      open, start, join, leave: leaveNow, endForEveryone, toggleMic, toggleCamera, toggleScreen, toggleHand, answerIncoming, dismissIncoming: clearIncoming, userId,
    }),
    [phase, callId, state, error, incoming, micOn, cameraOn, screenOn, localCamera, localScreen, remote, presence, handUp, prefs, open, start, join, leaveNow, endForEveryone, toggleMic, toggleCamera, toggleScreen, toggleHand, answerIncoming, clearIncoming, userId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
