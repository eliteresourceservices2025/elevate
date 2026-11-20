import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { peopleByUserId } from "@/modules/messages/queries";
import { callParticipants, callRecordingParts, callRecordings, recordingConsents } from "./schema";
import { allowedForRecording, latestAnswers, RECORDING_RETENTION_DAYS, type EndReason, type RecordingInfo } from "./recording-rules";

// The database side of recording that the call lifecycle needs: ending a recording when the call, the recorder or a guest changes
// things, and what the call state tells each person about it. The rest (start, consent, upload, playback) is in recording.ts.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Ends the live recording of a call, if any (only when its recorder is among `recorderUserIds`, if given). Idempotent. */
export async function endActiveRecording(tx: Tx, callId: string, reason: EndReason, recorderUserIds?: string[]): Promise<boolean> {
  const [live] = await tx
    .select({ id: callRecordings.id, recorderUserId: callRecordings.recorderUserId })
    .from(callRecordings)
    .where(and(eq(callRecordings.callId, callId), isNull(callRecordings.endedAt)))
    .for("update")
    .limit(1);
  if (!live) return false;
  if (recorderUserIds && !recorderUserIds.includes(live.recorderUserId)) return false;
  await tx
    .update(callRecordings)
    .set({ endedAt: sql`now()`, endReason: reason, expiresAt: sql`now() + make_interval(days => ${RECORDING_RETENTION_DAYS})` })
    .where(eq(callRecordings.id, live.id));
  await writeAudit({ actor: null, action: "call.recording.stop", targetType: "call_recording", targetId: live.id, metadata: { callId, reason } }, tx);
  return true;
}

/** What this person is told about the live recording of the call (null when nothing is being recorded). */
export async function recordingInfoFor(callId: string, selfId: string): Promise<RecordingInfo | null> {
  const [live] = await db
    .select()
    .from(callRecordings)
    .where(and(eq(callRecordings.callId, callId), isNull(callRecordings.endedAt)))
    .limit(1);
  if (!live) return null;
  const answers = latestAnswers(
    await db.select({ userId: recordingConsents.userId, answer: recordingConsents.answer, answeredAt: recordingConsents.answeredAt }).from(recordingConsents).where(eq(recordingConsents.recordingId, live.id)).orderBy(desc(recordingConsents.answeredAt)),
  );
  const recorderName = (await peopleByUserId([live.recorderUserId])).get(live.recorderUserId)?.name ?? "Someone";
  let allowedUserIds: string[] = [];
  if (selfId === live.recorderUserId) {
    const present = await db.select({ userId: callParticipants.userId }).from(callParticipants).where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt)));
    allowedUserIds = allowedForRecording(answers, present.map((p) => p.userId));
  }
  return { id: live.id, recorderUserId: live.recorderUserId, recorderName, startedAt: live.startedAt.toISOString(), myAnswer: answers.get(selfId) ?? null, allowedUserIds };
}

/** The ready pieces of a recording, in order (for playback and deletion). */
export async function readyParts(recordingId: string) {
  return db
    .select({ seq: callRecordingParts.seq, path: callRecordingParts.path })
    .from(callRecordingParts)
    .where(and(eq(callRecordingParts.recordingId, recordingId), eq(callRecordingParts.status, "ready")))
    .orderBy(asc(callRecordingParts.seq));
}
