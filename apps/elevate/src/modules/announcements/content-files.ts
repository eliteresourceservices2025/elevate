import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { MAX_FILE_BYTES, MAX_VIDEO_BYTES, VIDEO_HEAD_BYTES, VIDEO_TYPES, extensionOf, mimeOf, sniffFileKind, sniffVideoKind, videoKindFromMime } from "@/modules/documents/files";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { employees } from "@/modules/people/schema";
import { cleanJpeg } from "@/modules/people/photo";
import { referencedFileIds } from "@/lib/markdown";
import { announcementRecipients, announcements, contentFiles, policies, policyVersions } from "./schema";

// Pictures and files on announcements and policies. See contentFiles in schema.ts for the model.

export const MAX_FILES_PER_ITEM = 12;
export const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE_LIMITS = { maxBytes: MAX_IMAGE_BYTES, minSide: 50, maxSide: 2400 };
const PENDING_LIMIT = 30;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FILE_KINDS = new Set(["pdf", "docx", "doc"]);

const VIDEO_PREFIX = "videos/";
const PLAYBACK_SECONDS = 300;

export type ContentFileView = { id: string; kind: "image" | "file" | "video"; fileName: string; sizeBytes: number };
export type Parent = { announcementId: string } | { policyVersionId: string; policyId: string };

const viewKind = (kind: string): ContentFileView["kind"] => (kind === "image" ? "image" : kind === "video" ? "video" : "file");
const view = (r: { id: string; kind: string; fileName: string; sizeBytes: number }): ContentFileView => ({ id: r.id, kind: viewKind(r.kind), fileName: r.fileName, sizeBytes: r.sizeBytes });

/** Videos live in their own bucket (paths start with "videos/"); everything else is in company-docs. */
const bucketFor = (path: string) => (path.startsWith(VIDEO_PREFIX) ? BUCKETS.videos : BUCKETS.company);

/** A file name that is safe to show and to send in a header: no path, no control characters, at most 120 characters. */
export function safeFileName(raw: string, fallback: string): string {
  const base = raw.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f"<>:*?|]/g, "").trim().slice(0, 120);
  return base || fallback;
}

/** Whether the author already has as many unsaved (pending) files as one person may keep waiting. */
async function tooManyPending(actor: AuthUser): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(contentFiles).where(and(eq(contentFiles.ownerId, actor.id), isNull(contentFiles.announcementId), isNull(contentFiles.policyVersionId)));
  return n >= PENDING_LIMIT;
}

