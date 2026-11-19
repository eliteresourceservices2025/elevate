import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { peopleByUserId } from "@/modules/messages/queries";
import { conversations } from "@/modules/messages/schema";
import { postSystemLine } from "@/modules/messages/service";
import { broadcastCallEvent } from "./realtime";
import { endActiveRecording, readyParts } from "./recording-state";
import {
  RECORDING_MAX_BYTES,
  RECORDING_MAX_PARTS,
  RECORDING_PART_MAX_BYTES,
  RECORDING_RETENTION_DAYS,
  UPLOAD_GRACE_MINUTES,
  recordingRefusal,
  startsWithEbml,
  type ConsentAnswer,
} from "./recording-rules";
import { callParticipants, callRecordingParts, callRecordings, callSettings, calls, recordingConsents } from "./schema";
import { requireSeat, type Actor } from "./service";

// Recording a call (Phase 5b). The recorder's own browser mixes the call and uploads it in pieces; the server decides who may record
// (a Super Admin's pick, the company switch, never a client group or a guest), keeps everyone's yes or no, checks every piece by its
// bytes, and plays the file back only to people who were in the call. Nothing about a person is recorded before their yes: the
// recorder's browser only includes people the server lists as allowed. Audit rows carry ids and counts, never the content.

const NOT_FOUND = "Recording not found.";

/** A seat that overlaps the recording (they were in the call while it ran) and was not taken out by the host. */
const wasThere = (startedAt: Date, endedAt: Date | null) =>
  sql`${callParticipants.removedBy} is null and ${callParticipants.joinedAt} < ${(endedAt ?? new Date()).toISOString()}::timestamptz and (${callParticipants.leftAt} is null or ${callParticipants.leftAt} > ${startedAt.toISOString()}::timestamptz)`;

async function activeRecording(callId: string) {
  const [row] = await db.select().from(callRecordings).where(and(eq(callRecordings.callId, callId), isNull(callRecordings.endedAt))).limit(1);
  return row ?? null;
}

/** The person (recording a call they are in) starts recording. The action has already checked `calls.record` (the Super Admin's pick). */
export async function startRecording(actor: Actor, input: { callId: string }): Promise<{ recordingId: string }> {
  const { row } = await requireSeat(actor, input.callId);
  const [settings] = await db.select({ on: callSettings.recordingEnabled }).from(callSettings).where(eq(callSettings.id, 1)).limit(1);
  const [guests] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(callParticipants)
    .innerJoin(users, eq(users.id, callParticipants.userId))
    .where(and(eq(callParticipants.callId, input.callId), isNull(callParticipants.leftAt), eq(users.isGuest, true)));
  const refusal = recordingRefusal({
    settingOn: settings?.on ?? false,
    conversationKind: row.kind,
    guestInCall: (guests?.n ?? 0) > 0,
    alreadyRecording: Boolean(await activeRecording(input.callId)),
    isGuest: Boolean(actor.isGuest),
  });
  if (refusal) throw new ActionFailure(refusal);
  let recordingId: string;
  try {
    recordingId = await db.transaction(async (tx) => {
      const [made] = await tx.insert(callRecordings).values({ callId: input.callId, recorderUserId: actor.id }).returning({ id: callRecordings.id });
      // The person recording agrees to be recorded by starting it.
      await tx.insert(recordingConsents).values({ recordingId: made.id, userId: actor.id, answer: "allow" });
      await writeAudit({ actor, action: "call.recording.start", targetType: "call_recording", targetId: made.id, metadata: { callId: input.callId } }, tx);
      return made.id;
    });
  } catch (error) {
    // Two people pressed record together: the unique index lets one win.
    if (await activeRecording(input.callId)) throw new ActionFailure("This call is already being recorded.");
    throw error;
  }
  await postSystemLine({ conversationId: row.call.conversationId, senderUserId: actor.id, body: "Recording started. Nobody is recorded until they say yes." }).catch(() => {});
  await broadcastCallEvent({ type: "roster", callId: input.callId });
  return { recordingId };
}

