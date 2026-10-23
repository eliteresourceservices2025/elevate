import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "./db";
import { resolveSession } from "./handlers";

// The recap videos and their subtitle files are not public files: they are read from a private folder and handed only to a signed-in
// person, so a link copied out of the page does nothing for anyone else. (Anyone who can play a video can still record their screen; this
// keeps the file itself, and the easy ways to save it, away from people who are not course takers.) Seeking works through byte ranges.

export const RECAP_DIR = join(/* turbopackIgnore: true */ process.cwd(), "media", "recaps");
/** The read-aloud clips of the mock call and the exam (src/lib/voice.ts) are served the same way, from their own folder. */
export const VOICE_DIR = join(/* turbopackIgnore: true */ process.cwd(), "media", "voice");
const NAME = /^[a-z0-9_-]{1,80}\.(mp4|vtt|m4a)$/;
const TYPES: Record<string, string> = { mp4: "video/mp4", vtt: "text/vtt; charset=utf-8", m4a: "audio/mp4" };

const plain = (status: number, text: string) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function handleRecapMedia(request: Request, file: string, deps: { sql: Sql; production: boolean; dir?: string }): Promise<Response> {
  const session = await resolveSession(request.headers.get("cookie"), deps);
  if (!session) return plain(401, "Please sign in again.");
  if (!NAME.test(file)) return plain(404, "Not found.");
  const path = join(/* turbopackIgnore: true */ deps.dir ?? RECAP_DIR, file);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return plain(404, "Not found.");
  }
  const base = { "content-type": TYPES[file.split(".").pop() as string], "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    status = 206;
  }
  const handle = await open(path, "r");
  try {
    const length = end - start + 1;
    const buffer = Buffer.alloc(length);
    let filled = 0;
    // a read can return fewer bytes than asked: keep going until the range is full
    while (filled < length) {
      const { bytesRead } = await handle.read(buffer, filled, length - filled, start + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled < length) return plain(500, "Could not read the file.");
    const headers = new Headers({ ...base, "content-length": String(length) });
    if (status === 206) headers.set("content-range", `bytes ${start}-${end}/${size}`);
    return new Response(buffer, { status, headers });
  } finally {
    await handle.close();
  }
}
