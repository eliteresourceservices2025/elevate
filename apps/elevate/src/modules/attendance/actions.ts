"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { managerChainUserIds, reportName } from "@/modules/org/service";
import { teams } from "@/modules/org/schema";
import { employees } from "@/modules/people/schema";
import { EOD_EDIT_WINDOW_MS, needsHrDecision, replayClock } from "./clock";
import { clockCorrections, clockEvents, clockPrefs, clockRules, correctionEvidence, idlePrompts, shiftNotes } from "./schema";
import { evidencePath, loadRecentEvents, lockEmployeeClock, monitoringPolicyPublished, performClock, personForUser, rulesFor, selfiePath, verifyEvidence, type ClockResult } from "./service";
import {
  EVIDENCE_MAX_BYTES,
  clockSchema,
  correctionIdSchema,
  correctionRequestSchema,
  decideCorrectionSchema,
  evidenceIdSchema,
  evidenceUploadSchema,
  fileForOthersSchema,
  idleAnswerSchema,
  idleReportSchema,
  noteSchema,
  preferencesSchema,
  rulesSchema,
} from "./validators";

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;
const DAY_MS = 86_400_000;
const MAX_CORRECTION_AGE_MS = 31 * DAY_MS;
const MAX_SESSION_MS = 16 * 3_600_000;

function refresh() {
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

// --- The clock -----------------------------------------------------------------------------------

async function clock(type: "clock_in" | "break_start" | "break_end" | "clock_out", input: unknown): Promise<ActionResult<ClockResult>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.clock", { ownerUserId: actor.id });
    const parsed = clockSchema.safeParse(input ?? {});
    if (!parsed.success) return fail(first(parsed.error));
    const result = await performClock(actor, type, parsed.data);
    refresh();
    return { ok: true, data: result };
  });
}

/** Starts a session. Time and IP are taken on the server. Location and selfie are used only where allowed. */
export async function clockIn(input: unknown): Promise<ActionResult<ClockResult>> {
  await requireUser();
  return clock("clock_in", input);
}
/** Starts a break: 15, 30 or 60 minutes, or no limit. A timed break that runs over is reported to the lead. */
export async function startBreak(input?: unknown): Promise<ActionResult<ClockResult>> {
  await requireUser();
  return clock("break_start", input ?? {});
}
export async function endBreak(): Promise<ActionResult<ClockResult>> {
  await requireUser();
  return clock("break_end", {});
}
export async function clockOut(): Promise<ActionResult<ClockResult>> {
  await requireUser();
  return clock("clock_out", {});
}

/** A one-time link to upload the clock-in selfie to exactly one path in private storage. */
export async function requestClockSelfie(): Promise<ActionResult<{ path: string; token: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.clock", { ownerUserId: actor.id });
    const person = await personForUser(db, actor.id);
    const rules = await rulesFor(db, person.id);
    if (!rules.selfieRequired || !(await monitoringPolicyPublished(db))) return fail("No selfie is needed for your team.");
    if (!(await allowRequest("upload", actor.id))) return fail("Too many uploads. Wait a few minutes and try again.");
    const path = selfiePath(person.id);
    const { token } = await getDocumentStorage().createSignedUpload(BUCKETS.employee, path);
    return { ok: true, data: { path, token } };
  });
}

// --- Preferences and idle prompts ----------------------------------------------------------------

