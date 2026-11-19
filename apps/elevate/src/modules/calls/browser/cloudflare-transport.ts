import type { PublishedInfo } from "../service";
import type { TrackKind } from "../track-selection";
import type { CallTransport, IceServer, MediaApi, RemoteSlot, RemoteUpdate } from "./transport";

// Real media through Cloudflare Realtime. Two RTCPeerConnections to the same Cloudflare session: one only SENDS this person's microphone,
// camera and screen; one only RECEIVES other people's tracks. Every offer and answer is exchanged through OUR server (the Cloudflare
// secret never reaches the browser). Written from Cloudflare's documented flow: confirm it against a real app in the Phase 4 spike.

const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } as const;

export class CloudflareTransport implements CallTransport {
  private api: MediaApi | null = null;
  private onRemote: RemoteUpdate = () => {};
  private onLocalEnded: (kind: TrackKind) => void = () => {};
  private push: RTCPeerConnection | null = null;
  private pull: RTCPeerConnection | null = null;
  private sending = new Map<TrackKind, { stream: MediaStream; transceiver: RTCRtpTransceiver; trackName: string }>();
  private micTrack: MediaStreamTrack | null = null;
  /** mid on the receiving connection -> who it belongs to. */
  private incoming = new Map<string, { userId: string; trackName: string; slot: RemoteSlot }>();
  private pulledNames = new Set<string>();
  /** trackName -> its id on the receiving connection and the browser track, so it can be closed and removed when it leaves the page. */
  private pulled = new Map<string, { mid: string; track: MediaStreamTrack | null; key: string }>();
  private streams = new Map<string, MediaStream>(); // key: `${userId}:${slot}`
  private queue: Promise<unknown> = Promise.resolve();

  async start(input: { iceServers: IceServer[]; api: MediaApi; onRemote: RemoteUpdate; onLocalEnded: (kind: TrackKind) => void }): Promise<void> {
    this.api = input.api;
    this.onRemote = input.onRemote;
    this.onLocalEnded = input.onLocalEnded;
    const config: RTCConfiguration = { iceServers: input.iceServers, bundlePolicy: "max-bundle" };
    this.push = new RTCPeerConnection(config);
    this.pull = new RTCPeerConnection(config);
    this.pull.ontrack = (event) => {
      const mid = event.transceiver.mid;
      const owner = mid ? this.incoming.get(mid) : undefined;
      if (!owner) return;
      const key = `${owner.userId}:${owner.slot}`;
      let stream = this.streams.get(key);
      if (!stream) {
        stream = new MediaStream();
        this.streams.set(key, stream);
      }
      stream.addTrack(event.track);
      const entry = this.pulled.get(owner.trackName);
      if (entry) entry.track = event.track;
      this.onRemote(owner.userId, owner.slot, stream);
    };
  }

  /** Steps that change a connection run one at a time: Cloudflare needs each offer/answer finished before the next. */
  private serial<T>(step: () => Promise<T>): Promise<T> {
    const next = this.queue.then(step, step);
    this.queue = next.catch(() => undefined);
    return next;
  }

  isSending(kind: TrackKind): boolean {
    return this.sending.has(kind);
  }