/** The person recording, or the host, stops it. The recording is kept for 30 days. */
export async function stopRecording(actor: Actor, input: { callId: string }): Promise<void> {
  const { row, seat } = await requireSeat(actor, input.callId);
  const live = await activeRecording(input.callId);
  if (!live) return;
  if (live.recorderUserId !== actor.id && seat.role !== "host") throw new ActionFailure("Only the person recording or the host can stop the recording.");
  await db.transaction((tx) => endActiveRecording(tx, input.callId, "stopped"));
  await postSystemLine({ conversationId: row.call.conversationId, senderUserId: actor.id, body: "Recording stopped" }).catch(() => {});
  await broadcastCallEvent({ type: "roster", callId: input.callId });
}

/** Anyone in the call says yes or no to being recorded (and can change their mind). A yes counts from now on; a no stops them being included. */
export async function answerRecordingConsent(actor: Actor, input: { callId: string; answer: ConsentAnswer }): Promise<void> {
  await requireSeat(actor, input.callId);
  const live = await activeRecording(input.callId);
  if (!live) throw new ActionFailure("Nothing is being recorded.");
  await db.transaction(async (tx) => {
    await tx.insert(recordingConsents).values({ recordingId: live.id, userId: actor.id, answer: input.answer });
    await writeAudit({ actor, action: "call.recording.consent", targetType: "call_recording", targetId: live.id, metadata: { callId: input.callId, answer: input.answer } }, tx);
  });
  await broadcastCallEvent({ type: "roster", callId: input.callId });
}

/** The recorder's own recording, still live or just ended (the last piece may arrive a few minutes after the end). */
async function ownRecording(actor: Actor, recordingId: string) {
  const [row] = await db
    .select()
    .from(callRecordings)
    .where(
      and(
        eq(callRecordings.id, recordingId),
        eq(callRecordings.recorderUserId, actor.id),
        isNull(callRecordings.deletedAt),
        or(isNull(callRecordings.endedAt), gt(callRecordings.endedAt, sql`now() - make_interval(mins => ${UPLOAD_GRACE_MINUTES})`)),
      ),
    )
    .limit(1);
  if (!row) throw new ActionFailure(NOT_FOUND);
  return row;
}

export type PartTicket = { bucket: string; path: string; token: string; contentType: string };

/** Step 1 of an upload: the server picks the path and gives a one-time token. Pieces arrive in order; a failed one can be asked for again. */
export async function requestRecordingPart(actor: Actor, input: { recordingId: string; seq: number }): Promise<PartTicket> {
  const rec = await ownRecording(actor, input.recordingId);
  if (!(await allowRequest("callMedia", actor.id))) throw new ActionFailure("Too many requests. Wait a moment and try again.");
  if (input.seq >= RECORDING_MAX_PARTS) throw new ActionFailure("This recording is too long.");
  if (rec.sizeBytes >= RECORDING_MAX_BYTES) throw new ActionFailure("This recording is too big.");
  const parts = await db.select({ seq: callRecordingParts.seq, status: callRecordingParts.status, path: callRecordingParts.path }).from(callRecordingParts).where(eq(callRecordingParts.recordingId, rec.id));
  const existing = parts.find((p) => p.seq === input.seq);
  if (existing?.status === "ready") throw new ActionFailure("That part is already stored.");
  if (!existing && input.seq !== parts.length) throw new ActionFailure("Parts must be sent in order.");
  const path = existing?.path ?? `recordings/${rec.id}/${input.seq}`;
  const storage = getDocumentStorage();
  // A retry starts the file afresh.
  if (existing) await storage.remove(BUCKETS.calls, [path]).catch(() => {});
  else await db.insert(callRecordingParts).values({ recordingId: rec.id, seq: input.seq, path });
  const { token } = await storage.createSignedUpload(BUCKETS.calls, path);
  return { bucket: BUCKETS.calls, path, token, contentType: "video/webm" };
}

