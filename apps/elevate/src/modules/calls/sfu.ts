import "server-only";
import { isSafeSessionId, isSafeTrackName } from "./sfu-rules";

// The ONLY file that talks to Cloudflare Realtime (SFU + TURN). Everything else asks this file. The app secret and the TURN token stay here
// on the server: the browser only ever receives the answer to its own offer and short-lived relay credentials. If Cloudflare ever
// changes its terms, replacing this file (and browser/transport.ts) is the whole migration (self-hosted LiveKit is the fallback).
// NOTE: written from Cloudflare's documentation; confirm each call against the real service in the Phase 4 spike (docs/modules/calls.md).
//
// Never logged: SDP, ids of other people's sessions, tokens. Errors carry only a status number.

const BASE = "https://rtc.live.cloudflare.com/v1";
const TIMEOUT_MS = 10_000;

export class SfuError extends Error {
  constructor(public readonly status: number) {
    super(`sfu ${status}`);
    this.name = "SfuError";
  }
}

export type SessionDescription = { type: "offer" | "answer"; sdp: string };
export type LocalTrack = { mid: string; trackName: string };
export type RemoteTrack = { sessionId: string; trackName: string };
export type TrackResult = { mid?: string; trackName?: string; errorCode?: string; errorDescription?: string };
export type TracksResponse = { sessionDescription?: SessionDescription; tracks: TrackResult[]; requiresImmediateRenegotiation: boolean };
export type IceServer = { urls: string[]; username?: string; credential?: string };

function config() {
  const appId = process.env.CLOUDFLARE_REALTIME_APP_ID;
  const secret = process.env.CLOUDFLARE_REALTIME_APP_SECRET;
  if (!appId || !secret || !/^[0-9a-f]{32}$/i.test(appId)) return null;
  return { appId, secret };
}

/** Calls are off until all four Cloudflare settings exist (see .env.example). */
export function callsConfigured(): boolean {
  return Boolean(config() && process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_KEY_TOKEN);
}

async function request<T>(method: "POST" | "PUT" | "GET", path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new SfuError(response.status);
  return (await response.json()) as T;
}

function app() {
  const c = config();
  if (!c) throw new SfuError(503);
  return c;
}

/** A new Cloudflare session: one per person per call. */
export async function createSession(): Promise<{ sessionId: string }> {
  const { appId, secret } = app();
  const data = await request<{ sessionId?: string }>("POST", `/apps/${appId}/sessions/new`, secret);
  if (!isSafeSessionId(data.sessionId)) throw new SfuError(502);
  return { sessionId: data.sessionId };
}

/** Publish: the person's offer for their own tracks (microphone, camera, screen). Cloudflare answers. */
export async function pushTracks(sessionId: string, offer: SessionDescription, tracks: LocalTrack[]): Promise<TracksResponse> {
  const { appId, secret } = app();
  if (!isSafeSessionId(sessionId) || tracks.length === 0 || tracks.length > 8 || !tracks.every((t) => isSafeTrackName(t.trackName))) throw new SfuError(400);
  const data = await request<Partial<TracksResponse>>("POST", `/apps/${appId}/sessions/${sessionId}/tracks/new`, secret, {
    sessionDescription: offer,
    tracks: tracks.map((t) => ({ location: "local", mid: t.mid, trackName: t.trackName })),
  });
  return { sessionDescription: data.sessionDescription, tracks: data.tracks ?? [], requiresImmediateRenegotiation: Boolean(data.requiresImmediateRenegotiation) };
}

/** Subscribe: pull other people's tracks into this person's session. The caller (our service) has already decided they may. Cloudflare sends an offer to answer. */
export async function pullTracks(sessionId: string, remote: RemoteTrack[]): Promise<TracksResponse> {
  const { appId, secret } = app();
  if (!isSafeSessionId(sessionId) || remote.length === 0 || remote.length > 64 || !remote.every((t) => isSafeSessionId(t.sessionId) && isSafeTrackName(t.trackName))) throw new SfuError(400);
  const data = await request<Partial<TracksResponse>>("POST", `/apps/${appId}/sessions/${sessionId}/tracks/new`, secret, {
    tracks: remote.map((t) => ({ location: "remote", sessionId: t.sessionId, trackName: t.trackName })),
  });
  return { sessionDescription: data.sessionDescription, tracks: data.tracks ?? [], requiresImmediateRenegotiation: Boolean(data.requiresImmediateRenegotiation) };
}

/** The person's answer to Cloudflare's offer from a pull. */
export async function renegotiate(sessionId: string, answer: SessionDescription): Promise<void> {
  const { appId, secret } = app();
  if (!isSafeSessionId(sessionId) || answer.type !== "answer") throw new SfuError(400);
  await request("PUT", `/apps/${appId}/sessions/${sessionId}/renegotiate`, secret, { sessionDescription: answer });
}

/** Stops tracks by mid. Our server uses this to remove or mute someone: nothing depends on their browser obeying a message. */
export async function closeTracks(sessionId: string, mids: string[], force = true): Promise<void> {
  const { appId, secret } = app();
  if (!isSafeSessionId(sessionId) || mids.length === 0 || mids.length > 64 || !mids.every((m) => /^[A-Za-z0-9_-]{1,32}$/.test(m))) throw new SfuError(400);
  await request("PUT", `/apps/${appId}/sessions/${sessionId}/tracks/close`, secret, { tracks: mids.map((mid) => ({ mid })), force });
}

/** Short-lived relay (TURN) credentials for one person's one call. The token that mints them never leaves the server. */
export async function iceServers(ttlSeconds = 4 * 60 * 60): Promise<IceServer[]> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_KEY_TOKEN;
  if (!keyId || !token || !/^[A-Za-z0-9_-]{8,64}$/.test(keyId)) throw new SfuError(503);
  const data = await request<{ iceServers?: IceServer | IceServer[] }>("POST", `/turn/keys/${keyId}/credentials/generate-ice-servers`, token, { ttl: Math.min(Math.max(ttlSeconds, 600), 24 * 60 * 60) });
  const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
  // Only plain stun/turn(s) addresses and the credential pair are passed on.
  return list
    .map((s) => ({ urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u): u is string => typeof u === "string" && /^(stun|turns?):/.test(u)), username: s.username, credential: s.credential }))
    .filter((s) => s.urls.length > 0);
}
