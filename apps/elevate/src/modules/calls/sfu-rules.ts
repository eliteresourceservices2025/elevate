// Plain checks used before anything is put into a Cloudflare URL or body (no secrets, no network). A session id is 32 hex characters;
// a track name is a short safe token we generate ourselves, never text typed by a person.

export const isSafeSessionId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/i.test(value);

export const isSafeTrackName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/** What each person publishes, named by us: "<kind>-<random>" so a track name never carries a person's name. */
export function newTrackName(kind: "audio" | "video" | "screen", random: string): string {
  return `${kind}-${random.replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}`;
}
