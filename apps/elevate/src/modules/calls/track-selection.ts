// Which tracks a person pulls from the SFU. Pure functions (no server-only import) so the server (the authority on what a person MAY
// pull) and the browser (what it WANTS to show) share the same rules, and so they can be tested. Pulling less is what keeps a 25-person
// meeting and a 125-viewer all-hands inside Cloudflare's free allowance: everyone's audio, but video only for the tiles on screen.

export type TrackKind = "audio" | "video" | "screen";
export type ParticipantRole = "host" | "speaker" | "attendee";
export type CallMode = "meeting" | "townhall";

export type PublishedTrack = { userId: string; role: ParticipantRole; cfSessionId: string; trackName: string; kind: TrackKind };

export const DEFAULT_TILES = 9;
export const MAX_MEETING_PARTICIPANTS = 25;
export const MAX_TOWNHALL_SPEAKERS = 8;
/** An all-hands is for the whole company (about 125 people) with room to grow; only the speakers send anything. */
export const MAX_TOWNHALL_PARTICIPANTS = 150;

/** How many people may be in a call at once. */
export const maxParticipants = (mode: CallMode) => (mode === "townhall" ? MAX_TOWNHALL_PARTICIPANTS : MAX_MEETING_PARTICIPANTS);

/** An all-hands needs a place the whole company or a team shares: never a direct message, and never a client group (a client may not be in it). */
export const TOWNHALL_KINDS = ["company", "department", "team", "channel", "group"] as const;

type Input = {
  tracks: PublishedTrack[];
  selfUserId: string;
  mode: CallMode;
  /** Which page of tiles is showing (0 is the first). */
  page?: number;
  pageSize?: number;
  activeSpeakerId?: string | null;
  /** A person the viewer pinned (or whose screen share is being watched). */
  pinnedUserId?: string | null;
};

export type Selection = {
  /** The tracks to pull now. */
  pull: PublishedTrack[];
  /** The people whose video is on screen, in tile order. */
  visibleUserIds: string[];
  pages: number;
};

/** In an all-hands the audience hears and sees only hosts and speakers; in a meeting everyone is a source. */
const isSource = (mode: CallMode, role: ParticipantRole) => mode === "meeting" || role === "host" || role === "speaker";

/**
 * Everyone's audio (from allowed sources) plus video for one page of tiles. Screen shares come first and always count as visible, then
 * the pinned person, then the active speaker, then everyone else in a steady order (by user id) so tiles don't jump around.
 * Never includes the viewer's own tracks.
 */
export function chooseSubscriptions(input: Input): Selection {
  const pageSize = Math.max(1, input.pageSize ?? DEFAULT_TILES);
  const sources = input.tracks.filter((t) => t.userId !== input.selfUserId && isSource(input.mode, t.role));
  const audio = sources.filter((t) => t.kind === "audio");
  const screens = sources.filter((t) => t.kind === "screen");
  const videoByUser = new Map<string, PublishedTrack>();
  for (const t of sources) if (t.kind === "video" && !videoByUser.has(t.userId)) videoByUser.set(t.userId, t);

  const priority = (userId: string) => (userId === input.pinnedUserId ? 0 : userId === input.activeSpeakerId ? 1 : 2);
  const ordered = [...videoByUser.keys()].sort((a, b) => priority(a) - priority(b) || (a < b ? -1 : a > b ? 1 : 0));
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.min(Math.max(0, input.page ?? 0), pages - 1);
  const shown = ordered.slice(page * pageSize, page * pageSize + pageSize);

  const pull = [...audio, ...screens, ...shown.map((id) => videoByUser.get(id) as PublishedTrack)];
  return { pull, visibleUserIds: [...new Set([...screens.map((s) => s.userId), ...shown])], pages };
}

/** Whether a person may publish in this call right now (the server asks this before forwarding their offer). */
export function mayPublish(mode: CallMode, role: ParticipantRole): boolean {
  return mode === "meeting" || role === "host" || role === "speaker";
}
