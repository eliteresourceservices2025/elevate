import type { PublishedInfo } from "../service";
import type { TrackKind } from "../track-selection";
import type { CallTransport, IceServer, MediaApi, RemoteSlot, RemoteUpdate } from "./transport";

// A stand-in for the media connection, used by tests and demos with no Cloudflare account (NEXT_PUBLIC_CALLS_FAKE=1, never in production).
// It still makes every server call a real connection would (publish, close, subscribe, answer), so the server rules are exercised; only
// the media itself is replaced by small animated canvases. It records what happened on window.__callsFake for tests.

type Debug = { sent: Record<string, number>; pulled: string[]; unsubscribed: string[]; micEnabled: boolean };

function canvasStream(label: string, hue: number): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  let frame = 0;
  const draw = () => {
    if (!ctx) return;
    ctx.fillStyle = `hsl(${hue} 55% 35%)`;
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(label, 16, 90);
    ctx.fillRect(16 + (frame % 280), 150, 24, 8);
    frame += 4;
  };
  draw();
  const timer = setInterval(draw, 100);
  const stream = canvas.captureStream(10);
  stream.getVideoTracks()[0]?.addEventListener("ended", () => clearInterval(timer));
  // Stopping the track must also stop the animation.
  const stop = stream.getVideoTracks()[0]?.stop.bind(stream.getVideoTracks()[0]);
  if (stream.getVideoTracks()[0] && stop) stream.getVideoTracks()[0].stop = () => (clearInterval(timer), stop());
  return stream;
}

export class FakeTransport implements CallTransport {
  private api: MediaApi | null = null;
  private onRemote: RemoteUpdate = () => {};
  private sending = new Map<TrackKind, { trackName: string; stream: MediaStream }>();
  private remote = new Map<string, { stream: MediaStream; picture: boolean }>();
  private screens = new Map<string, MediaStream>();
  private pulledNames = new Set<string>();
  private mid = 0;
  private debug: Debug = { sent: {}, pulled: [], unsubscribed: [], micEnabled: true };

  async start(input: { iceServers: IceServer[]; api: MediaApi; onRemote: RemoteUpdate; onLocalEnded: (kind: TrackKind) => void }): Promise<void> {
    this.api = input.api;
    this.onRemote = input.onRemote;
    (window as unknown as { __callsFake: Debug }).__callsFake = this.debug;
  }

  isSending(kind: TrackKind): boolean {
    return this.sending.has(kind);
  }

  async startSending(kind: TrackKind): Promise<MediaStream> {
    if (!this.api) throw new Error("Call not started.");
    const existing = this.sending.get(kind);
    if (existing) return existing.stream;
    const out = await this.api.publish("fake-offer", [{ mid: String(this.mid++), kind }]);
    const stream = kind === "audio" ? new MediaStream() : canvasStream(kind === "screen" ? "Screen" : "Me", kind === "screen" ? 200 : 270);
    this.sending.set(kind, { trackName: out.tracks[0].trackName, stream });
    this.debug.sent[kind] = (this.debug.sent[kind] ?? 0) + 1;
    return stream;
  }

  async stopSending(kind: TrackKind): Promise<void> {
    const entry = this.sending.get(kind);
    if (!entry || !this.api) return;
    this.sending.delete(kind);
    entry.stream.getTracks().forEach((t) => t.stop());
    await this.api.close([entry.trackName]);
  }

  setMicEnabled(enabled: boolean): void {
    this.debug.micEnabled = enabled;
  }

  async syncRemote(wanted: PublishedInfo[]): Promise<void> {
    if (!this.api) return;
    const wantedNames = new Set(wanted.map((t) => t.trackName));
    const dropped = [...this.pulledNames].filter((name) => !wantedNames.has(name));
    if (dropped.length > 0) {
      for (const name of dropped) this.pulledNames.delete(name);
      await this.api.unsubscribe(dropped.map((_, i) => String(i))).catch(() => {});
      this.debug.unsubscribed.push(...dropped);
    }
    const fresh = wanted.filter((t) => !this.pulledNames.has(t.trackName));
    if (fresh.length > 0) {
      const out = await this.api.subscribe(fresh.map((t) => t.trackName));
      await this.api.answer("fake-answer");
      for (const t of fresh) this.pulledNames.add(t.trackName);
      this.debug.pulled.push(...out.tracks.map((t) => t.trackName));
    }
    const byUser = new Map<string, PublishedInfo[]>();
    for (const t of wanted) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t]);
    // Shared screens are their own slot.
    const sharing = new Set(wanted.filter((t) => t.kind === "screen").map((t) => t.userId));
    for (const userId of sharing) {
      if (this.screens.has(userId)) continue;
      const screen = canvasStream("Screen", 200);
      this.screens.set(userId, screen);
      this.onRemote(userId, "screen", screen);
    }
    for (const [userId, screen] of [...this.screens]) {
      if (!sharing.has(userId)) {
        screen.getTracks().forEach((t) => t.stop());
        this.screens.delete(userId);
        this.onRemote(userId, "screen", null);
      }
    }
    for (const [userId, tracks] of byUser) {
      const hasPicture = tracks.some((t) => t.kind === "video");
      const have = this.remote.get(userId);
      if (have && have.picture === hasPicture) continue;
      have?.stream.getTracks().forEach((t) => t.stop());
      const stream = hasPicture ? canvasStream(userId.slice(0, 4), parseInt(userId.slice(0, 2), 16) * 5) : new MediaStream();
      this.remote.set(userId, { stream, picture: hasPicture });
      this.onRemote(userId, "main", stream);
    }
    for (const [userId, { stream }] of [...this.remote]) {
      if (!byUser.has(userId)) {
        stream.getTracks().forEach((t) => t.stop());
        this.remote.delete(userId);
        this.onRemote(userId, "main", null);
      }
    }
  }

  stop(): void {
    for (const { stream } of this.sending.values()) stream.getTracks().forEach((t) => t.stop());
    for (const { stream } of this.remote.values()) stream.getTracks().forEach((t) => t.stop());
    for (const stream of this.screens.values()) stream.getTracks().forEach((t) => t.stop());
    this.screens.clear();
    this.sending.clear();
    this.remote.clear();
  }
}
