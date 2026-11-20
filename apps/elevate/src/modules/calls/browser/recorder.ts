import { RECORDING_PART_MAX_BYTES, shouldCutPart } from "../recording-rules";

// The recording of a call, made in the RECORDER's own browser: it mixes the audio of the people who agreed into one track, draws one
// picture (the speaker, a pinned person or a shared screen) onto a canvas, records both with MediaRecorder, and uploads the result in
// pieces of about 8 MB (ask the server for a one-time token, upload straight to storage, tell the server to check the piece).
// The server decides who is allowed; this only ever includes the people it is given. Plain TypeScript, no React.
//
// Known limits (first version): the recorder must keep this tab open; a hidden tab slows the picture down (the sound is unaffected);
// a closed tab loses at most the last few minutes not yet uploaded; the file plays from the start (no seeking).

export type Ticket = { bucket: string; path: string; token: string; contentType: string };
export type RecorderApi = {
  requestPart(seq: number): Promise<Ticket>;
  upload(ticket: Ticket, blob: Blob): Promise<void>;
  finishPart(seq: number): Promise<void>;
};
/** What to put in the recording right now (the provider recomputes it as people join, leave, agree or take it back). */
export type RecordingSources = {
  /** Microphone audio of people who agreed (their own streams; each is mixed once). */
  audio: MediaStream[];
  /** The one picture to show, or null for a plain title card. */
  picture: MediaStream | null;
  caption: string;
};

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 10;
const SLICE_MS = 10_000;
const TRIES = 3;

export class CallRecorder {
  private ctx: AudioContext | null = null;
  private mix: MediaStreamAudioDestinationNode | null = null;
  private keepAlive: ConstantSourceNode | null = null;
  private nodes = new Map<string, MediaStreamAudioSourceNode>();
  private canvas: HTMLCanvasElement | null = null;
  private video: HTMLVideoElement | null = null;
  private pictureTrack: MediaStreamTrack | null = null;
  private drawTimer: ReturnType<typeof setInterval> | undefined;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private buffered = 0;
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();
  private sources: RecordingSources = { audio: [], picture: null, caption: "" };
  private stopped = false;
  private failed = false;

  constructor(
    private api: RecorderApi,
    private onError: (message: string) => void,
  ) {}

  /** Starts recording. Returns false if this browser can't (then nothing was started). */
  start(): boolean {
    if (typeof MediaRecorder === "undefined") return false;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    this.ctx = new Ctor();
    // A suspended audio context makes no sound samples, and a recorder waits for every track before it writes anything: so it must run.
    void this.ctx.resume().catch(() => {});
    this.mix = this.ctx.createMediaStreamDestination();
    // A mix with nothing playing into it makes no samples at all, and a recorder waits for every track before it writes a byte. A silent
    // source keeps the sound track flowing (so the recording starts even before anyone speaks).
    const silence = this.ctx.createGain();
    silence.gain.value = 0;
    silence.connect(this.mix);
    this.keepAlive = this.ctx.createConstantSource();
    this.keepAlive.connect(silence);
    this.keepAlive.start();
    this.canvas = document.createElement("canvas");
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    // Frames are asked for by hand after each drawing (captureStream(0)): a tab that is in the background draws slowly, but never goes blank.
    const picture = this.canvas.captureStream(0);
    this.pictureTrack = picture.getVideoTracks()[0] ?? null;
    const stream = new MediaStream([...picture.getVideoTracks(), ...this.mix.stream.getAudioTracks()]);
    const mimeType = ["video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) return false;
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800_000, audioBitsPerSecond: 64_000 });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      this.chunks.push(event.data);
      this.buffered += event.data.size;
      if (shouldCutPart(this.buffered, false)) this.cut();
    };
    this.recorder.onerror = () => this.fail("The recording stopped. Press record to start again.");
    this.drawTimer = setInterval(() => this.draw(), 1000 / FPS);
    this.recorder.start(SLICE_MS);
    return true;
  }

  /** Changes what is recorded: the mix follows `audio`, the picture follows `picture`. */
  update(next: RecordingSources): void {
    this.sources = next;
    if (!this.ctx || !this.mix) return;
    const wanted = new Map<string, MediaStream>();
    for (const stream of next.audio) if (stream.getAudioTracks().length > 0) wanted.set(stream.id, stream);
    for (const [id, node] of this.nodes) {
      if (!wanted.has(id)) {
        node.disconnect();
        this.nodes.delete(id);
      }
    }
    for (const [id, stream] of wanted) {
      if (this.nodes.has(id)) continue;
      const node = this.ctx.createMediaStreamSource(stream);
      node.connect(this.mix);
      this.nodes.set(id, node);
    }
    if (this.video && this.video.srcObject !== next.picture) {
      this.video.srcObject = next.picture;
      if (next.picture) void this.video.play().catch(() => {});
    }
  }

  private draw(): void {
    const g = this.canvas?.getContext("2d");
    if (!g || !this.video) return;
    g.fillStyle = "#1f1630";
    g.fillRect(0, 0, WIDTH, HEIGHT);
    const v = this.video;
    if (this.sources.picture && v.videoWidth > 0 && v.readyState >= 2) {
      // Fit the picture inside the frame without stretching it.
      const scale = Math.min(WIDTH / v.videoWidth, HEIGHT / v.videoHeight);
      const w = v.videoWidth * scale;
      const h = v.videoHeight * scale;
      g.drawImage(v, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
    }
    if (this.sources.caption) {
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillRect(24, HEIGHT - 64, Math.min(WIDTH - 48, 40 + this.sources.caption.length * 16), 40);
      g.fillStyle = "#fff";
      g.font = "24px sans-serif";
      g.fillText(this.sources.caption, 44, HEIGHT - 36);
    }
    (this.pictureTrack as (MediaStreamTrack & { requestFrame?: () => void }) | null)?.requestFrame?.();
  }

  /** Sends what has built up as the next piece. Pieces go one at a time, in order. */
  private cut(): void {
    if (this.chunks.length === 0) return;
    const blob = new Blob(this.chunks, { type: "video/webm" });
    this.chunks = [];
    this.buffered = 0;
    if (blob.size > RECORDING_PART_MAX_BYTES) return this.fail("The recording piece was too big. Press record to start again.");
    const seq = this.seq++;
    this.queue = this.queue.then(() => this.send(seq, blob));
  }

  private async send(seq: number, blob: Blob): Promise<void> {
    if (this.failed) return;
    let lastError: unknown;
    for (let attempt = 0; attempt < TRIES; attempt++) {
      try {
        const ticket = await this.api.requestPart(seq);
        await this.api.upload(ticket, blob);
        await this.api.finishPart(seq);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    this.fail(lastError instanceof Error && lastError.message ? lastError.message : "The recording couldn't be saved.");
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.onError(message);
    this.release();
  }

  /** Stops, sends the last piece, and waits until everything has been uploaded. Safe to call twice. */
  async stop(): Promise<void> {
    if (this.stopped) return this.queue;
    this.stopped = true;
    clearInterval(this.drawTimer);
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    if (shouldCutPart(this.buffered, true)) this.cut();
    await this.queue.catch(() => {});
    this.release();
  }

  private release(): void {
    clearInterval(this.drawTimer);
    for (const node of this.nodes.values()) node.disconnect();
    this.nodes.clear();
    try {
      this.keepAlive?.stop();
    } catch {
      // already stopped
    }
    this.keepAlive = null;
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // already stopped
      }
    }
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    if (this.video) this.video.srcObject = null;
  }
}