/** Stores an uploaded picture (already cropped and re-encoded by the browser; cleaned again here) or document as a pending file. */
export async function uploadContentFile(actor: AuthUser, input: { kind: "image" | "file"; bytes: Uint8Array; fileName: string }): Promise<{ ok: true; file: ContentFileView } | { ok: false; error: string }> {
  await authorize(actor, "announcements.manage");

  if (await tooManyPending(actor)) return { ok: false, error: "Too many files are waiting. Save what you are writing first." };

  let bytes = input.bytes;
  let mime: string;
  let ext: string;
  if (input.kind === "image") {
    const cleaned = cleanJpeg(input.bytes, IMAGE_LIMITS);
    if (!cleaned.ok) return { ok: false, error: cleaned.error === "Choose a JPG, PNG or WEBP picture." ? "Add a JPG, PNG or WEBP picture." : cleaned.error };
    bytes = cleaned.bytes;
    mime = "image/jpeg";
    ext = "jpg";
  } else {
    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return { ok: false, error: "A file can be up to 10 MB." };
    const kind = sniffFileKind(bytes);
    if (!kind || !FILE_KINDS.has(kind)) return { ok: false, error: "Attach a PDF or Word document." };
    mime = mimeOf(kind);
    ext = extensionOf(kind);
  }

  const path = `content/${randomUUID()}.${ext}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await getDocumentStorage().write(BUCKETS.company, path, bytes, mime);
  const fileName = safeFileName(input.fileName, `${input.kind === "image" ? "picture" : "file"}.${ext}`);
  const [row] = await db
    .insert(contentFiles)
    .values({ ownerId: actor.id, kind: input.kind, fileName, mimeType: mime, sizeBytes: bytes.length, sha256, storagePath: path })
    .returning({ id: contentFiles.id, kind: contentFiles.kind, fileName: contentFiles.fileName, sizeBytes: contentFiles.sizeBytes });
  return { ok: true, file: view(row) };
}

// --- Videos: request, (browser sends the file straight to storage), finalize ---------------------

export type VideoTicket = { id: string; bucket: string; path: string; token: string; contentType: string };

/** Step 1: checks what can be checked before the file exists, records a not-yet-usable row and returns a one-time upload token. */
export async function requestVideoUpload(actor: AuthUser, input: { fileName: string; mimeType: string; sizeBytes: number }): Promise<{ ok: true; ticket: VideoTicket } | { ok: false; error: string }> {
  await authorize(actor, "announcements.manage");
  const kind = videoKindFromMime(input.mimeType);
  if (!kind) return { ok: false, error: "Add an MP4 or WebM video." };
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_VIDEO_BYTES) return { ok: false, error: "A video can be up to 100 MB." };

  if (await tooManyPending(actor)) return { ok: false, error: "Too many files are waiting. Save what you are writing first." };

  const path = `${VIDEO_PREFIX}${randomUUID()}.${VIDEO_TYPES[kind].extension}`;
  const fileName = safeFileName(input.fileName, `video.${VIDEO_TYPES[kind].extension}`);
  const { token } = await getDocumentStorage().createSignedUpload(BUCKETS.videos, path);
  const [row] = await db
    .insert(contentFiles)
    .values({ ownerId: actor.id, kind: "video", fileName, mimeType: VIDEO_TYPES[kind].mime, sizeBytes: input.sizeBytes, sha256: "", storagePath: path })
    .returning({ id: contentFiles.id });
  return { ok: true, ticket: { id: row.id, bucket: BUCKETS.videos, path, token, contentType: VIDEO_TYPES[kind].mime } };
}

async function ownPendingVideo(actor: AuthUser, id: string) {
  const [row] = await db.select().from(contentFiles).where(eq(contentFiles.id, id)).limit(1);
  const ok = row && row.kind === "video" && row.ownerId === actor.id && row.announcementId === null && row.policyVersionId === null && row.sha256 === "";
  return ok ? row : null;
}

/** Step 3: reads only the first bytes and the size, checks what the file really is, and makes the row usable. A failing file is deleted. */
export async function finalizeVideoUpload(actor: AuthUser, id: string): Promise<{ ok: true; file: ContentFileView } | { ok: false; error: string }> {
  await authorize(actor, "announcements.manage");
  const row = await ownPendingVideo(actor, id);
  if (!row) return { ok: false, error: "That upload was not found." };
  const reject = async (error: string) => {
    await db.delete(contentFiles).where(eq(contentFiles.id, row.id));
    await getDocumentStorage().remove(BUCKETS.videos, [row.storagePath]).catch(() => {});
    return { ok: false as const, error };
  };

  const head = await getDocumentStorage().head(BUCKETS.videos, row.storagePath, VIDEO_HEAD_BYTES);
  if (!head) return reject("We did not receive the video. Try uploading it again.");
  if (head.size <= 0 || head.size > MAX_VIDEO_BYTES) return reject("A video can be up to 100 MB.");
  const kind = sniffVideoKind(head.bytes);
  if (!kind) return reject("That file is not an MP4 or WebM video, so it was not saved.");
  if (VIDEO_TYPES[kind].mime !== row.mimeType) return reject("The file does not match the type you chose, so it was not saved.");

  const sha256 = createHash("sha256").update(head.bytes).digest("hex"); // of the first bytes only: the video is never read whole here
  const updated = await db.transaction(async (tx) => {
    const [r] = await tx.update(contentFiles).set({ sha256, sizeBytes: head.size }).where(and(eq(contentFiles.id, row.id), eq(contentFiles.sha256, ""))).returning({ id: contentFiles.id, kind: contentFiles.kind, fileName: contentFiles.fileName, sizeBytes: contentFiles.sizeBytes });
    if (r) await writeAudit({ actor, action: "content.video_add", targetType: "content_file", targetId: r.id, metadata: { sizeBytes: r.sizeBytes } }, tx);
    return r;
  });
  if (!updated) return { ok: false, error: "That upload was already finished." };
  return { ok: true, file: view(updated) };
}

/** Abandons an upload that was requested (for example the browser upload failed). */
export async function cancelVideoUpload(actor: AuthUser, id: string): Promise<void> {
  await authorize(actor, "announcements.manage");
  const row = await ownPendingVideo(actor, id);
  if (!row) return;
  await db.delete(contentFiles).where(eq(contentFiles.id, row.id));
  await getDocumentStorage().remove(BUCKETS.videos, [row.storagePath]).catch(() => {});
}

type Tx = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/**
 * Makes an item's files exactly what the editor sent: pending files of the author are bound to it, files already on it stay, files
 * from an earlier version of the same policy are copied, and anything else on the item is removed. Pictures are kept only when the text
 * points at them. Returns the stored files that may now be unused (delete them with deleteUnusedPaths after the commit).
 */
export async function syncContentFiles(tx: Tx, actor: { id: string }, parent: Parent, attachmentIds: string[], body: string): Promise<{ removedPaths: string[] }> {
  const referenced = new Set(referencedFileIds(body));
  const wanted = [...new Set([...attachmentIds.map((i) => i.toLowerCase()), ...referenced])];
  if (wanted.length > MAX_FILES_PER_ITEM) throw new ActionFailure(`At most ${MAX_FILES_PER_ITEM} pictures and files can be added.`);

  const rows = wanted.length ? await tx.select().from(contentFiles).where(inArray(contentFiles.id, wanted)) : [];
  if (rows.length !== wanted.length) throw new ActionFailure("A picture or file could not be found. Add it again.");
  // A picture nobody points at is dropped; a picture the text points at must exist.
  for (const id of referenced) if (rows.find((r) => r.id === id)?.kind !== "image") throw new ActionFailure("A picture in the text could not be found. Add it again.");
  const keep = rows.filter((r) => r.kind === "file" || r.kind === "video" || referenced.has(r.id));
  const videos = keep.filter((r) => r.kind === "video");
  if (videos.length > 1) throw new ActionFailure("Only one video can be added.");
  if (videos.length && !("announcementId" in parent)) throw new ActionFailure("Videos can only be added to announcements.");
  if (videos.some((r) => r.sha256 === "")) throw new ActionFailure("The video has not finished uploading.");

  const onThis = "announcementId" in parent ? eq(contentFiles.announcementId, parent.announcementId) : eq(contentFiles.policyVersionId, parent.policyVersionId);
  const siblingVersions = "policyId" in parent ? (await tx.select({ id: policyVersions.id }).from(policyVersions).where(eq(policyVersions.policyId, parent.policyId))).map((v) => v.id) : [];

  for (const r of keep) {
    const isHere = "announcementId" in parent ? r.announcementId === parent.announcementId : r.policyVersionId === parent.policyVersionId;
    if (isHere) continue;
    const pending = r.announcementId === null && r.policyVersionId === null;
    if (pending) {
      if (r.ownerId !== actor.id) throw new ActionFailure("A picture or file could not be found. Add it again.");
      await tx
        .update(contentFiles)
        .set("announcementId" in parent ? { announcementId: parent.announcementId } : { policyVersionId: parent.policyVersionId })
        .where(eq(contentFiles.id, r.id));
    } else if ("policyId" in parent && r.policyVersionId && siblingVersions.includes(r.policyVersionId)) {
      // The new draft starts with the earlier version's files: a copy of the row, sharing the stored file.
      await tx.insert(contentFiles).values({ ownerId: actor.id, policyVersionId: parent.policyVersionId, kind: r.kind, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, sha256: r.sha256, storagePath: r.storagePath });
    } else {
      throw new ActionFailure("A picture or file could not be found. Add it again.");
    }
  }

  // Detach what the editor no longer has.
  const keptIds = keep.map((r) => r.id);
  const current = await tx.select({ id: contentFiles.id, path: contentFiles.storagePath }).from(contentFiles).where(onThis);
  // The rows just bound are "current" too: only remove rows that were there before and are not wanted. Copies have new ids, so match by path.
  const keptPaths = new Set(keep.map((r) => r.storagePath));
  const removed = current.filter((c) => !keptIds.includes(c.id) && !keptPaths.has(c.path));
  if (removed.length) await tx.delete(contentFiles).where(inArray(contentFiles.id, removed.map((r) => r.id)));
  return { removedPaths: [...new Set(removed.map((r) => r.path))] };
}

/** Removes stored files that no row uses any more (several rows can share one). Best effort: a failure leaves a file for the next purge. */
export async function deleteUnusedPaths(paths: string[]): Promise<void> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return;
  const used = await db.select({ path: contentFiles.storagePath }).from(contentFiles).where(inArray(contentFiles.storagePath, unique));
  const inUse = new Set(used.map((u) => u.path));
  const free = unique.filter((p) => !inUse.has(p));
  const videos = free.filter((p) => bucketFor(p) === BUCKETS.videos);
  const others = free.filter((p) => bucketFor(p) === BUCKETS.company);
  if (others.length) await getDocumentStorage().remove(BUCKETS.company, others).catch(() => {});
  if (videos.length) await getDocumentStorage().remove(BUCKETS.videos, videos).catch(() => {});
}

export async function listAnnouncementFiles(announcementId: string): Promise<ContentFileView[]> {
  const rows = await db.select().from(contentFiles).where(eq(contentFiles.announcementId, announcementId)).orderBy(contentFiles.createdAt);
  return rows.map(view);
}

export async function listVersionFiles(policyVersionId: string): Promise<ContentFileView[]> {
  const rows = await db.select().from(contentFiles).where(eq(contentFiles.policyVersionId, policyVersionId)).orderBy(contentFiles.createdAt);
  return rows.map(view);
}

export type OpenedFile =
  | { kind: "image" | "file"; bytes: Uint8Array; mimeType: string; fileName: string; id: string }
  | { kind: "video"; playbackUrl: string; id: string };

/**
 * A stored picture or file for someone who may see it: its author while it is pending; people who can read the announcement; for a
 * policy, everyone once the version is published and only HR while it is a draft. Anyone else gets null (the same as a missing file).
 */
export async function openContentFile(viewer: AuthUser, id: string): Promise<OpenedFile | null> {
  await authorize(viewer, "announcements.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [f] = await db.select().from(contentFiles).where(eq(contentFiles.id, id)).limit(1);
  if (!f) return null;
  const isHr = can(viewer, "announcements.manage");

  let allowed = false;
  if (f.announcementId) {
    const [a] = await db.select({ audience: announcements.audience, archivedAt: announcements.archivedAt }).from(announcements).where(eq(announcements.id, f.announcementId)).limit(1);
    if (a && (isHr || (!a.archivedAt && (a.audience === "all" || (await isRecipient(f.announcementId, viewer.id)))))) allowed = true;
  } else if (f.policyVersionId) {
    const [v] = await db
      .select({ status: policyVersions.status, policyArchived: policies.archivedAt })
      .from(policyVersions)
      .innerJoin(policies, eq(policies.id, policyVersions.policyId))
      .where(eq(policyVersions.id, f.policyVersionId))
      .limit(1);
    if (v && (isHr || (v.status === "published" && !v.policyArchived))) allowed = true;
  } else {
    allowed = f.ownerId === viewer.id; // pending: only its author
  }
  if (!allowed) return null;
  if (f.kind === "video") {
    // Not played until finalized; the browser then streams it from a short-lived storage link, so seeking works.
    if (f.sha256 === "") return null;
    return { kind: "video", id: f.id, playbackUrl: await getDocumentStorage().createSignedPlayback(BUCKETS.videos, f.storagePath, PLAYBACK_SECONDS) };
  }
  const bytes = await getDocumentStorage().read(bucketFor(f.storagePath), f.storagePath);
  if (!bytes) return null;
  return { bytes, mimeType: f.mimeType, fileName: f.fileName, kind: f.kind === "image" ? "image" : "file", id: f.id };
}

async function isRecipient(announcementId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ e: announcementRecipients.employeeId })
    .from(announcementRecipients)
    .innerJoin(employees, eq(employees.id, announcementRecipients.employeeId))
    .where(and(eq(announcementRecipients.announcementId, announcementId), eq(employees.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** Daily: pending files nobody saved (older than a day) are removed with their stored file. */
export async function purgeOrphanContentFiles(now = new Date()): Promise<{ removed: number }> {
  const cutoff = new Date(now.getTime() - PENDING_MAX_AGE_MS);
  const stale = await db
    .select({ id: contentFiles.id, path: contentFiles.storagePath })
    .from(contentFiles)
    .where(and(isNull(contentFiles.announcementId), isNull(contentFiles.policyVersionId), lt(contentFiles.createdAt, cutoff)));
  if (stale.length === 0) return { removed: 0 };
  await db.delete(contentFiles).where(inArray(contentFiles.id, stale.map((s) => s.id)));
  await deleteUnusedPaths(stale.map((s) => s.path));
  return { removed: stale.length };
}

/** For discarding a draft: its file rows go with it (stored files only when no other version uses them). */
export async function removeVersionFiles(tx: Tx, policyVersionId: string): Promise<string[]> {
  const rows = await tx.select({ id: contentFiles.id, path: contentFiles.storagePath }).from(contentFiles).where(eq(contentFiles.policyVersionId, policyVersionId));
  if (rows.length) await tx.delete(contentFiles).where(inArray(contentFiles.id, rows.map((r) => r.id)));
  return [...new Set(rows.map((r) => r.path))];
}
