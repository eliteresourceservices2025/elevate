import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { ALLOWED_TYPES_TEXT, MAX_FILE_BYTES, kindFromMime, mimeOf, sanitizeFileName, sniffFileKind, type FileKind } from "@/modules/documents/files";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { AUDIO_TYPES, MAX_VOICE_BYTES, MAX_VOICE_SECONDS, UPLOAD_WINDOW_MINUTES, audioKindFromMime, sniffAudioKind, stripImageMetadata, type ImageKind } from "./media";
import { messageAttachments } from "./schema";
import { requireMember, requireVisibleMessage, type Actor } from "./service";

// Files, pictures and voice notes. Three steps, like documents: ask (the server picks the path and returns a one-time upload token),
// the browser uploads straight to storage, then finalize (the server reads the file, judges its type by its bytes, removes hidden
// details from pictures, and only then activates it). A file that fails is deleted. Names are encrypted; nothing here is ever
// reached through a storage link: files are served by our own authenticated route.

const NOT_ALLOWED = `That file isn't an allowed type. Use ${ALLOWED_TYPES_TEXT}.`;
const NOT_ALLOWED_VOICE = "That voice note isn't an allowed type.";
const FILE_NOT_FOUND = "File not found.";
const MAX_PENDING = 10;
const nameContext = (id: string) => `chat_attachment_name:${id}`;

export type UploadTicket = { id: string; bucket: string; path: string; token: string; contentType: string };
export type FinishedUpload = { id: string; kind: "image" | "file" | "voice"; name: string; mime: string; size: number; durationS: number | null };

export async function requestUpload(
  actor: Actor,
  input: { conversationId: string; fileName: string; size: number; mime: string; kind: "image" | "file" | "voice"; durationS?: number },
): Promise<UploadTicket> {
  await requireMember(db, actor.id, input.conversationId);
  if (!(await allowRequest("upload", actor.id))) throw new ActionFailure("Too many uploads. Wait a few minutes and try again.");

  let name: string;
  let contentType: string;
  if (input.kind === "voice") {
    if (input.size > MAX_VOICE_BYTES) throw new ActionFailure("Voice notes can be up to 5 MB.");
    if ((input.durationS ?? 0) > MAX_VOICE_SECONDS) throw new ActionFailure("Voice notes can be up to 2 minutes.");
    const audio = audioKindFromMime(input.mime);
    if (!audio) throw new ActionFailure(NOT_ALLOWED_VOICE);
    name = `Voice note.${AUDIO_TYPES[audio].extension}`;
    contentType = AUDIO_TYPES[audio].mime;
  } else {
    if (input.size > MAX_FILE_BYTES) throw new ActionFailure("Files can be up to 10 MB.");
    const kind = kindFromMime(input.mime.split(";")[0]);
    if (!kind || (input.kind === "image" && kind !== "jpg" && kind !== "png" && kind !== "webp")) throw new ActionFailure(NOT_ALLOWED);
    name = sanitizeFileName(input.fileName, kind);
    contentType = mimeOf(kind);
  }

  const [waiting] = await db
    .select({ n: count() })
    .from(messageAttachments)
    .where(and(eq(messageAttachments.uploaderUserId, actor.id), eq(messageAttachments.status, "pending"), gt(messageAttachments.createdAt, sql`now() - make_interval(mins => ${UPLOAD_WINDOW_MINUTES})`)));
  if (waiting.n >= MAX_PENDING) throw new ActionFailure("You have files waiting to be sent. Send them, or wait a few minutes.");

  const id = randomUUID();
  const path = `chat/${input.conversationId}/${id}`;
  const { token } = await getDocumentStorage().createSignedUpload(BUCKETS.chat, path);
  await db.insert(messageAttachments).values({
    id,
    conversationId: input.conversationId,
    uploaderUserId: actor.id,
    kind: input.kind,
    bucket: BUCKETS.chat,
    path,
    mime: contentType,
    size: input.size,
    durationS: input.kind === "voice" ? Math.min(input.durationS ?? 0, MAX_VOICE_SECONDS) : null,
    nameEnc: fieldCrypto().encrypt(name, nameContext(id)),
  });
  return { id, bucket: BUCKETS.chat, path, token, contentType };
}