/** Step 3: the server reads the piece, checks its size and (for the first one) that it is really WebM, and only then keeps it. */
export async function finalizeRecordingPart(actor: Actor, input: { recordingId: string; seq: number }): Promise<{ sizeBytes: number }> {
  const rec = await ownRecording(actor, input.recordingId);
  const [part] = await db
    .select()
    .from(callRecordingParts)
    .where(and(eq(callRecordingParts.recordingId, rec.id), eq(callRecordingParts.seq, input.seq), eq(callRecordingParts.status, "pending")))
    .limit(1);
  if (!part) throw new ActionFailure("Upload not found.");
  const storage = getDocumentStorage();
  const reject = async (message: string): Promise<never> => {
    await storage.remove(BUCKETS.calls, [part.path]).catch(() => {});
    await db.delete(callRecordingParts).where(eq(callRecordingParts.id, part.id));
    throw new ActionFailure(message);
  };
  const bytes = await storage.read(BUCKETS.calls, part.path);
  if (!bytes || bytes.length === 0) return reject("The upload did not arrive. Try again.");
  if (bytes.length > RECORDING_PART_MAX_BYTES) return reject("That part is too big.");
  if (part.seq === 0 && !startsWithEbml(bytes)) return reject("That isn't a recording.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const total = await db.transaction(async (tx) => {
    await tx.update(callRecordingParts).set({ status: "ready", sizeBytes: bytes.length, sha256 }).where(eq(callRecordingParts.id, part.id));
    const [sum] = await tx
      .update(callRecordings)
      .set({ sizeBytes: sql`${callRecordings.sizeBytes} + ${bytes.length}` })
      .where(eq(callRecordings.id, rec.id))
      .returning({ size: callRecordings.sizeBytes });
    if (sum.size >= RECORDING_MAX_BYTES) await endActiveRecording(tx, rec.callId, "too_big");
    return sum.size;
  });
  if (total >= RECORDING_MAX_BYTES) await broadcastCallEvent({ type: "roster", callId: rec.callId });
  return { sizeBytes: bytes.length };
}

export type RecordingListItem = { id: string; title: string; startedAt: string; minutes: number; sizeBytes: number; recorderName: string; expiresAt: string | null; live: boolean };

/** Recordings of calls this person was in, newest first (not guests, not deleted). */
export async function listMyRecordings(actor: Actor): Promise<RecordingListItem[]> {
  if (actor.isGuest) return [];
  const rows = await db
    .select({ rec: callRecordings, title: conversations.title, kind: conversations.kind })
    .from(callRecordings)
    .innerJoin(calls, eq(calls.id, callRecordings.callId))
    .innerJoin(conversations, eq(conversations.id, calls.conversationId))
    .where(
      and(
        isNull(callRecordings.deletedAt),
        sql`exists (select 1 from chat.call_participants p where p.call_id = ${callRecordings.callId} and p.user_id = ${actor.id} and p.removed_by is null and p.joined_at < coalesce(${callRecordings.endedAt}, now()) and (p.left_at is null or p.left_at > ${callRecordings.startedAt}))`,
      ),
    )
    .orderBy(desc(callRecordings.startedAt))
    .limit(50);
  const names = await peopleByUserId([...new Set(rows.map((r) => r.rec.recorderUserId))]);
  return rows.map((r) => ({
    id: r.rec.id,
    title: r.title ?? (r.kind === "dm" ? "Direct message" : "Group call"),
    startedAt: r.rec.startedAt.toISOString(),
    minutes: r.rec.endedAt ? Math.max(1, Math.round((r.rec.endedAt.getTime() - r.rec.startedAt.getTime()) / 60000)) : 0,
    sizeBytes: r.rec.sizeBytes,
    recorderName: names.get(r.rec.recorderUserId)?.name ?? "Someone",
    expiresAt: r.rec.expiresAt?.toISOString() ?? null,
    live: !r.rec.endedAt,
  }));
}

/**
 * Plays a finished recording: only people who were in that call (never a guest), only before it expires. Every play is audited.
 * Returns the pieces as one stream, read one at a time. Seeking isn't available in this first version (it plays from the start).
 */
