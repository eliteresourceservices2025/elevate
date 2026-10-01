"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isExclusionViolation } from "@/lib/db-errors";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { managerChainUserIds, reportName } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { checkWindow, dayLimitWarning, isAfterTheFact, needsHrForAge, windowMinutes } from "./extra-hours";
import { assignedToClient, liveMinutesOnDay } from "./extra-hours-service";
import { shiftOn } from "./schedule";
import { loadSchedules } from "./schedule-service";
import { correctionEvidence, extraHoursRequests } from "./schema";
import { evidencePath, personForUser, prefsFor, rulesFor, verifyEvidence } from "./service";
import { EVIDENCE_MAX_BYTES, answerExtraSchema, cancelExtraSchema, decideExtraSchema, extraRequestSchema, extraUploadSchema, fileExtraForSchema } from "./validators";

// Extra hours. The VA asks (client approval as proof, then the lead decides), or a lead/HR files what the client asked for (the VA
// confirms or declines). Nothing here blocks the clock: approved minutes only decide how worked time is labelled.

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;
const OVERLAP = "There are already extra hours asked for or approved in part of that time.";
const refresh = () => {
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
};
const fmt = (ms: number, zone: string) => formatInZone(ms, zone, "EEE MMM d, h:mm a");

async function nameOf(tx: Pick<typeof db, "select">, employeeId: string): Promise<{ name: string; userId: string | null }> {
  const [e] = await tx.select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees).where(eq(employees.id, employeeId));
  return { name: e ? reportName({ first: e.first, last: e.last, preferred: e.preferred }) : "Someone", userId: e?.userId ?? null };
}

/** Where a request goes first: the person's lead, or HR when nobody is above them or it is too old for a lead. */
async function reviewerIds(tx: Pick<typeof db, "execute" | "select">, employeeId: string, hrOnly: boolean, actorId: string): Promise<string[]> {
  const chain = await managerChainUserIds(tx as never, employeeId);
  const ids = hrOnly || chain.length === 0 ? await hrUserIds() : chain.slice(0, 1);
  return ids.filter((id) => id !== actorId);
}

