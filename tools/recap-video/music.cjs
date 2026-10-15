// Composes the background music for the recap videos: a short, light, upbeat loop made from nothing but sine and triangle waves
// and a little noise, so it is original (no license, no attribution) and has no copyrighted source.
//   node music.cjs [seconds] [out.wav]      default: 100 seconds -> audio/music.wav
// Chords I - V - vi - IV in C major at 104 BPM, a soft pad, a plucked arpeggio with a faint echo, a gentle bass, and a very quiet
// hi-hat. It is mixed under the voice at low volume by the renderer; to use your own track instead, put a WAV named music.wav in
// the audio folder you render with.
const fs = require("fs");
const path = require("path");

const SECONDS = Number(process.argv[2] || 100);
const OUT = path.resolve(process.argv[3] || path.join(__dirname, "audio", "music.wav"));
const SR = 44100;
const BPM = 104;
const beat = 60 / BPM;
const N = Math.floor(SECONDS * SR);
const mix = new Float32Array(N);

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
// C major: C4=60. Chords as [root, third, fifth] MIDI notes; bass an octave or two down.
const CHORDS = [
  [60, 64, 67], // C
  [67, 71, 74], // G
  [69, 72, 76], // Am
  [65, 69, 72], // F
];
const BASS = [36, 43, 45, 41];

function add(startSec, durSec, fn, gain) {
  const s0 = Math.floor(startSec * SR);
  const len = Math.floor(durSec * SR);
  for (let i = 0; i < len; i++) {
    const idx = s0 + i;
    if (idx >= N) break;
    mix[idx] += fn(i / SR, i / len) * gain;
  }
}
const tri = (t, f) => (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t));
const sine = (t, f) => Math.sin(2 * Math.PI * f * t);
const env = (p, a, r) => (p < a ? p / a : p > 1 - r ? Math.max(0, (1 - p) / r) : 1);

const barLen = beat * 4;
const bars = Math.ceil(SECONDS / barLen);
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;

for (let bar = 0; bar < bars; bar++) {
  const t0 = bar * barLen;
  const ch = CHORDS[bar % 4];
  const bass = BASS[bar % 4];
  // pad: three triangle voices, slow attack and release
  for (const n of ch) add(t0, barLen * 1.02, (t, p) => tri(t, hz(n - 12)) * env(p, 0.2, 0.3), 0.06);
  // bass on beats 1 and 3, and a light pickup
  for (const b of [0, 2]) add(t0 + b * beat, beat * 1.6, (t, p) => sine(t, hz(bass)) * env(p, 0.02, 0.5), 0.2);
  add(t0 + 3.5 * beat, beat * 0.5, (t, p) => sine(t, hz(bass + 12)) * env(p, 0.02, 0.5), 0.08);
  // plucked arpeggio on eighth notes: root, fifth, octave, third, ... bright and short
  const pat = [0, 2, 1, 2, 0, 2, 1, 2];
  for (let k = 0; k < 8; k++) {
    const note = ch[pat[k] % 3] + (k % 4 === 3 ? 12 : 0);
    const start = t0 + k * (beat / 2);
    add(start, beat * 0.9, (t, p) => (sine(t, hz(note + 12)) + 0.35 * sine(t, hz(note + 24))) * Math.exp(-5 * p) * Math.min(1, p * 60), 0.07);
  }
  // very quiet hi-hat on the off-beats, and a soft kick on 1 and 3
  for (let k = 0; k < 4; k++) {
    add(t0 + (k + 0.5) * beat, 0.05, (t, p) => rnd() * Math.exp(-9 * p), 0.012);
  }
  for (const b of [0, 2]) add(t0 + b * beat, 0.16, (t, p) => sine(t, 55 + 70 * Math.exp(-14 * p)) * Math.exp(-6 * p), 0.16);
}

// a faint echo for space (a single tap 0.29 s later)
const delay = Math.floor(0.29 * SR);
for (let i = N - 1; i >= delay; i--) mix[i] += mix[i - delay] * 0.22;

// normalize to about -3 dBFS and fade the very start and end so a loop or cut is not clicky
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix[i]));
const scale = 0.7 / (peak || 1);
const pcm = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / (0.5 * SR), (N - 1 - i) / (1.5 * SR));
  const v = Math.max(-1, Math.min(1, mix[i] * scale * fade));
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, pcm]));
console.log(`wrote ${OUT} (${SECONDS}s, ${(pcm.length / 1024 / 1024).toFixed(1)} MB)`);