export async function openRecording(actor: Actor, recordingId: string): Promise<ReadableStream<Uint8Array>> {
  if (actor.isGuest) throw new ActionFailure(NOT_FOUND);
  const [rec] = await db
    .select()
    .from(callRecordings)
    .where(and(eq(callRecordings.id, recordingId), isNull(callRecordings.deletedAt), isNotNull(callRecordings.endedAt), gt(callRecordings.expiresAt, sql`now()`)))
    .limit(1);
  if (!rec) throw new ActionFailure(NOT_FOUND);
  const [was] = await db
    .select({ id: callParticipants.id })
    .from(callParticipants)
    .where(and(eq(callParticipants.callId, rec.callId), eq(callParticipants.userId, actor.id), wasThere(rec.startedAt, rec.endedAt)))
    .limit(1);
  if (!was) throw new ActionFailure(NOT_FOUND);
  const parts = await readyParts(rec.id);
  if (parts.length === 0) throw new ActionFailure(NOT_FOUND);
  await writeAudit({ actor, action: "call.recording.play", targetType: "call_recording", targetId: rec.id, metadata: { callId: rec.callId, parts: parts.length } });
  const storage = getDocumentStorage();
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next >= parts.length) return controller.close();
      const bytes = await storage.read(BUCKETS.calls, parts[next++].path);
      if (!bytes) return controller.error(new Error("A part of the recording is missing."));
      controller.enqueue(bytes);
    },
  });
}

/** Daily job: closes recordings whose call is over, and deletes the files of recordings past their 30 days. Returns how many were deleted. */
export async function expireRecordings(): Promise<number> {
  await db.execute(sql`
    update chat.call_recordings r
    set ended_at = now(), end_reason = 'call_ended', expires_at = now() + make_interval(days => ${RECORDING_RETENTION_DAYS})
    where r.ended_at is null and exists (select 1 from chat.calls c where c.id = r.call_id and c.ended_at is not null)`);
  const due = await db
    .select({ id: callRecordings.id, callId: callRecordings.callId })
    .from(callRecordings)
    .where(and(isNull(callRecordings.deletedAt), isNotNull(callRecordings.expiresAt), sql`${callRecordings.expiresAt} <= now()`))
    .limit(200);
  const storage = getDocumentStorage();
  let count = 0;
  for (const rec of due) {
    const parts = await db.select({ path: callRecordingParts.path }).from(callRecordingParts).where(eq(callRecordingParts.recordingId, rec.id)).orderBy(asc(callRecordingParts.seq));
    try {
      await storage.remove(BUCKETS.calls, parts.map((p) => p.path));
    } catch {
      continue; // try again tomorrow; never mark deleted while files may remain
    }
    await db.transaction(async (tx) => {
      await tx.update(callRecordings).set({ deletedAt: sql`now()` }).where(eq(callRecordings.id, rec.id));
      await writeAudit({ actor: null, action: "call.recording.expire", targetType: "call_recording", targetId: rec.id, metadata: { callId: rec.callId, parts: parts.length } }, tx);
    });
    count++;
  }
  return count;
}

/** Super Admin: picks who may record calls (never a guest, never someone who left). The action has already checked `calls.manage_recorders`. */
export async function setCanRecordCalls(actor: { id: string; email: string }, input: { userId: string; enabled: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const [person] = await tx.select({ id: users.id, isGuest: users.isGuest, archivedAt: users.archivedAt, was: users.canRecordCalls }).from(users).where(eq(users.id, input.userId)).for("update").limit(1);
    if (!person || person.archivedAt) throw new ActionFailure("Person not found.");
    if (person.isGuest) throw new ActionFailure("A guest can't be given recording.");
    await tx.update(users).set({ canRecordCalls: input.enabled }).where(eq(users.id, input.userId));
    await writeAudit({ actor, action: "call.recorder.set", targetType: "user", targetId: input.userId, before: { canRecordCalls: person.was }, after: { canRecordCalls: input.enabled } }, tx);
  });
}
