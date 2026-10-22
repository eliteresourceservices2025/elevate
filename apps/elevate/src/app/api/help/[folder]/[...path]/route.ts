import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ForbiddenError, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { isSafeAssetPath } from "@/modules/help/body";
import { HELP_ROOT, helpFileSize, mayOpenHelpFile } from "@/modules/help/content";

// A picture or video of a Help center article, for signed-in people who may read that article. Served by the app, never a public link.
// Videos honour Range requests so they can be skipped through.

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4" };
const VIDEO_PATH = /^[a-z0-9][a-z0-9-]{0,80}\.mp4$/;

export async function GET(request: Request, { params }: { params: Promise<{ folder: string; path: string[] }> }) {
  const viewer = await requireUser();
  const { folder, path: parts } = await params;
  const relative = parts.join("/");
  if ((folder !== "assets" && folder !== "videos") || (folder === "assets" ? !isSafeAssetPath(relative) : !VIDEO_PATH.test(relative))) {
    return new Response("Not found", { status: 404 });
  }
  try {
    await authorize(viewer, "help.view");
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    throw error;
  }
  if (!mayOpenHelpFile(viewer.roles, folder, relative)) return new Response("Not found", { status: 404 });
  const size = helpFileSize(folder, relative);
  if (size === null) return new Response("Not found", { status: 404 });

  const full = path.join(HELP_ROOT, folder, relative);
  const headers: Record<string, string> = {
    "Content-Type": TYPES[relative.split(".").pop() ?? ""] ?? "application/octet-stream",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