/** A one-time link to upload one screenshot for an extra hours request, for yourself or (lead/HR) for someone you file for. */
export async function requestExtraEvidenceUpload(input: unknown): Promise<ActionResult<{ id: string; path: string; token: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = extraUploadSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    let employeeId: string;
    if (parsed.data.employeeId) {
      const [target] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, parsed.data.employeeId));
      if (!target) return fail("That person was not found.");
      if (target.userId === actor.id) {
        await authorize(actor, "extra_hours.request", { ownerUserId: actor.id });
      } else {
        await authorize(actor, "extra_hours.file_for_others", { ownerUserId: target.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, parsed.data.employeeId) });
      }
      employeeId = parsed.data.employeeId;
    } else {
      await authorize(actor, "extra_hours.request", { ownerUserId: actor.id });
      employeeId = (await personForUser(db, actor.id)).id;
    }
    if (!(await allowRequest("upload", actor.id))) return fail("Too many uploads. Wait a few minutes and try again.");
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from time.correction_evidence where employee_id = ${employeeId} and uploaded_by = ${actor.id} and correction_id is null and extra_request_id is null and purged_at is null`)) as unknown as { n: number }[];
    if (n >= 6) return fail("You have unused screenshots waiting. Send your request first, or try again tomorrow.");
    const path = evidencePath(employeeId, parsed.data.mime);
    const { token } = await getDocumentStorage().createSignedUpload(BUCKETS.employee, path);
    const [row] = await db.insert(correctionEvidence).values({ employeeId, storagePath: path, mime: parsed.data.mime, uploadedBy: actor.id }).returning({ id: correctionEvidence.id });
    return { ok: true, data: { id: row.id, path, token } };
  });
}

/** A VA asks to work extra hours for a client they are assigned to. Needs a screenshot of the client's approval. The lead decides. */
export async function requestExtraHours(input: unknown): Promise<ActionResult<{ warning: string | null }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "extra_hours.request", { ownerUserId: actor.id });
    const parsed = extraRequestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const person = await personForUser(db, actor.id);
    const prefs = await prefsFor(db, person.id);
    const rules = await rulesFor(db, person.id);
    const nowMs = Date.now();
    const startMs = Date.parse(v.windowStart);
    const endMs = Date.parse(v.windowEnd);
    const already = await liveMinutesOnDay(db, person.id, startMs, prefs.zone);
    const problem = checkWindow({ startMs, endMs, nowMs, maxPerDayMinutes: rules.maxExtraMinutesPerDay, alreadyGrantedMinutes: already });
    if (problem) return fail(problem);
    const date = formatInZone(startMs, prefs.zone, "yyyy-MM-dd");
    if (!(await assignedToClient(db, person.id, v.clientId, date))) return fail("You are not assigned to that client. Ask HR.");

    const minutes = windowMinutes({ startMs, endMs });
    const after = isAfterTheFact(startMs, nowMs);
    const schedules = await loadSchedules(db, person.id);
    const warning = dayLimitWarning(shiftOn(schedules, prefs.zone, date)?.scheduledMinutes ?? null, already + minutes, rules.maxDayMinutes);

    try {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(extraHoursRequests)
          .values({ employeeId: person.id, clientId: v.clientId, source: "va", status: "pending_lead", windowStart: new Date(startMs), windowEnd: new Date(endMs), minutes, contactName: v.contactName, reason: v.reason, afterTheFact: after, filedBy: actor.id })
          .returning({ id: extraHoursRequests.id });
        const attached = await verifyEvidence(tx, person.id, v.evidenceIds, EVIDENCE_MAX_BYTES, actor.id);
        await tx.update(correctionEvidence).set({ extraRequestId: row.id }).where(inArray(correctionEvidence.id, attached));
        const me = await nameOf(tx, person.id);
        const targets = await reviewerIds(tx, person.id, after && needsHrForAge(startMs, nowMs), actor.id);
        await notify(tx, targets.map((userId) => ({ userId, kind: "extrahours.requested", title: `${me.name} asked to work extra hours${after ? " (after the fact)" : ""}`, body: `${fmt(startMs, prefs.zone)} to ${formatInZone(endMs, prefs.zone, "h:mm a")}. ${v.reason}`, link: "/extra-hours" })));
        await writeAudit({ actor, action: "extra_hours.request", targetType: "employee", targetId: person.id, metadata: { requestId: row.id, minutes, afterTheFact: after, evidence: attached.length } }, tx);
      });
    } catch (error) {
      if (isExclusionViolation(error)) return fail(OVERLAP);
      throw error;
    }
    refresh();
    return { ok: true, data: { warning } };
  });
}

/** A lead (their team) or HR (anyone) files extra hours the client asked for. The person confirms or declines. */
export async function fileExtraHoursFor(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const reach = scopeFor(actor, "extra_hours.file_for_others");
    if (reach !== "all" && reach !== "team") throw new ForbiddenError("extra_hours.file_for_others");
    const parsed = fileExtraForSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const target = await nameOf(db, v.employeeId);
    const [exists] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, v.employeeId), isNull(employees.archivedAt)));
    if (!exists) return fail("That person was not found.");
    await authorize(actor, "extra_hours.file_for_others", { ownerUserId: target.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, v.employeeId) });
    if (target.userId === actor.id) return fail("Ask for your own extra hours from the Extra hours page.");

    const prefs = await prefsFor(db, v.employeeId);
    const rules = await rulesFor(db, v.employeeId);
    const nowMs = Date.now();
    const startMs = Date.parse(v.windowStart);
    const endMs = Date.parse(v.windowEnd);
    const already = await liveMinutesOnDay(db, v.employeeId, startMs, prefs.zone);
    const problem = checkWindow({ startMs, endMs, nowMs, maxPerDayMinutes: rules.maxExtraMinutesPerDay, alreadyGrantedMinutes: already });
    if (problem) return fail(problem);
    if (!(await assignedToClient(db, v.employeeId, v.clientId, formatInZone(startMs, prefs.zone, "yyyy-MM-dd")))) return fail("They are not assigned to that client.");

    const minutes = windowMinutes({ startMs, endMs });
    const hr = await hrUserIds();
    try {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(extraHoursRequests)
          .values({ employeeId: v.employeeId, clientId: v.clientId, source: "client", status: "pending_confirm", windowStart: new Date(startMs), windowEnd: new Date(endMs), minutes, contactName: v.contactName, reason: v.reason, afterTheFact: isAfterTheFact(startMs, nowMs), confirmedByPhone: v.confirmedByPhone, filedBy: actor.id })
          .returning({ id: extraHoursRequests.id });
        const attached = await verifyEvidence(tx, v.employeeId, v.evidenceIds, EVIDENCE_MAX_BYTES, actor.id);
        if (attached.length > 0) await tx.update(correctionEvidence).set({ extraRequestId: row.id }).where(inArray(correctionEvidence.id, attached));
        if (target.userId) await notify(tx, { userId: target.userId, kind: "extrahours.confirm_needed", title: "Your client asked for extra hours", body: `${fmt(startMs, prefs.zone)} to ${formatInZone(endMs, prefs.zone, "h:mm a")}. Please confirm or decline.`, link: "/extra-hours" });
        // A lead who is not the filer hears about it (HR filed it); HR hears when a lead filed it.
        const chain = await managerChainUserIds(tx as never, v.employeeId);
        const fyi = [...new Set([...chain.slice(0, 1), ...hr])].filter((id) => id !== actor.id && id !== target.userId);
        await notify(tx, fyi.map((userId) => ({ userId, kind: "extrahours.filed_for", title: `Extra hours were filed for ${target.name}`, body: `The client asked. ${v.reason}`, link: "/extra-hours" })));
        await writeAudit({ actor, action: "extra_hours.file_for", targetType: "employee", targetId: v.employeeId, metadata: { requestId: row.id, minutes, confirmedByPhone: v.confirmedByPhone, evidence: attached.length } }, tx);
      });
    } catch (error) {
      if (isExclusionViolation(error)) return fail(OVERLAP);
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

/** The VA confirms or declines what the client asked for (filed by a lead or HR). Confirming approves it; declining tells the filer. */
export async function answerExtraHours(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "extra_hours.request", { ownerUserId: actor.id });
    const parsed = answerExtraSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const person = await personForUser(db, actor.id);
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(extraHoursRequests).where(eq(extraHoursRequests.id, parsed.data.requestId)).for("update");
      if (!r || r.employeeId !== person.id) throw new ActionFailure("That request was not found.");
      if (r.status !== "pending_confirm") throw new ActionFailure("That request was already answered.");
      const confirm = parsed.data.answer === "confirm";
      await tx
        .update(extraHoursRequests)
        .set({ status: confirm ? "approved" : "declined", decidedBy: confirm ? r.filedBy : actor.id, decidedAt: new Date(), decisionNote: parsed.data.note ?? null })
        .where(eq(extraHoursRequests.id, r.id));
      const me = await nameOf(tx, person.id);
      await notify(tx, { userId: r.filedBy, kind: confirm ? "extrahours.confirmed" : "extrahours.declined_by_va", title: confirm ? `${me.name} confirmed the extra hours` : `${me.name} declined the extra hours`, body: parsed.data.note, link: "/extra-hours" });
      await writeAudit({ actor, action: confirm ? "extra_hours.confirm" : "extra_hours.decline_by_va", targetType: "employee", targetId: person.id, metadata: { requestId: r.id } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/**
 * The person's lead (HR when nobody is above, or when it was asked for after the fact more than 7 days late) approves or declines a
 * VA's request, and may change the window when approving. Nobody decides their own or one they filed.
 */
export async function decideExtraHours(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = decideExtraSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.decision === "decline" && !v.note) return fail("Give a short reason so the person knows why.");
    if ((v.windowStart || v.windowEnd) && v.decision !== "approve") return fail("The window can only be changed when approving.");
    if (Boolean(v.windowStart) !== Boolean(v.windowEnd)) return fail("Change both the start and the end.");

    try {
      await db.transaction(async (tx) => {
        const [r] = await tx.select().from(extraHoursRequests).where(eq(extraHoursRequests.id, v.requestId)).for("update");
        if (!r) throw new ActionFailure("That request was not found.");
        if (r.status !== "pending_lead") throw new ActionFailure("That request was already handled.");
        const person = await nameOf(tx, r.employeeId);
        if (person.userId === actor.id || r.filedBy === actor.id) throw new ActionFailure("Someone else must decide on your own request.");
        await authorize(actor, "extra_hours.decide", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await managerChainUserIds(tx as never, r.employeeId) });
        if (r.afterTheFact && needsHrForAge(r.windowStart.getTime(), r.createdAt.getTime()) && scopeFor(actor, "extra_hours.decide") !== "all") throw new ActionFailure("Only HR can decide this request.");

        const prefs = await prefsFor(tx as never, r.employeeId);
        let startMs = r.windowStart.getTime();
        let endMs = r.windowEnd.getTime();
        let minutes = r.minutes;
        const changed = Boolean(v.windowStart && v.windowEnd) && (Date.parse(v.windowStart!) !== startMs || Date.parse(v.windowEnd!) !== endMs);
        if (v.decision === "approve" && changed) {
          startMs = Date.parse(v.windowStart!);
          endMs = Date.parse(v.windowEnd!);
          const rules = await rulesFor(tx as never, r.employeeId);
          const problem = checkWindow({ startMs, endMs, nowMs: Date.now(), maxPerDayMinutes: rules.maxExtraMinutesPerDay, alreadyGrantedMinutes: await liveMinutesOnDay(tx as never, r.employeeId, startMs, prefs.zone, r.id) });
          if (problem) throw new ActionFailure(problem);
          minutes = windowMinutes({ startMs, endMs });
        }
        await tx
          .update(extraHoursRequests)
          .set({
            status: v.decision === "approve" ? "approved" : "declined",
            decidedBy: actor.id,
            decidedAt: new Date(),
            decisionNote: v.note ?? null,
            ...(v.decision === "approve" && changed ? { windowStart: new Date(startMs), windowEnd: new Date(endMs), minutes, originalWindowStart: r.windowStart, originalWindowEnd: r.windowEnd } : {}),
          })
          .where(eq(extraHoursRequests.id, r.id));
        if (person.userId) {
          await notify(tx, {
            userId: person.userId,
            kind: v.decision === "approve" ? "extrahours.approved" : "extrahours.declined",
            title: v.decision === "approve" ? (changed ? "Your extra hours were approved with a changed time" : "Your extra hours were approved") : "Your extra hours were declined",
            body: v.decision === "approve" ? `${fmt(startMs, prefs.zone)} to ${formatInZone(endMs, prefs.zone, "h:mm a")}.${v.note ? ` ${v.note}` : ""}` : v.note,
            link: "/extra-hours",
          });
        }
        await writeAudit({ actor, action: `extra_hours.${v.decision}`, targetType: "employee", targetId: r.employeeId, before: changed ? { windowStart: r.windowStart.toISOString(), windowEnd: r.windowEnd.toISOString() } : null, after: { requestId: r.id, minutes, windowStart: new Date(startMs).toISOString(), windowEnd: new Date(endMs).toISOString() }, metadata: { note: v.note ?? null, changed } }, tx);
      });
    } catch (error) {
      if (isExclusionViolation(error)) return fail(OVERLAP);
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

/**
 * Withdraws a request. The person, or whoever filed it, can cancel while it waits; the person's lead or HR can also cancel an
 * approved window that has not started. Cancelling approved time takes its minutes away from the day.
 */
export async function cancelExtraHours(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = cancelExtraSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(extraHoursRequests).where(eq(extraHoursRequests.id, parsed.data.requestId)).for("update");
      if (!r) throw new ActionFailure("That request was not found.");
      const person = await nameOf(tx, r.employeeId);
      if (person.userId === actor.id || r.filedBy === actor.id) await authorize(actor, "extra_hours.request", { ownerUserId: actor.id });
      else await authorize(actor, "extra_hours.decide", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await managerChainUserIds(tx as never, r.employeeId) });
      const waiting = r.status === "pending_lead" || r.status === "pending_confirm";
      if (!waiting && !(r.status === "approved" && r.windowStart.getTime() > Date.now())) throw new ActionFailure("That request can no longer be cancelled.");
      await tx.update(extraHoursRequests).set({ status: "cancelled", decidedAt: new Date(), decidedBy: actor.id }).where(eq(extraHoursRequests.id, r.id));
      const others = [person.userId, r.filedBy].filter((id): id is string => Boolean(id) && id !== actor.id);
      await notify(tx, [...new Set(others)].map((userId) => ({ userId, kind: "extrahours.cancelled", title: `Extra hours for ${person.name} were cancelled`, link: "/extra-hours" })));
      await writeAudit({ actor, action: "extra_hours.cancel", targetType: "employee", targetId: r.employeeId, metadata: { requestId: r.id, was: r.status } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
