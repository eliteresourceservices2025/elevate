"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/feedback-dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { startRingtone, unlockAudio } from "@/modules/messages/components/play-sound";
import { useChatLive } from "@/modules/messages/components/use-chat-live";
import type { ChatSignal } from "@/modules/messages/realtime-types";
import { callApi } from "../browser/api";
import { connectCallChannel, type CallChannelClient, type CallPresence, type Reaction } from "../browser/call-channel";
import { NO_CHOICE, NO_DEVICES, loadChosen, saveChosen, splitDevices, stillThere, type Chosen, type DeviceKind, type DeviceLists } from "../browser/devices";
import { CallRecorder } from "../browser/recorder";
import { pickRecordedVideo } from "../recording-rules";
import { createTransport, type CallTransport, type MediaApi, type RemoteSlot } from "../browser/transport";
import type { CallState } from "../service";
import { nextSpeaker, type SpeakerState } from "../active-speaker";
import { chooseSubscriptions, mayPublish } from "../track-selection";

// Holds a call together while people move around ELEVATE: the lobby, joining, the media connection, who is here, the 30-second heartbeat,
// and the ring for an incoming call. It lives in the app frame (staff) and the guest frame, never in a page, so the call survives
// navigation. The server is the authority (who is in, what may be pulled); this keeps the browser in step with it.

export type Phase = "idle" | "lobby" | "joining" | "active";
export type Incoming = { callId: string; conversationId: string; title: string; startedByName: string };
export type RemoteMedia = { main: MediaStream | null; screen: MediaStream | null };
export type Abilities = { record: boolean; townhall: boolean };
export type ReactionItem = { key: number; emoji: Reaction; name: string };

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
  /** Paging through video tiles (about 9 on a page): the page showing, how many pages, whose video is on screen, who is pinned, who is speaking. */
  page: number;
  pages: number;
  visibleUserIds: string[];
  pinnedUserId: string | null;
  activeSpeakerId: string | null;
  setPage: (page: number) => void;
  pin: (userId: string | null) => void;
  /** What this person may do beyond ordinary calls (set by their role and a Super Admin's picks). */
  abilities: Abilities;
  /** I may send audio and video in this call right now (always in a meeting; only hosts and speakers in an all-hands). */
  canPublish: boolean;
  /** Recent reactions from the audience (each stays on screen a few seconds). */
  reactions: ReactionItem[];
  sendReaction: (emoji: Reaction) => void;
  /** Host, in an all-hands: make someone a speaker, or put them back in the audience. */
  makeSpeaker: (userId: string, speaker: boolean) => Promise<void>;
  /** Recording: the person with the Super Admin's pick starts and stops it; everyone in the call answers yes or no. */
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  answerRecording: (answer: "allow" | "decline") => Promise<void>;
  /** Host controls (the server checks they are the host). */
  muteOther: (userId: string) => Promise<void>;
  removeOther: (userId: string) => Promise<void>;
  /** Microphones, cameras and speakers this computer has, what I chose (null = the browser's default), and how to change it (also while in a call). */
  devices: DeviceLists;
  chosen: Chosen;
  chooseDevice: (kind: DeviceKind, id: string | null) => Promise<void>;
  refreshDevices: () => Promise<void>;
  /** What I want when I join (set in the lobby). */
  prefs: { mic: boolean; camera: boolean };
  setPrefs: (next: { mic: boolean; camera: boolean }) => void;
  open: (callId: string) => void;
  start: (conversationId: string, mode?: "meeting" | "townhall") => Promise<string | null>;
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

const NO_ABILITIES: Abilities = { record: false, townhall: false };
const HEARTBEAT_MS = 30_000;
/** Leaving waits at most this long for the recorder's last piece to upload. */
const FLUSH_MS = 20_000;
/** A call nobody answered ends on its own after this long, as a missed call. */
const UNANSWERED_MS = 45_000;

