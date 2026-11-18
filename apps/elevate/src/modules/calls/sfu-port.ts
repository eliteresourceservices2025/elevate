import "server-only";
import { randomBytes } from "node:crypto";
import { ActionFailure } from "@/lib/run-action";
import * as cloudflare from "./sfu";
import type { IceServer, LocalTrack, RemoteTrack, SessionDescription, TracksResponse } from "./sfu";

// What the call service needs from a media server. The real one is sfu.ts (Cloudflare); the fake one below keeps tests and local screens
// working with no Cloudflare account (CALLS_FAKE=1, never in production). Swapping providers means writing another one of these.

export interface SfuPort {
  createSession(): Promise<{ sessionId: string }>;
  pushTracks(sessionId: string, offer: SessionDescription, tracks: LocalTrack[]): Promise<TracksResponse>;
  pullTracks(sessionId: string, remote: RemoteTrack[]): Promise<TracksResponse>;
  renegotiate(sessionId: string, answer: SessionDescription): Promise<void>;
  closeTracks(sessionId: string, mids: string[]): Promise<void>;
  iceServers(): Promise<IceServer[]>;
}

/** Records what was asked, answers like a happy server. Exported for tests. */
export function createFakeSfu(): SfuPort & { sessions: Set<string>; closed: { sessionId: string; mids: string[] }[]; pulled: { sessionId: string; remote: RemoteTrack[] }[] } {
  const sessions = new Set<string>();
  const closed: { sessionId: string; mids: string[] }[] = [];
  const pulled: { sessionId: string; remote: RemoteTrack[] }[] = [];
  return {
    sessions,
    closed,
    pulled,
    async createSession() {
      const sessionId = randomBytes(16).toString("hex");
      sessions.add(sessionId);
      return { sessionId };
    },
    async pushTracks(_sessionId, _offer, tracks) {
      return { sessionDescription: { type: "answer", sdp: "fake-answer" }, tracks: tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })), requiresImmediateRenegotiation: false };
    },
    async pullTracks(sessionId, remote) {
      pulled.push({ sessionId, remote });
      return { sessionDescription: { type: "offer", sdp: "fake-offer" }, tracks: remote.map((r, i) => ({ mid: String(i), trackName: r.trackName })), requiresImmediateRenegotiation: true };
    },
    async renegotiate() {},
    async closeTracks(sessionId, mids) {
      closed.push({ sessionId, mids });
    },
    async iceServers() {
      return [{ urls: ["stun:stun.cloudflare.com:3478"] }];
    },
  };
}

let fake: ReturnType<typeof createFakeSfu> | null = null;

export const fakeCallsEnabled = () => process.env.CALLS_FAKE === "1" && process.env.NODE_ENV !== "production" && process.env.ELEVATE_ENV !== "production";

/** The media server to use now: the fake one only when explicitly switched on outside production, else Cloudflare, else "not set up". */
export function getSfu(): SfuPort {
  if (fakeCallsEnabled()) return (fake ??= createFakeSfu());
  if (!cloudflare.callsConfigured()) throw new ActionFailure("Calls aren't set up yet.");
  return cloudflare;
}

export const callsAvailable = () => fakeCallsEnabled() || cloudflare.callsConfigured();
