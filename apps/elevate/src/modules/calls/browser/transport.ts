import type { PublishedInfo } from "../service";
import type { TrackKind } from "../track-selection";

// The browser side of the media connection, behind one interface so the screens never know whether media runs through Cloudflare
// (cloudflare-transport.ts) or the fake used by tests and demos without an account (fake-transport.ts). Plain TypeScript, no React.

export type IceServer = { urls: string[]; username?: string; credential?: string };

/** What the transport needs from the server (the call actions), already unwrapped. */
export type MediaApi = {
  publish(offerSdp: string, tracks: { mid: string; kind: TrackKind }[]): Promise<{ answerSdp: string; tracks: { mid: string; kind: TrackKind; trackName: string }[] }>;
  close(trackNames: string[]): Promise<void>;
  subscribe(trackNames: string[]): Promise<{ offerSdp: string; tracks: { mid: string; trackName: string }[] }>;
  answer(sdp: string): Promise<void>;
  /** Stops pulling tracks (by their id on the receiving connection), so video that is off screen costs nothing. */
  unsubscribe(mids: string[]): Promise<void>;
};

/** Someone's camera and microphone arrive as slot "main"; a shared screen arrives as its own slot "screen". null means it went away. */
export type RemoteSlot = "main" | "screen";
export type RemoteUpdate = (userId: string, slot: RemoteSlot, stream: MediaStream | null) => void;

export interface CallTransport {
  /** Opens the connections. Safe to call once. */
  start(input: { iceServers: IceServer[]; api: MediaApi; onRemote: RemoteUpdate; onLocalEnded: (kind: TrackKind) => void }): Promise<void>;
  /** Starts sending a track of this kind (the transport gets the media itself); returns the stream to show as the person's own preview. `deviceId` picks a microphone or camera (null or missing: the default; a device that is gone falls back to the default). */
  startSending(kind: TrackKind, options?: { deviceId?: string | null }): Promise<MediaStream>;
  /** Changes the microphone or camera that is being sent, without a new connection. Returns the new stream (null when nothing of that kind is being sent: the next start uses the choice). */
  switchDevice(kind: "audio" | "video", deviceId: string | null): Promise<MediaStream | null>;
  /** Stops sending this kind. */
  stopSending(kind: TrackKind): Promise<void>;
  /** Mutes or unmutes the microphone without stopping it (the track stays published). */
  setMicEnabled(enabled: boolean): void;
  /** Makes the set of pulled tracks match `wanted` (adds the new ones; ones no longer wanted are dropped from view). */
  syncRemote(wanted: PublishedInfo[]): Promise<void>;
  stop(): void;
  /** True once a track of this kind is being sent. */
  isSending(kind: TrackKind): boolean;
}

export type TransportName = "fake" | "cloudflare";

/** The fake only outside production and only when switched on at build time (NEXT_PUBLIC_CALLS_FAKE=1); real media otherwise. */
export function transportName(): TransportName {
  return process.env.NEXT_PUBLIC_CALLS_FAKE === "1" && process.env.NODE_ENV !== "production" ? "fake" : "cloudflare";
}

export async function createTransport(): Promise<CallTransport> {
  if (transportName() === "fake") return new (await import("./fake-transport")).FakeTransport();
  return new (await import("./cloudflare-transport")).CloudflareTransport();
}
