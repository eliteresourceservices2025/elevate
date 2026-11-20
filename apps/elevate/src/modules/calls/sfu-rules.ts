// Plain checks used before anything is put into a Cloudflare URL or body (no secrets, no network). A session id is hex (Cloudflare's real
// ones are 64 characters, confirmed in the Phase 4 spike; the fake in tests makes 32), nothing else;
// a track name is a short safe token we generate ourselves, never text typed by a person.

export const isSafeSessionId = (value: unknown): value is string => typeof value === "string" && /^(?:[0-9a-f]{32}|[0-9a-f]{64})$/i.test(value);

export const isSafeTrackName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/** The media type (audio or video) of the section with this mid in an SDP, or null. Used to check the kind a browser CLAIMS for a track. */
export function mediaKindForMid(sdp: string, mid: string): "audio" | "video" | null {
  for (const section of sdp.split(/\r?\n(?=m=)/)) {
    const media = /^m=(audio|video)\s/.exec(section);
    if (!media) continue;
    if (new RegExp(`^a=mid:${mid.replace(/[^A-Za-z0-9_-]/g, "")}\\s*$`, "m").test(section)) return media[1] as "audio" | "video";
  }
  return null;
}

/** What each person publishes, named by us: "<kind>-<random>" so a track name never carries a person's name. */
export function newTrackName(kind: "audio" | "video" | "screen", random: string): string {
  return `${kind}-${random.replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}`;
}
