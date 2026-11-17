import type { ChatSound } from "../sound-options";

// Notification sounds made in the browser with the Web Audio API: short synthesized tones, so there are no sound files to license, host or
// load. Browsers only let a page make sound after the person has clicked or typed on it, so the audio is started on the first such action
// (unlockAudio) and a sound before that is simply skipped. Kept small and quiet on purpose. Calls can reuse this later (a ringtone).

type Note = { freq: number; at: number; length: number; type: OscillatorType; gain: number };

const SOUNDS: Record<Exclude<ChatSound, "off">, Note[]> = {
  chime: [
    { freq: 880, at: 0, length: 0.35, type: "sine", gain: 0.18 },
    { freq: 1320, at: 0.13, length: 0.5, type: "sine", gain: 0.16 },
  ],
  pop: [{ freq: 520, at: 0, length: 0.12, type: "sine", gain: 0.25 }],
  bell: [
    { freq: 1046, at: 0, length: 1.0, type: "triangle", gain: 0.16 },
    { freq: 2093, at: 0, length: 0.7, type: "sine", gain: 0.06 },
  ],
  ding: [{ freq: 1568, at: 0, length: 0.45, type: "sine", gain: 0.18 }],
};

let context: AudioContext | null = null;
let lastPlayed = 0;
let listening = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/** Starts the audio on the person's first click or key press (the browser's rule). Safe to call many times. */
export function unlockAudio(): void {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  const start = () => {
    void audio()?.resume().catch(() => {});
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("keydown", start);
  };
  window.addEventListener("pointerdown", start);
  window.addEventListener("keydown", start);
}

/** Plays a sound once. Does nothing for "off", when audio is not allowed yet, or if one just played (a burst of messages is one sound). */
export function playChatSound(sound: ChatSound, force = false): void {
  if (sound === "off") return;
  const ctx = audio();
  if (!ctx || ctx.state !== "running") {
    // A preview comes from a click, so it may start the audio itself; a background message may not.
    if (force && ctx) void ctx.resume().then(() => playChatSound(sound, true)).catch(() => {});
    return;
  }
  const now = Date.now();
  if (!force && now - lastPlayed < 1500) return;
  lastPlayed = now;
  const t0 = ctx.currentTime;
  for (const note of SOUNDS[sound]) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = note.type;
    osc.frequency.setValueAtTime(note.freq, t0 + note.at);
    amp.gain.setValueAtTime(0.0001, t0 + note.at);
    amp.gain.exponentialRampToValueAtTime(note.gain, t0 + note.at + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + note.at + note.length);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0 + note.at);
    osc.stop(t0 + note.at + note.length + 0.05);
  }
}