  /** Gets the microphone, camera or screen. A chosen device that is gone (unplugged since last time) falls back to the default. */
  private async capture(kind: TrackKind, deviceId: string | null): Promise<MediaStream> {
    if (kind === "screen") return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    const ask = (id: string | null) => {
      const device = id ? { deviceId: { exact: id } } : {};
      return kind === "audio"
        ? navigator.mediaDevices.getUserMedia({ audio: { ...device, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        : navigator.mediaDevices.getUserMedia({ video: { ...device, ...CAMERA } });
    };
    try {
      return await ask(deviceId);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (deviceId && (name === "OverconstrainedError" || name === "NotFoundError")) return ask(null);
      throw error;
    }
  }

  async switchDevice(kind: "audio" | "video", deviceId: string | null): Promise<MediaStream | null> {
    return this.serial(async () => {
      const entry = this.sending.get(kind);
      if (!entry) return null;
      const stream = await this.capture(kind, deviceId);
      const track = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("No device found.");
      }
      // A muted microphone stays muted on the new device.
      if (kind === "audio") track.enabled = this.micTrack?.enabled ?? true;
      try {
        // The same sender gets the new track: no new offer, and the others keep receiving without a break.
        await entry.transceiver.sender.replaceTrack(track);
      } catch (error) {
        // The new device must not stay switched on with nobody using it.
        stream.getTracks().forEach((t) => t.stop());
        throw error;
      }
      entry.stream.getTracks().forEach((t) => t.stop());
      entry.stream = stream;
      if (kind === "audio") this.micTrack = track;
      return stream;
    });
  }

  async startSending(kind: TrackKind, options?: { deviceId?: string | null }): Promise<MediaStream> {
    return this.serial(async () => {
      const push = this.push;
      const api = this.api;
      if (!push || !api) throw new Error("Call not started.");
      const existing = this.sending.get(kind);
      if (existing) return existing.stream;
      const stream = await this.capture(kind, options?.deviceId ?? null);
      const track = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!track) throw new Error("No device found.");
      if (kind === "audio") this.micTrack = track;
      // Pressing the browser's own "Stop sharing" button ends the screen share cleanly.
      if (kind === "screen") track.addEventListener("ended", () => void this.stopSending("screen").then(() => this.onLocalEnded("screen")));
      const transceiver = push.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      await push.setLocalDescription(await push.createOffer());
      const mid = transceiver.mid;
      if (!mid || !push.localDescription) throw new Error("Couldn't start sending.");
      const out = await api.publish(push.localDescription.sdp, [{ mid, kind }]);
      await push.setRemoteDescription({ type: "answer", sdp: out.answerSdp });
      this.sending.set(kind, { stream, transceiver, trackName: out.tracks[0].trackName });
      return stream;
    });
  }

  async stopSending(kind: TrackKind): Promise<void> {
    return this.serial(async () => {
      const entry = this.sending.get(kind);
      if (!entry || !this.api) return;
      this.sending.delete(kind);
      if (kind === "audio") this.micTrack = null;
      entry.stream.getTracks().forEach((t) => t.stop());
      entry.transceiver.direction = "inactive";
      await this.api.close([entry.trackName]);
    });
  }

  setMicEnabled(enabled: boolean): void {
    if (this.micTrack) this.micTrack.enabled = enabled;
  }

  async syncRemote(wanted: PublishedInfo[]): Promise<void> {
    return this.serial(async () => {
      const pull = this.pull;
      const api = this.api;
      if (!pull || !api) return;
      const fresh = wanted.filter((t) => !this.pulledNames.has(t.trackName));
      if (fresh.length > 0) {
        const out = await api.subscribe(fresh.map((t) => t.trackName));
        // Remember who each track belongs to BEFORE the offer is applied (the browser fires ontrack while applying it).
        for (const t of out.tracks) {
          const info = fresh.find((f) => f.trackName === t.trackName);
          if (info) {
            this.incoming.set(t.mid, { userId: info.userId, trackName: t.trackName, slot: info.kind === "screen" ? "screen" : "main" });
            this.pulled.set(t.trackName, { mid: t.mid, track: null, key: `${info.userId}:${info.kind === "screen" ? "screen" : "main"}` });
          }
          this.pulledNames.add(t.trackName);
        }
        await pull.setRemoteDescription({ type: "offer", sdp: out.offerSdp });
        const answer = await pull.createAnswer();
        await pull.setLocalDescription(answer);
        await api.answer(answer.sdp ?? "");
      }
      // Tracks no longer wanted (video that scrolled off the page, someone who left) are closed at Cloudflare: nothing is sent for them any more.
      const wantedNames = new Set(wanted.map((t) => t.trackName));
      const dropped = [...this.pulled].filter(([name]) => !wantedNames.has(name));
      if (dropped.length > 0) {
        for (const [name, entry] of dropped) {
          const stream = this.streams.get(entry.key);
          if (stream && entry.track) stream.removeTrack(entry.track);
          this.pulled.delete(name);
          this.pulledNames.delete(name);
          this.incoming.delete(entry.mid);
        }
        await api.unsubscribe(dropped.map(([, entry]) => entry.mid)).catch(() => {});
      }
      // A person with nothing left on screen disappears from view.
      // Cloudflare answers only for tracks that are already flowing; a shared screen or camera that has just started may not be yet. Say so,
      // so the caller tries again in a moment (the ones that worked are already in place).
      const notYet = fresh.some((t) => !this.pulledNames.has(t.trackName));
      const wantedKeys = new Set(wanted.map((t) => `${t.userId}:${t.kind === "screen" ? "screen" : "main"}`));
      for (const [key, stream] of [...this.streams]) {
        if (!wantedKeys.has(key)) {
          stream.getTracks().forEach((t) => stream.removeTrack(t));
          this.streams.delete(key);
          const [userId, slot] = key.split(":");
          this.onRemote(userId, slot as RemoteSlot, null);
        }
      }
      if (notYet) throw new Error("Some video is not ready yet.");
    });
  }

  stop(): void {
    for (const { stream } of this.sending.values()) stream.getTracks().forEach((t) => t.stop());
    this.sending.clear();
    this.push?.close();
    this.pull?.close();
    this.push = null;
    this.pull = null;
    this.streams.clear();
  }
}
