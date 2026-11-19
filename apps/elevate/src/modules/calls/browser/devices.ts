// Choosing a microphone, camera and speakers for calls. Plain functions (no React) so they can be tested. The choice is a convenience kept in
// this browser only (localStorage, wrapped in try/catch: it may be blocked); nothing about devices is sent to the server.

export type DeviceInfo = { id: string; label: string };
export type DeviceLists = { mics: DeviceInfo[]; cams: DeviceInfo[]; speakers: DeviceInfo[] };
export type DeviceKind = "mic" | "cam" | "speaker";
/** The device ids the person chose; null means "the browser's default". */
export type Chosen = { mic: string | null; cam: string | null; speaker: string | null };

export const NO_DEVICES: DeviceLists = { mics: [], cams: [], speakers: [] };
export const NO_CHOICE: Chosen = { mic: null, cam: null, speaker: null };

const STORAGE_KEY = "elevate.call.devices";

type Raw = { kind: string; deviceId: string; label: string };

/** Sorts what the browser lists into microphones, cameras and speakers. Before the person has allowed access, names are empty: they get plain numbered names. */
export function splitDevices(list: readonly Raw[]): DeviceLists {
  const out: DeviceLists = { mics: [], cams: [], speakers: [] };
  const name = (label: string, fallback: string, n: number) => (label.trim() ? label.trim() : `${fallback} ${n}`);
  for (const d of list) {
    if (!d.deviceId) continue;
    if (d.kind === "audioinput") out.mics.push({ id: d.deviceId, label: name(d.label, "Microphone", out.mics.length + 1) });
    else if (d.kind === "videoinput") out.cams.push({ id: d.deviceId, label: name(d.label, "Camera", out.cams.length + 1) });
    else if (d.kind === "audiooutput") out.speakers.push({ id: d.deviceId, label: name(d.label, "Speakers", out.speakers.length + 1) });
  }
  return out;
}

/** The saved choice if that device is still plugged in; otherwise null (the default), so an unplugged headset never blocks a call. */
export function stillThere(saved: string | null, available: readonly DeviceInfo[]): string | null {
  return saved && available.some((d) => d.id === saved) ? saved : null;
}

/** What to ask the browser for: a specific device when one was chosen, otherwise the default. */
export function deviceConstraint(id: string | null): { deviceId: { exact: string } } | true {
  return id ? { deviceId: { exact: id } } : true;
}

export function loadChosen(): Chosen {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return NO_CHOICE;
    const parsed = JSON.parse(raw) as Partial<Chosen>;
    const text = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length < 300 ? v : null);
    return { mic: text(parsed.mic), cam: text(parsed.cam), speaker: text(parsed.speaker) };
  } catch {
    return NO_CHOICE;
  }
}

export function saveChosen(chosen: Chosen): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen));
  } catch {
    // Not remembered this time; the choice still applies to this call.
  }
}

/** Whether this browser can send sound to a chosen speaker (Chrome and Edge can; Safari and Firefox use the system's output). */
export function canChooseSpeaker(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}