export async function finalizeUpload(actor: Actor, input: { attachmentId: string }): Promise<FinishedUpload> {
  const [row] = await db
    .select()
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.id, input.attachmentId),
        eq(messageAttachments.uploaderUserId, actor.id),
        eq(messageAttachments.status, "pending"),
        gt(messageAttachments.createdAt, sql`now() - make_interval(mins => ${UPLOAD_WINDOW_MINUTES})`),
      ),
    )
    .limit(1);
  if (!row) throw new ActionFailure("Upload not found.");
  await requireMember(db, actor.id, row.conversationId);
  const storage = getDocumentStorage();

  const reject = async (message: string): Promise<never> => {
    await storage.remove(BUCKETS.chat, [row.path]).catch(() => undefined);
    await db.update(messageAttachments).set({ status: "rejected" }).where(eq(messageAttachments.id, row.id));
    throw new ActionFailure(message);
  };

  const bytes = await storage.read(BUCKETS.chat, row.path);
  if (!bytes) return reject("The upload did not arrive. Try again.");
  let mime: string;
  let finalBytes = bytes;
  let name: string;

  if (row.kind === "voice") {
    if (bytes.length > MAX_VOICE_BYTES) return reject("Voice notes can be up to 5 MB.");
    const audio = sniffAudioKind(bytes.subarray(0, 16));
    if (!audio) return reject(NOT_ALLOWED_VOICE);
    mime = AUDIO_TYPES[audio].mime;
    name = `Voice note.${AUDIO_TYPES[audio].extension}`;
  } else {
    if (bytes.length > MAX_FILE_BYTES) return reject("Files can be up to 10 MB.");
    const sniffed: FileKind | null = sniffFileKind(bytes);
    const isImage = sniffed === "jpg" || sniffed === "png" || sniffed === "webp";
    if (!sniffed || (row.kind === "image" && !isImage)) return reject(NOT_ALLOWED);
    mime = mimeOf(sniffed);
    if (isImage) finalBytes = stripImageMetadata(bytes, sniffed as ImageKind);
    const original = fieldCrypto().decrypt(row.nameEnc, nameContext(row.id));
    name = sanitizeFileName(original, sniffed);
  }

  if (finalBytes !== bytes) {
    await storage.remove(BUCKETS.chat, [row.path]);
    await storage.write(BUCKETS.chat, row.path, finalBytes, mime);
  }
  const sha256 = createHash("sha256").update(finalBytes).digest("hex");
  await db
    .update(messageAttachments)
    .set({ status: "active", mime, size: finalBytes.length, sha256, nameEnc: fieldCrypto().encrypt(name, nameContext(row.id)) })
    .where(eq(messageAttachments.id, row.id));
  return { id: row.id, kind: row.kind as FinishedUpload["kind"], name, mime, size: finalBytes.length, durationS: row.durationS };
}

/**
 * The file for the person asking: its uploader until it is sent, then anyone who may see the message it belongs to (a current member,
 * from their join time on, and the message not removed). Everyone else gets the same "File not found."
 */
export async function loadAttachmentForViewer(actor: Actor, attachmentId: string): Promise<{ bytes: Uint8Array; mime: string; name: string; kind: "image" | "file" | "voice"; conversationId: string }> {
  const [row] = await db.select().from(messageAttachments).where(and(eq(messageAttachments.id, attachmentId), eq(messageAttachments.status, "active"))).limit(1);
  if (!row) throw new ActionFailure(FILE_NOT_FOUND);
  if (row.messageId) {
    await requireVisibleMessage(db, actor.id, row.messageId).catch(() => {
      throw new ActionFailure(FILE_NOT_FOUND);
    });
  } else {
    if (row.uploaderUserId !== actor.id) throw new ActionFailure(FILE_NOT_FOUND);
    await requireMember(db, actor.id, row.conversationId).catch(() => {
      throw new ActionFailure(FILE_NOT_FOUND);
    });
  }
  const bytes = await getDocumentStorage().read(row.bucket as typeof BUCKETS.chat, row.path);
  if (!bytes) throw new ActionFailure(FILE_NOT_FOUND);
  return { bytes, mime: row.mime, name: fieldCrypto().decrypt(row.nameEnc, nameContext(row.id)), kind: row.kind as "image" | "file" | "voice", conversationId: row.conversationId };
}
