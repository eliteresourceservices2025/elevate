// The window's only door to the app: Tauri commands. Outside Tauri (a plain browser, for looking at the screens) a small stand-in answers,
// chosen with ?mock=working|break|out|offline|blocked|signedout|update in the address.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type WorkState = "working" | "break" | "out";
export type Project = { id: string; name: string };
export type ClientChoice = { id: string; name: string; projects: Project[] };
export type StatusView = {
  signedIn: boolean;
  state: WorkState | null;
  policy: boolean;
  online: boolean;
  lastSentMs: number | null;
  queueLen: number;
  version: string;
  updateRequired: string | null;
  updateVersion: string | null;
  clients: ClientChoice[];
  workingSince: string | null;
  onBreak: { startedAt: string; plannedMinutes: number | null } | null;
  current: { clientId: string | null; clientName: string | null; projectId: string | null; projectName: string | null; since: string } | null;
  clockBlockedReason: string | null;
  hasShot: boolean;
};
export type ReleaseNotes = { version: string; publishedAt: string | null; notes: { added: string[]; improved: string[]; fixed: string[] }; minRequired: boolean };
export type CapturedApp = { app: string; startMs: number; minutes: number };
export type Notice = { ok: boolean; message: string };

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---- the stand-in used only outside Tauri ----
const mockMode = typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("mock") ?? "working") : "working";
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
let mockState: StatusView = {
  signedIn: mockMode !== "signedout",
  state: mockMode === "out" ? "out" : mockMode === "break" ? "break" : "working",
  policy: true,
  online: mockMode !== "offline",
  lastSentMs: Date.now() - 45_000,
  queueLen: mockMode === "offline" ? 14 : 0,
  version: "0.1.0",
  updateRequired: mockMode === "update" ? "0.2.0" : null,
  updateVersion: mockMode === "ready" ? "0.2.0" : null,
  clients: [
    { id: "c1", name: "Summit Dental Care", projects: [{ id: "p1", name: "Intake desk" }, { id: "p2", name: "Billing follow-up" }] },
    { id: "c2", name: "Harbor Legal Group", projects: [] },
  ],
  workingSince: mockMode === "out" ? null : iso(95),
  onBreak: mockMode === "break" ? { startedAt: iso(12), plannedMinutes: 30 } : null,
  current: mockMode === "out" ? null : { clientId: "c1", clientName: "Summit Dental Care", projectId: "p1", projectName: "Intake desk", since: iso(95) },
  clockBlockedReason: mockMode === "blocked" ? "jibble" : null,
  hasShot: true,
};
const mockCaptured: CapturedApp[] = [
  { app: "chrome", startMs: Date.now() - 3 * 3_600_000, minutes: 142 },
  { app: "excel", startMs: Date.now() - 2 * 3_600_000, minutes: 37 },
  { app: "slack", startMs: Date.now() - 1 * 3_600_000, minutes: 12 },
];
const mockNote = (state: WorkState, text: string) => {
  mockState = { ...mockState, state, workingSince: state === "out" ? null : iso(0), onBreak: state === "break" ? { startedAt: iso(0), plannedMinutes: 30 } : null };
  return text;
};

export async function status(): Promise<StatusView> {
  return inTauri ? invoke<StatusView>("status") : mockState;
}
export async function enroll(code: string): Promise<void> {
  if (inTauri) return invoke("enroll", { code });
  if (code.trim().toUpperCase() !== "ABCD2345") throw "That code is not right. Check it and try again.";
  mockState = { ...mockState, signedIn: true };
}
export async function clockIn(clientId?: string, projectId?: string): Promise<string> {
  return inTauri ? invoke<string>("clock_in", { clientId, projectId }) : mockNote("working", "Clocked in.");
}
export async function switchClient(clientId?: string, projectId?: string): Promise<string> {
  return inTauri ? invoke<string>("switch_client", { clientId, projectId }) : "Switched.";
}
export async function startBreak(minutes?: number): Promise<string> {
  return inTauri ? invoke<string>("start_break", { minutes }) : mockNote("break", "Break started.");
}
export async function endBreak(): Promise<string> {
  return inTauri ? invoke<string>("end_break") : mockNote("working", "Break ended.");
}
export async function clockOut(): Promise<string> {
  return inTauri ? invoke<string>("clock_out") : mockNote("out", "Clocked out.");
}
export async function capturedToday(): Promise<CapturedApp[]> {
  return inTauri ? invoke<CapturedApp[]>("captured_today_list") : mockCaptured;
}
export async function lastShot(): Promise<string | null> {
  if (inTauri) return invoke<string | null>("last_shot_thumbnail");
  return "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e9e4f2"/><rect x="16" y="16" width="288" height="14" fill="#c8bde0"/><rect x="16" y="44" width="180" height="60" rx="6" fill="#d6cdea"/><rect x="208" y="44" width="96" height="120" rx="6" fill="#d6cdea"/><rect x="16" y="116" width="180" height="48" rx="6" fill="#dcd4ee"/></svg>`);
}
export async function checkForUpdates(): Promise<void> {
  if (inTauri) await invoke("check_for_updates");
}
export async function whatsNew(): Promise<ReleaseNotes | null> {
  if (inTauri) return invoke<ReleaseNotes | null>("whats_new");
  return mockMode === "whatsnew" ? { version: "0.1.0", publishedAt: iso(60 * 24), notes: { added: ["Pick a client or project when you clock in"], improved: ["The window opens faster"], fixed: ["The last picture now shows right after it is taken"] }, minRequired: false } : null;
}
export async function markWhatsNewSeen(): Promise<void> {
  if (inTauri) await invoke("mark_whats_new_seen");
}
export async function disconnect(): Promise<void> {
  if (inTauri) return invoke("disconnect");
  mockState = { ...mockState, signedIn: false };
}

/** Calls `onChange` whenever the app says its state changed, and `onNotice` for a message about a click in the tray. */
export async function subscribe(onChange: () => void, onNotice: (n: Notice) => void): Promise<() => void> {
  if (!inTauri) return () => undefined;
  const offs = [await listen("status", onChange), await listen<Notice>("notice", (e) => onNotice(e.payload))];
  return () => offs.forEach((off) => off());
}

// ---- small helpers the screens share ----

/** What a person can pick when clocking in: each client with no projects, or each project and then the client with no specific project. */
export type Choice = { clientId: string; projectId?: string; label: string };
export function workChoices(clients: ClientChoice[]): Choice[] {
  return clients.flatMap((c): Choice[] =>
    c.projects.length === 0 ? [{ clientId: c.id, label: c.name }] : [...c.projects.map((p) => ({ clientId: c.id, projectId: p.id, label: `${c.name} · ${p.name}` })), { clientId: c.id, label: `${c.name} · no specific project` }],
  );
}

export function timeOf(isoText: string | null): string {
  if (!isoText) return "";
  const d = new Date(isoText);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function breakLength(minutes: number | null): string {
  if (minutes === null) return "no time limit";
  return minutes === 60 ? "1 hour" : `${minutes} minutes`;
}