export function CallProvider({ userId, abilities = NO_ABILITIES, children }: { userId: string; abilities?: Abilities; children: ReactNode }) {
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
  const [page, setPageState] = useState(0);
  const [pinnedUserId, setPinned] = useState<string | null>(null);
  const [activeSpeakerId, setSpeaker] = useState<string | null>(null);

  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  const [devices, setDevices] = useState<DeviceLists>(NO_DEVICES);
  const [chosen, setChosen] = useState<Chosen>(NO_CHOICE);
  const chosenRef = useRef<Chosen>(NO_CHOICE);
  const myPresence = useRef<CallPresence>({ muted: true, hand: false });
  const seenReaction = useRef(new Map<string, number>());
  const reactionKey = useRef(0);
  const lastReactionAt = useRef(0);
  const micStream = useRef<MediaStream | null>(null);
  // Bumped whenever my microphone stream is replaced, so the recording follows it (a ref change alone does not re-run anything).
  const [micVersion, setMicVersion] = useState(0);
  const setMic = useCallback((stream: MediaStream | null) => {
    micStream.current = stream;
    setMicVersion((v) => v + 1);
  }, []);
  const recorder = useRef<CallRecorder | null>(null);
  const transport = useRef<CallTransport | null>(null);
  const channel = useRef<{ update: (p: CallPresence) => void; stop: () => void } | null>(null);
  const timers = useRef<{ heartbeat?: ReturnType<typeof setInterval>; unanswered?: ReturnType<typeof setTimeout> }>({});
  const live = useRef({ callId: null as string | null, phase: "idle" as Phase, state: null as CallState | null, micOn: false, handUp: false, othersEverJoined: false, remote: {} as Record<string, RemoteMedia> });
  const refreshing = useRef(false);
  const again = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const stopRing = useRef<(() => void) | null>(null);
  /** When I last started or stopped sending something (a heartbeat that predates it must not be mistaken for the host muting me). */
  const lastLocalChange = useRef(0);
  const view = useRef({ page: 0, pinned: null as string | null, speaker: null as string | null });

  useEffect(() => {
    live.current.callId = callId;
    live.current.phase = phase;
    live.current.state = state;
    live.current.micOn = micOn;
    live.current.handUp = handUp;
    live.current.remote = remote;
    view.current = { page, pinned: pinnedUserId, speaker: activeSpeakerId };
  });

  const reset = useCallback(() => {
    clearInterval(timers.current.heartbeat);
    clearTimeout(timers.current.unanswered);
    timers.current = {};
    transport.current?.stop();
    transport.current = null;
    channel.current?.stop();
    channel.current = null;
    micStream.current = null;
    seenReaction.current.clear();
    setReactions([]);
    myPresence.current = { muted: true, hand: false };
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
    setPageState(0);
    setPinned(null);
    setSpeaker(null);
    setError(null);
    setCallId(null);
    setPhase("idle");
  }, []);

  // ---- keeping the media in step with the roster -------------------------------------------------------------------------------
  /** Tells the others my own little hints (muted, hand, latest reaction). Never anything typed. */
  const announce = useCallback((patch: Partial<CallPresence>) => {
    myPresence.current = { ...myPresence.current, ...patch };
    channel.current?.update(myPresence.current);
  }, []);

  const onPresence = useCallback((byUser: Record<string, CallPresence>) => {
    setPresence(byUser);
    // A reaction I have not seen yet floats up for a few seconds. (The sender's clock is not trusted: I note when I saw it.)
    for (const [uid, p] of Object.entries(byUser)) {
      if (!p.reaction || seenReaction.current.get(uid) === p.reaction.at) continue;
      seenReaction.current.set(uid, p.reaction.at);
      const key = ++reactionKey.current;
      const name = uid === userId ? "You" : (live.current.state?.participants.find((x) => x.userId === uid)?.name ?? "Someone");
      setReactions((r) => [...r.slice(-7), { key, emoji: p.reaction!.emoji, name }]);
      setTimeout(() => setReactions((r) => r.filter((x) => x.key !== key)), 5000);
    }
  }, [userId]);

  const applyState = useCallback(
    async (next: CallState) => {
      const before = live.current.state;
      setState(next);
      if (next.participants.some((p) => p.userId !== userId)) live.current.othersEverJoined = true;
      // All-hands: the host made me a speaker, or put me back in the audience.
      if (before && before.me.role !== next.me.role && next.call.mode === "townhall") {
        const wasSpeaker = mayPublish(next.call.mode, before.me.role);
        const isSpeaker = mayPublish(next.call.mode, next.me.role);
        if (isSpeaker && !wasSpeaker) toast.message("You're a speaker now. Turn on your microphone and camera when you're ready.");
        if (!isSpeaker && wasSpeaker) {
          for (const kind of ["audio", "video", "screen"] as const) if (transport.current?.isSending(kind)) await transport.current.stopSending(kind).catch(() => {});
          setMic(null);
          setMicOn(false);
          setCameraOn(false);
          setLocalCamera(null);
          setScreenOn(false);
          setLocalScreen(null);
          announce({ muted: true });
          toast.message("You're back in the audience.");
        }
      }
      // The host switched my microphone off at the server: stop sending it here too, and say so. (Pulling is decided in the effect below.)
      const t = transport.current;
      if (t && t.isSending("audio") && Date.now() - lastLocalChange.current > 6000 && !next.tracks.some((x) => x.userId === userId && x.kind === "audio")) {
        await t.stopSending("audio").catch(() => {});
        setMicOn(false);
        announce({ muted: true });
        toast.message("The host switched off your microphone. Press the microphone button to unmute.");
      }
    },
    [announce, userId],
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
      // Anything wanted that has not arrived yet (a pull that failed because the other person's video had not started) is asked for again.
      const again = chooseSubscriptions({ tracks: beat.state.tracks, selfUserId: userId, mode: beat.state.call.mode, page: view.current.page, pinnedUserId: view.current.pinned, activeSpeakerId: view.current.speaker });
      void transport.current?.syncRemote(again.pull).catch(() => {});
    } catch (e) {
      // "Call not found" is the server saying I am not in this chat any more: leave the call. Anything else is a hiccup (offline for a moment):
      // the next beat tries again, and after 90 seconds the server lets the seat go.
      if (e instanceof Error && e.message === "Call not found.") {
        toast.message("You are no longer in this call.");
        reset();
      }
    } finally {
      refreshing.current = false;
      if (again.current) {
        again.current = false;
        void refreshRef.current();
      }
    }
  }, [applyState, reset, userId]);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  // ---- what to pull: everyone's audio, video for one page of tiles ---------------------------------------------------------------
  const selection = useMemo(
    () => (state ? chooseSubscriptions({ tracks: state.tracks, selfUserId: userId, mode: state.call.mode, page, pinnedUserId, activeSpeakerId }) : null),
    [state, userId, page, pinnedUserId, activeSpeakerId],
  );
  const shownPage = selection ? Math.min(page, selection.pages - 1) : 0;
  const pullKey = selection ? selection.pull.map((t) => t.trackName).sort().join(",") : "";
  useEffect(() => {
    if (phase !== "active" || !selection) return;
    // Steps on the connection run one at a time inside the transport. A pull can fail because the other person's video has not started
    // flowing yet (Cloudflare says so after a few seconds), so it is tried again a few times, a little later each time.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      transport.current?.syncRemote(selection.pull).catch(() => {
        if (!cancelled && n < 20) timer = setTimeout(() => attempt(n + 1), Math.min(1500 * (n + 1), 6000));
      });
    };
    attempt(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the set of wanted tracks changes, not on every state refresh
  }, [pullKey, phase]);

  // Who is speaking (from how loud each person is), so their video is pulled first in a big meeting. Real audio only.
  useEffect(() => {
    if (phase !== "active") return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const analysers = new Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; stream: MediaStream }>();
    let speaker: SpeakerState = { id: null, quiet: 0 };
    const buffer = new Uint8Array(512);
    const timer = setInterval(() => {
      const current = live.current.remote;
      for (const [uid, entry] of analysers) {
        if (current[uid]?.main !== entry.stream) {
          entry.source.disconnect();
          analysers.delete(uid);
        }
      }
      const levels: Record<string, number> = {};
      for (const [uid, media] of Object.entries(current)) {
        const stream = media.main;
        if (!stream || stream.getAudioTracks().length === 0) continue;
        let entry = analysers.get(uid);
        if (!entry) {
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          entry = { analyser, source, stream };
          analysers.set(uid, entry);
        }
        entry.analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += ((v - 128) / 128) ** 2;
        levels[uid] = Math.sqrt(sum / buffer.length);
      }
      const next = nextSpeaker(levels, speaker);
      if (next.id !== speaker.id) setSpeaker(next.id);
      speaker = next;
    }, 400);
    return () => {
      clearInterval(timer);
      void ctx.close().catch(() => {});
    };
  }, [phase]);

  const setPage = useCallback((next: number) => setPageState(Math.max(0, next)), []);
  const pin = useCallback((uid: string | null) => {
    setPinned(uid);
    setPageState(0);
  }, []);

  const muteOther = useCallback(async (uid: string) => {
    const id = live.current.callId;
    if (!id) return;
    try {
      await callApi.mute(id, uid);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't do that.");
    }
  }, []);
  const removeOther = useCallback(async (uid: string) => {
    const id = live.current.callId;
    if (!id) return;
    try {
      await callApi.remove(id, uid);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't do that.");
    }
  }, []);

  // ---- microphone, camera and speakers --------------------------------------------------------------------------------------------
  const refreshDevices = useCallback(async () => {
    try {
      const list = splitDevices(await navigator.mediaDevices.enumerateDevices());
      setDevices(list);
      // A chosen device that has been unplugged goes back to the default (the call itself keeps working).
      const still: Chosen = { mic: stillThere(chosenRef.current.mic, list.mics), cam: stillThere(chosenRef.current.cam, list.cams), speaker: stillThere(chosenRef.current.speaker, list.speakers) };
      if (still.mic !== chosenRef.current.mic || still.cam !== chosenRef.current.cam || still.speaker !== chosenRef.current.speaker) {
        chosenRef.current = still;
        setChosen(still);
      }
    } catch {
      // No device list in this browser: the default devices are used.
    }
  }, []);

  useEffect(() => {
    // The saved choice is read after mount (never during the server render), then the current list, and again whenever one is plugged in or out.
    const first = setTimeout(() => {
      const saved = loadChosen();
      chosenRef.current = saved;
      setChosen(saved);
      void refreshDevices();
    }, 0);
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    media?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      clearTimeout(first);
      media?.removeEventListener?.("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  /** Chooses a device. In a call the microphone or camera changes at once, without a new connection; the speaker applies to everyone's sound. */
  const chooseDevice = useCallback(async (kind: DeviceKind, id: string | null) => {
    const next: Chosen = { ...chosenRef.current, [kind]: id };
    chosenRef.current = next;
    setChosen(next);
    saveChosen(next);
    const t = transport.current;
    if (!t || kind === "speaker") return;
    try {
      if (kind === "mic") {
        const stream = await t.switchDevice("audio", id);
        if (stream) setMic(stream);
      } else {
        const stream = await t.switchDevice("video", id);
        if (stream) setLocalCamera(stream);
      }
    } catch {
      toast.error("Couldn't switch to that device. Your last one is still in use.");
    }
  }, []);

  // ---- lobby, join, leave ------------------------------------------------------------------------------------------------------
  /** Media and the heartbeat stop at once; the page only moves on after the server has recorded the leave, so the chat it returns to already shows "Call ended". */
  const stopQuietly = useCallback(() => {
    clearInterval(timers.current.heartbeat);
    clearTimeout(timers.current.unanswered);
    transport.current?.stop();
    transport.current = null;
  }, []);

  /** Sends the recorder's last piece, giving up after a while (a stalled upload must never trap someone in the call). */
  const flushRecorder = useCallback(async () => {
    const r = recorder.current;
    if (!r) return;
    await Promise.race([r.stop().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, FLUSH_MS))]);
  }, []);

  const leaveNow = useCallback(async () => {
    const id = live.current.callId;
    // If I am recording, the last piece goes up first (the server keeps the recording open for it), but never for long.
    await flushRecorder();
    stopQuietly();
    if (id) await callApi.leave(id).catch(() => {});
    reset();
  }, [flushRecorder, reset, stopQuietly]);

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
      unsubscribe: async (mids) => void (await callApi.unsubscribe(id, mids)),
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
      // In an all-hands the audience stays quiet on the channel until someone raises a hand or reacts (125 people announcing themselves is noise).
      const publisher = mayPublish(joined.call.mode, joined.me.role);
      myPresence.current = { muted: !(publisher && prefs.mic), hand: false };
      channel.current = connectCallChannel(client, id, userId, joined.call.mode === "townhall" && !publisher ? null : myPresence.current, { presence: onPresence, event: () => void refresh(), ready: () => void refresh() });
      setState(joined);
      if (joined.participants.some((p) => p.userId !== userId)) live.current.othersEverJoined = true;
      setPhase("active");
      live.current.phase = "active";
      timers.current.heartbeat = setInterval(() => void refresh(), HEARTBEAT_MS);
      // Anything that happened while the live channel was still connecting is fetched a few seconds in (instead of at the next heartbeat).
      setTimeout(() => void refresh(), 3000);
      setTimeout(() => void refresh(), 8000);
      // Nobody answered: end it as a missed call instead of waiting forever.
      timers.current.unanswered = setTimeout(() => {
        if (live.current.phase === "active" && !live.current.othersEverJoined && live.current.state?.me.role === "host") {
          toast.message("Nobody joined. The call ended.");
          void leaveNow();
        }
      }, UNANSWERED_MS);
      // Devices last, so a missing microphone doesn't stop you joining. (Not for the audience of an all-hands: they only watch.)
      if (prefs.mic && publisher) {
        try {
          lastLocalChange.current = Date.now();
          setMic(await t.startSending("audio", { deviceId: chosenRef.current.mic }));
          lastLocalChange.current = Date.now();
          setMicOn(true);
        } catch {
          toast.error("Couldn't use your microphone. Check the browser's permission, then press the microphone button.");
          announce({ muted: true });
        }
      }
      if (prefs.camera && publisher) {
        try {
          setLocalCamera(await t.startSending("video", { deviceId: chosenRef.current.cam }));
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
  }, [announce, applyState, leaveNow, mediaApiFor, onPresence, prefs.camera, prefs.mic, refresh, userId]);

  const endForEveryone = useCallback(async () => {
    const id = live.current.callId;
    await flushRecorder();
    stopQuietly();
    if (id) await callApi.end(id).catch((e: Error) => toast.error(e.message));
    reset();
  }, [reset, stopQuietly]);

  const start = useCallback(async (conversationId: string, mode: "meeting" | "townhall" = "meeting") => {
    unlockAudio();
    try {
      return (await callApi.start(conversationId, mode)).callId;
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
        lastLocalChange.current = Date.now();
        setMic(await t.startSending("audio", { deviceId: chosenRef.current.mic }));
        lastLocalChange.current = Date.now();
        setMicOn(true);
        announce({ muted: false });
        return;
      }
      const next = !live.current.micOn;
      t.setMicEnabled(next);
      setMicOn(next);
      announce({ muted: !next });
    } catch {
      toast.error("Couldn't use your microphone. Check the browser's permission.");
    }
  }, [announce]);

  const toggleCamera = useCallback(async () => {
    const t = transport.current;
    if (!t) return;
    try {
      if (t.isSending("video")) {
        await t.stopSending("video");
        setCameraOn(false);
        setLocalCamera(null);
      } else {
        setLocalCamera(await t.startSending("video", { deviceId: chosenRef.current.cam }));
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
    announce({ muted: !live.current.micOn, hand: next });
  }, [announce]);

  const sendReaction = useCallback(
    (emoji: Reaction) => {
      // One every two seconds: a shower of reactions from 125 people would flood the channel.
      if (Date.now() - lastReactionAt.current < 2000) return;
      lastReactionAt.current = Date.now();
      announce({ muted: !live.current.micOn, hand: live.current.handUp, reaction: { emoji, at: Date.now() } });
    },
    [announce],
  );

  const makeSpeaker = useCallback(async (uid: string, speaker: boolean) => {
    const id = live.current.callId;
    if (!id) return;
    try {
      await callApi.setSpeaker(id, uid, speaker);
      await refreshRef.current();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't do that.");
    }
  }, []);

  // ---- recording ---------------------------------------------------------------------------------------------------------------
  const startRecording = useCallback(async () => {
    const id = live.current.callId;
    if (!id) return;
    try {
      await callApi.startRecording(id);
      await refreshRef.current();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start recording.");
    }
  }, []);
  const stopRecording = useCallback(async () => {
    const id = live.current.callId;
    if (!id) return;
    try {
      // The recorder sends the last piece first, while the recording is still open for it.
      await flushRecorder();
      await callApi.stopRecording(id);
      await refreshRef.current();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't stop recording.");
    }
  }, []);
  const answerRecording = useCallback(async (answer: "allow" | "decline") => {
    const id = live.current.callId;
    if (!id) return;
    try {
      await callApi.answerRecording(id, answer);
      await refreshRef.current();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your answer.");
    }
  }, []);

  // The recorder's browser records while the server says this call is being recorded and I am the one recording.
  const recordingId = state?.recording?.id ?? null;
  const iAmRecorder = state?.recording?.recorderUserId === userId;
  useEffect(() => {
    if (!recordingId || !iAmRecorder || phase !== "active") return;
    const rid = recordingId;
    const r = new CallRecorder(
      {
        requestPart: (seq) => callApi.requestPart(rid, seq),
        upload: async (ticket, blob) => {
          const { error } = await createSupabaseBrowserClient().storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType: ticket.contentType });
          if (error) throw new Error("The recording couldn't be saved.");
        },
        finishPart: async (seq) => void (await callApi.finishPart(rid, seq)),
      },
      (message) => toast.error(message),
    );
    if (!r.start()) {
      toast.error("This browser can't record. Use a recent Chrome or Edge.");
      const id = live.current.callId;
      if (id) void callApi.stopRecording(id).then(() => refreshRef.current());
      return;
    }
    recorder.current = r;
    return () => {
      void r.stop();
      if (recorder.current === r) recorder.current = null;
    };
  }, [recordingId, iAmRecorder, phase]);

  // What goes into the recording follows who agreed: their sound is mixed in, and the picture is the speaker, pinned person or shared screen.
  useEffect(() => {
    const r = recorder.current;
    const rec = state?.recording;
    if (!r || !rec || !state) return;
    const allowed = rec.allowedUserIds;
    const audio: MediaStream[] = [];
    const hasVideo: Record<string, boolean> = {};
    const hasScreen: Record<string, boolean> = {};
    for (const uid of allowed) {
      if (uid === userId) {
        if (micStream.current) audio.push(micStream.current);
        hasVideo[uid] = Boolean(localCamera && localCamera.getVideoTracks().length > 0);
        hasScreen[uid] = Boolean(localScreen);
      } else {
        const media = remote[uid];
        if (media?.main) audio.push(media.main);
        hasVideo[uid] = Boolean(media?.main && media.main.getVideoTracks().length > 0);
        hasScreen[uid] = Boolean(media?.screen);
      }
    }
    const pick = pickRecordedVideo({ allowed, pinnedUserId, activeSpeakerId, hasVideo, hasScreen });
    const picture = !pick ? null : pick.userId === userId ? (pick.slot === "screen" ? localScreen : localCamera) : (remote[pick.userId]?.[pick.slot] ?? null);
    r.update({ audio, picture, caption: pick ? (state.participants.find((p) => p.userId === pick.userId)?.name ?? "") : "" });
  }, [state, remote, pinnedUserId, activeSpeakerId, localCamera, localScreen, userId, micVersion]);

  // ---- incoming calls ----------------------------------------------------------------------------------------------------------
  const clearIncoming = useCallback(() => {
    stopRing.current?.();
    stopRing.current = null;
    setIncoming(null);
  }, []);

  /** Shows the ring pop-up and plays the ringtone (once per call). */
  const showRing = useCallback((id: string, info: { conversationId: string; title: string; startedByName: string }) => {
    if (live.current.phase === "active" || live.current.phase === "joining" || live.current.callId === id) return; // busy, or already in it
    setIncoming((current) => {
      if (current?.callId === id) return current;
      stopRing.current?.();
      stopRing.current = startRingtone(30);
      return { callId: id, conversationId: info.conversationId, title: info.title, startedByName: info.startedByName };
    });
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
        showRing(id, info); // (busy in another call: nothing rings, the banner in the chat still shows)
      } catch {
        // Not for me (or gone): nothing rings.
      }
    },
    [showRing],
  );
  const { live: chatLive } = useChatLive(userId, onSignal);

  // A ring that came while this browser was still connecting (or asleep in a background tab) is gone from the live channel, so ask the
  // server what is ringing as soon as the connection is up and whenever the person comes back to the tab.
  useEffect(() => {
    if (!chatLive) return;
    let cancelled = false;
    let lastCheck = 0;
    const check = async () => {
      if (live.current.phase === "active" || live.current.phase === "joining") return;
      // A tab coming back fires both "visible" and "focus": one question to the server is enough.
      if (Date.now() - lastCheck < 2000) return;
      lastCheck = Date.now();
      try {
        const list = await callApi.ringing();
        if (!cancelled && list[0]) showRing(list[0].callId, list[0]);
      } catch {
        // Nothing is ringing, or the server could not be reached: the next signal or visit tries again.
      }
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [chatLive, showRing]);

  // While it rings, the tab's title flashes, so a call is noticed even in a background tab (a sound needs the person to have clicked once).
  useEffect(() => {
    if (!incoming) return;
    const flash = `Incoming call from ${incoming.startedByName}`;
    // The title the page really has (it can change while this rings, for example on a page change): remembered each time it is not ours.
    let base = document.title;
    let on = false;
    const timer = setInterval(() => {
      if (document.title !== flash) base = document.title;
      on = !on;
      document.title = on ? flash : base;
    }, 900);
    return () => {
      clearInterval(timer);
      if (document.title === flash) document.title = base;
    };
  }, [incoming]);

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
      devices, chosen, chooseDevice, refreshDevices, abilities, canPublish: state ? mayPublish(state.call.mode, state.me.role) : true, reactions, sendReaction, makeSpeaker, startRecording, stopRecording, answerRecording,
      page: shownPage, pages: selection?.pages ?? 1, visibleUserIds: selection?.visibleUserIds ?? [], pinnedUserId, activeSpeakerId, setPage, pin, muteOther, removeOther,
      open, start, join, leave: leaveNow, endForEveryone, toggleMic, toggleCamera, toggleScreen, toggleHand, answerIncoming, dismissIncoming: clearIncoming, userId,
    }),
    [phase, callId, state, error, incoming, micOn, cameraOn, screenOn, localCamera, localScreen, remote, presence, handUp, prefs, devices, chosen, chooseDevice, refreshDevices, abilities, reactions, sendReaction, makeSpeaker, startRecording, stopRecording, answerRecording, shownPage, selection, pinnedUserId, activeSpeakerId, setPage, pin, muteOther, removeOther, open, start, join, leaveNow, endForEveryone, toggleMic, toggleCamera, toggleScreen, toggleHand, answerIncoming, clearIncoming, userId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