export async function savePreferences(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.set_preferences", { ownerUserId: actor.id });
    const parsed = preferencesSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const person = await personForUser(db, actor.id);
    if (parsed.data.shareLocation && !(await monitoringPolicyPublished(db))) {
      return fail("Location is not available yet. It turns on once the monitoring policy is published.");
    }
    await db.transaction(async (tx) => {
      await tx
        .insert(clockPrefs)
        .values({ employeeId: person.id, shareLocation: parsed.data.shareLocation, timeZone: parsed.data.timeZone ?? null })
        .onConflictDoUpdate({ target: clockPrefs.employeeId, set: { shareLocation: parsed.data.shareLocation, timeZone: parsed.data.timeZone ?? null, updatedAt: new Date() } });
      await writeAudit({ actor, action: "clock.preferences", targetType: "employee", targetId: person.id, after: { shareLocation: parsed.data.shareLocation, timeZone: parsed.data.timeZone ?? null } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** The page shows "Are you still working?": record that it was shown. An unanswered prompt becomes a flag for the lead. */
export async function reportIdlePrompt(input: unknown): Promise<ActionResult<{ promptId: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.clock", { ownerUserId: actor.id });
    const parsed = idleReportSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const person = await personForUser(db, actor.id);
    if (!(await allowRequest("clock", person.id))) return fail("Too many requests. Try again in a minute.");
    const [row] = await db.insert(idlePrompts).values({ employeeId: person.id, source: parsed.data.source }).returning({ id: idlePrompts.id });
    return { ok: true, data: { promptId: row.id } };
  });
}

export async function answerIdlePrompt(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.clock", { ownerUserId: actor.id });
    const parsed = idleAnswerSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const person = await personForUser(db, actor.id);
    await db.update(idlePrompts).set({ answeredAt: new Date() }).where(and(eq(idlePrompts.id, parsed.data.promptId), eq(idlePrompts.employeeId, person.id), sql`${idlePrompts.answeredAt} is null`));
    return { ok: true, data: undefined };
  });
}

// --- Corrections ---------------------------------------------------------------------------------

type Proposed = { type: "clock_in" | "break_start" | "break_end" | "clock_out"; at: string }[];

/** Replays the person's real events together with the proposed ones: every proposed event must fit, and no session may be absurdly long. */
async function checkProposal(employeeId: string, proposed: Proposed, nowMs: number, lock?: Pick<typeof db, "execute">): Promise<string | null> {
  const times = proposed.map((p) => Date.parse(p.at));
  if (times.some((t) => t > nowMs + 60_000)) return "A correction cannot be in the future.";
  if (times.some((t) => t < nowMs - MAX_CORRECTION_AGE_MS)) return "Corrections can only go back 31 days. Ask HR for older ones.";

  const from = Math.min(...times) - DAY_MS;
  const to = Math.max(...times) + DAY_MS;
  const existing = ((await (lock ?? db).execute(sql`
    select id, type, (extract(epoch from occurred_at) * 1000)::float8 as at, (extract(epoch from created_at) * 1000)::float8 as created_ms
    from time.clock_events where employee_id = ${employeeId} and occurred_at between to_timestamp(${from / 1000}) and to_timestamp(${to / 1000})`)) as unknown as {
    id: string; type: Proposed[number]["type"]; at: number; created_ms: number;
  }[]).map((r) => ({ id: r.id, type: r.type, at: Number(r.at), createdAtMs: Number(r.created_ms) }));
  // Anything already inconsistent before the correction is not this request's problem. But the proposed events must fit,
  // and they must not make an event that was fine before stop fitting (for example a clock-in before an open session).
  const baselineInvalid = new Set(replayClock(existing).invalid.map((e) => e.id));
  const withProposed = [...existing, ...proposed.map((p, i) => ({ id: `proposed-${i}`, type: p.type, at: Date.parse(p.at), createdAtMs: Number.MAX_SAFE_INTEGER }))];
  const replay = replayClock(withProposed);
  if (replay.invalid.some((e) => e.id?.startsWith("proposed-") || !baselineInvalid.has(e.id))) return "Those events do not fit with your existing clock events (for example a clock-out with no clock-in).";
  if (replay.sessions.some((s) => (s.endAt ?? nowMs) - s.startAt > MAX_SESSION_MS)) return "That would make a session longer than 16 hours.";
  return null;
}

export async function requestCorrection(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.request_correction", { ownerUserId: actor.id });
    const parsed = correctionRequestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const person = await personForUser(db, actor.id);
    const { events, evidenceIds, kind, reason } = parsed.data;
    const problem = await checkProposal(person.id, events, Date.now());
    if (problem) return fail(problem);
    // Time that was never clocked needs proof: a claim that adds a clock-in must carry at least one screenshot.
    if (events.some((e) => e.type === "clock_in") && evidenceIds.length === 0) {
      return fail("Attach at least one screenshot (for example your browser history) that shows when you started working.");
    }

    const hrIds = await hrUserIds();
    const hrOnly = needsHrDecision(Math.min(...events.map((e) => Date.parse(e.at))), Date.now());
    await db.transaction(async (tx) => {
      const [{ n }] = (await tx.execute(sql`select count(*)::int as n from time.clock_corrections where employee_id = ${person.id} and status = 'pending'`)) as unknown as { n: number }[];
      if (n >= 3) throw new ActionFailure("You already have 3 corrections waiting. Wait for them to be decided.");
      const [row] = await tx
        .insert(clockCorrections)
        .values({ employeeId: person.id, requestedBy: actor.id, reason, kind, proposed: events.map((e) => ({ type: e.type, at: new Date(e.at).toISOString() })) })
        .returning({ id: clockCorrections.id });
      const attached = await verifyEvidence(tx, person.id, evidenceIds, EVIDENCE_MAX_BYTES);
      if (attached.length > 0) await tx.update(correctionEvidence).set({ correctionId: row.id }).where(inArray(correctionEvidence.id, attached));
      const [me] = await tx.select({ first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees).where(eq(employees.id, person.id));
      const chain = await managerChainUserIds(tx, person.id);
      const targets = (hrOnly || chain.length === 0 ? hrIds : chain.slice(0, 1)).filter((id) => id !== actor.id);
      await notify(tx, targets.map((userId) => ({ userId, kind: "attendance.correction_needed", title: `${reportName(me)} asked for a time correction`, body: reason, link: "/attendance?tab=corrections" })));
      await writeAudit({ actor, action: "clock.correction_request", targetType: "employee", targetId: person.id, metadata: { correctionId: row.id, events: events.length, kind, evidence: attached.length } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** A lead (their downline) or HR (anyone) files a correction for someone else. The person is told; HR decides it. */
export async function fileCorrectionForOthers(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const reach = scopeFor(actor, "attendance.file_for_others");
    if (reach !== "all" && reach !== "team") throw new ForbiddenError("attendance.file_for_others");
    const parsed = fileForOthersSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, events, kind, reason } = parsed.data;
    const [target] = await db.select({ id: employees.id, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees).where(and(eq(employees.id, employeeId), isNull(employees.archivedAt)));
    if (!target) return fail("That person was not found.");
    await authorize(actor, "attendance.file_for_others", { ownerUserId: target.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, employeeId) });
    if (target.userId === actor.id) return fail("File your own corrections from My time.");
    const problem = await checkProposal(employeeId, events, Date.now());
    if (problem) return fail(problem);

    const hrIds = await hrUserIds();
    await db.transaction(async (tx) => {
      const [{ n }] = (await tx.execute(sql`select count(*)::int as n from time.clock_corrections where employee_id = ${employeeId} and status = 'pending'`)) as unknown as { n: number }[];
      if (n >= 3) throw new ActionFailure("They already have 3 corrections waiting.");
      const [row] = await tx
        .insert(clockCorrections)
        .values({ employeeId, requestedBy: actor.id, reason, kind, proposed: events.map((e) => ({ type: e.type, at: new Date(e.at).toISOString() })) })
        .returning({ id: clockCorrections.id });
      if (target.userId) await notify(tx, { userId: target.userId, kind: "attendance.correction_filed_for_you", title: "A time correction was filed for you", body: reason, link: "/attendance" });
      const reviewers = hrIds.filter((id) => id !== actor.id && id !== target.userId);
      await notify(tx, reviewers.map((userId) => ({ userId, kind: "attendance.correction_needed", title: `A time correction was filed for ${reportName(target)}`, body: reason, link: "/attendance?tab=corrections" })));
      await writeAudit({ actor, action: "clock.correction_filed_for", targetType: "employee", targetId: employeeId, metadata: { correctionId: row.id, events: events.length, kind } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** A one-time link to upload one screenshot (JPG or PNG) for a time claim. The server picks the path. */
export async function requestEvidenceUpload(input: unknown): Promise<ActionResult<{ id: string; path: string; token: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.request_correction", { ownerUserId: actor.id });
    const parsed = evidenceUploadSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const person = await personForUser(db, actor.id);
    if (!(await allowRequest("upload", actor.id))) return fail("Too many uploads. Wait a few minutes and try again.");
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from time.correction_evidence where employee_id = ${person.id} and correction_id is null and purged_at is null`)) as unknown as { n: number }[];
    if (n >= 6) return fail("You have unused screenshots waiting. Send your request first, or try again tomorrow.");
    const path = evidencePath(person.id, parsed.data.mime);
    const { token } = await getDocumentStorage().createSignedUpload(BUCKETS.employee, path);
    const [row] = await db.insert(correctionEvidence).values({ employeeId: person.id, storagePath: path, mime: parsed.data.mime }).returning({ id: correctionEvidence.id });
    return { ok: true, data: { id: row.id, path, token } };
  });
}

/** A 60-second link to one screenshot, for the person who sent it, their chain of leads, and HR. Every open is audited. */
export async function openEvidence(input: unknown): Promise<ActionResult<{ url: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = evidenceIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    if (!(await allowRequest("download", actor.id))) return fail("Too many downloads. Wait a few minutes and try again.");
    const [ev] = await db.select().from(correctionEvidence).where(eq(correctionEvidence.id, parsed.data.evidenceId)).limit(1);
    if (!ev || !ev.correctionId || ev.purgedAt) return fail("That screenshot is no longer available.");
    const [person] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, ev.employeeId));
    if (person?.userId === actor.id) await authorize(actor, "attendance.request_correction", { ownerUserId: actor.id });
    else await authorize(actor, "attendance.approve_correction", { ownerUserId: person?.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, ev.employeeId) });
    const url = await getDocumentStorage().createSignedDownload(BUCKETS.employee, ev.storagePath, 60, `evidence.${ev.mime === "image/png" ? "png" : "jpg"}`);
    await writeAudit({ actor, action: "clock.evidence_view", targetType: "employee", targetId: ev.employeeId, metadata: { evidenceId: ev.id, correctionId: ev.correctionId } });
    return { ok: true, data: { url } };
  });
}

export async function cancelCorrection(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.request_correction", { ownerUserId: actor.id });
    const parsed = correctionIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const person = await personForUser(db, actor.id);
    const done = await db
      .update(clockCorrections)
      .set({ status: "cancelled", decidedAt: new Date() })
      .where(and(eq(clockCorrections.id, parsed.data.correctionId), eq(clockCorrections.employeeId, person.id), eq(clockCorrections.status, "pending")))
      .returning({ id: clockCorrections.id });
    if (done.length === 0) return fail("That request is no longer pending.");
    refresh();
    return { ok: true, data: undefined };
  });
}

/**
 * The person's lead (or HR) approves or rejects a correction. Approval writes NEW clock events marked as corrections;
 * nothing existing is changed. Nobody decides their own.
 */
export async function decideCorrection(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = decideCorrectionSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { correctionId, decision, note, events } = parsed.data;
    if (decision === "reject" && !note) return fail("Give a short reason so the person knows why.");
    if (events && decision !== "approve") return fail("Times can only be changed when approving.");

    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(clockCorrections).where(eq(clockCorrections.id, correctionId)).for("update");
      if (!c) throw new ActionFailure("That request was not found.");
      if (c.status !== "pending") throw new ActionFailure("That request was already handled.");
      const [person] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, c.employeeId));
      if (person.userId === actor.id || c.requestedBy === actor.id) throw new ActionFailure("Someone else must decide on your own request.");
      await authorize(actor, "attendance.approve_correction", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await managerChainUserIds(tx, c.employeeId) });
      // Something filed by a lead or HR for the person, or older than a week when it was filed, is decided by HR only.
      const original = c.proposed as Proposed;
      const hrOnly = c.requestedBy !== person.userId || needsHrDecision(Math.min(...original.map((p) => Date.parse(p.at))), c.createdAt.getTime());
      if (hrOnly && scopeFor(actor, "attendance.approve_correction") !== "all") throw new ActionFailure("Only HR can decide this request.");

      const adjusted = events ? (events.map((e) => ({ type: e.type, at: new Date(e.at).toISOString() })) as Proposed) : null;
      const changed = adjusted !== null && JSON.stringify(adjusted) !== JSON.stringify(original);
      const proposed = adjusted ?? original;

      if (decision === "approve") {
        await lockEmployeeClock(tx, c.employeeId);
        const problem = await checkProposal(c.employeeId, proposed, Date.now(), tx);
        if (problem) throw new ActionFailure(`It cannot be applied now: ${problem}`);
        await tx.insert(clockEvents).values(
          proposed.map((p) => ({
            employeeId: c.employeeId,
            type: p.type,
            occurredAt: new Date(p.at),
            source: "admin_correction",
            correctionId: c.id,
            correctionReason: c.reason,
            createdBy: actor.id,
          })),
        );
      }
      await tx
        .update(clockCorrections)
        .set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: actor.id, decidedAt: new Date(), decisionNote: note ?? null, ...(changed && decision === "approve" ? { proposed, originalProposed: original } : {}) })
        .where(eq(clockCorrections.id, c.id));
      if (person.userId) {
        await notify(tx, { userId: person.userId, kind: `attendance.correction_${decision === "approve" ? "approved" : "rejected"}`, title: decision === "approve" ? (changed ? "Your time correction was approved with changes" : "Your time correction was approved") : "Your time correction was rejected", body: changed ? `The times were adjusted by your reviewer.${note ? ` ${note}` : ""}` : note, link: "/attendance" });
      }
      await writeAudit({ actor, action: `clock.correction_${decision}`, targetType: "employee", targetId: c.employeeId, before: null, after: { correctionId: c.id, proposed, reason: c.reason }, metadata: { note: note ?? null, adjusted: changed } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

// --- Team rules ----------------------------------------------------------------------------------

export async function saveClockRules(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.manage_rules");
    const parsed = rulesSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.selfieRequired && !(await monitoringPolicyPublished(db))) return fail("Publish the monitoring policy before requiring selfies.");
    if (v.jibbleMirror && !(await monitoringPolicyPublished(db))) return fail("Publish the monitoring policy before turning on Jibble screenshots.");

    await db.transaction(async (tx) => {
      const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, v.teamId)).limit(1);
      if (!team) throw new ActionFailure("That team was not found.");
      const [before] = await tx.select().from(clockRules).where(eq(clockRules.teamId, v.teamId)).limit(1);
      const values = { allowedCidrs: [...new Set(v.allowedCidrs)], selfieRequired: v.selfieRequired, idleMinutes: v.idleMinutes ?? null, graceMinutes: v.graceMinutes, eodExpected: v.eodExpected, jibbleMirror: v.jibbleMirror, updatedBy: actor.id, updatedAt: new Date() };
      await tx.insert(clockRules).values({ teamId: v.teamId, ...values }).onConflictDoUpdate({ target: clockRules.teamId, set: values });
      await writeAudit({ actor, action: "clock.rules", targetType: "team", targetId: v.teamId, before: before ? { allowedCidrs: before.allowedCidrs, selfieRequired: before.selfieRequired, idleMinutes: before.idleMinutes } : null, after: { allowedCidrs: values.allowedCidrs, selfieRequired: values.selfieRequired, idleMinutes: values.idleMinutes, eodExpected: values.eodExpected, jibbleMirror: values.jibbleMirror } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

// --- Presence and end-of-day notes ---------------------------------------------------------------

/**
 * A clocked-in page says "still here" (the database clock). Returns when the previous report was, so the page can
 * show "welcome back" after a long gap (device restart, sleep, lost connection). It never clocks anyone out.
 */
export async function pingPresence(): Promise<ActionResult<{ working: boolean; previousSeenMs: number | null; serverNowMs: number }>> {
  const actor = await requireUser();
  return runAction<{ working: boolean; previousSeenMs: number | null; serverNowMs: number }>(async () => {
    await authorize(actor, "attendance.clock", { ownerUserId: actor.id });
    const person = await personForUser(db, actor.id);
    if (!(await allowRequest("presence", person.id))) return fail("Too many requests.");
    const replay = replayClock(await loadRecentEvents(db, person.id, 20));
    if (replay.state === "out") return { ok: true, data: { working: false, previousSeenMs: null, serverNowMs: Date.now() } };
    const [row] = (await db.execute(sql`
      with prev as (select last_seen_at from time.clock_presence where employee_id = ${person.id}),
      up as (
        insert into time.clock_presence (employee_id, last_seen_at) values (${person.id}, clock_timestamp())
        on conflict (employee_id) do update set last_seen_at = clock_timestamp() returning 1 as ok
      )
      select (select (extract(epoch from last_seen_at) * 1000)::float8 from prev) as prev_ms, (extract(epoch from clock_timestamp()) * 1000)::float8 as now_ms from up`)) as unknown as { prev_ms: number | null; now_ms: number }[];
    return { ok: true, data: { working: true, previousSeenMs: row.prev_ms === null ? null : Number(row.prev_ms), serverNowMs: Number(row.now_ms) } };
  });
}

/** Writes or edits the end-of-day note of one finished session. The author has 24 hours after clocking out. */
export async function saveShiftNote(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.notes", { ownerUserId: actor.id });
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const person = await personForUser(db, actor.id);
    await db.transaction(async (tx) => {
      await lockEmployeeClock(tx, person.id);
      const session = replayClock(await loadRecentEvents(tx, person.id, 120)).sessions.find((s) => s.startEventId === parsed.data.sessionId);
      if (!session) throw new ActionFailure("That session was not found.");
      if (session.endAt === null) throw new ActionFailure("Clock out first, then write your end-of-day note.");
      if (Date.now() - session.endAt > EOD_EDIT_WINDOW_MS) throw new ActionFailure("The 24 hours for this note are over. Ask HR if it must change.");
      const [existing] = await tx.select({ id: shiftNotes.id }).from(shiftNotes).where(eq(shiftNotes.sessionEventId, parsed.data.sessionId)).limit(1);
      if (existing) await tx.update(shiftNotes).set({ body: parsed.data.body, edited: true, updatedAt: new Date() }).where(eq(shiftNotes.id, existing.id));
      else await tx.insert(shiftNotes).values({ employeeId: person.id, sessionEventId: parsed.data.sessionId, body: parsed.data.body });
      await writeAudit({ actor, action: existing ? "clock.note_edit" : "clock.note", targetType: "employee", targetId: person.id, metadata: { sessionId: parsed.data.sessionId, length: parsed.data.body.length } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
