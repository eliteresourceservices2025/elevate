"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
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
import { replayClock } from "./clock";
import { clockCorrections, clockEvents, clockPrefs, clockRules, idlePrompts } from "./schema";
import { lockEmployeeClock, monitoringPolicyPublished, performClock, personForUser, rulesFor, selfiePath, type ClockResult } from "./service";
import {
  clockSchema,
  correctionIdSchema,
  correctionRequestSchema,
  decideCorrectionSchema,
  idleAnswerSchema,
  idleReportSchema,
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
export async function startBreak(): Promise<ActionResult<ClockResult>> {
  await requireUser();
  return clock("break_start", {});
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
    const problem = await checkProposal(person.id, parsed.data.events, Date.now());
    if (problem) return fail(problem);

    const hrIds = await hrUserIds();
    await db.transaction(async (tx) => {
      const [{ n }] = (await tx.execute(sql`select count(*)::int as n from time.clock_corrections where employee_id = ${person.id} and status = 'pending'`)) as unknown as { n: number }[];
      if (n >= 3) throw new ActionFailure("You already have 3 corrections waiting. Wait for them to be decided.");
      const [row] = await tx
        .insert(clockCorrections)
        .values({ employeeId: person.id, requestedBy: actor.id, reason: parsed.data.reason, proposed: parsed.data.events.map((e) => ({ type: e.type, at: new Date(e.at).toISOString() })) })
        .returning({ id: clockCorrections.id });
      const [me] = await tx.select({ first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees).where(eq(employees.id, person.id));
      const chain = await managerChainUserIds(tx, person.id);
      const targets = (chain.length > 0 ? chain.slice(0, 1) : hrIds).filter((id) => id !== actor.id);
      await notify(tx, targets.map((userId) => ({ userId, kind: "attendance.correction_needed", title: `${reportName(me)} asked for a time correction`, body: parsed.data.reason, link: "/attendance?tab=corrections" })));
      await writeAudit({ actor, action: "clock.correction_request", targetType: "employee", targetId: person.id, metadata: { correctionId: row.id, events: parsed.data.events.length } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
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
    const { correctionId, decision, note } = parsed.data;
    if (decision === "reject" && !note) return fail("Give a short reason so the person knows why.");

    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(clockCorrections).where(eq(clockCorrections.id, correctionId)).for("update");
      if (!c) throw new ActionFailure("That request was not found.");
      if (c.status !== "pending") throw new ActionFailure("That request was already handled.");
      const [person] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, c.employeeId));
      if (person.userId === actor.id || c.requestedBy === actor.id) throw new ActionFailure("Someone else must decide on your own request.");
      await authorize(actor, "attendance.approve_correction", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await managerChainUserIds(tx, c.employeeId) });

      if (decision === "approve") {
        await lockEmployeeClock(tx, c.employeeId);
        const problem = await checkProposal(c.employeeId, c.proposed as Proposed, Date.now(), tx);
        if (problem) throw new ActionFailure(`It cannot be applied now: ${problem}`);
        await tx.insert(clockEvents).values(
          (c.proposed as Proposed).map((p) => ({
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
        .set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: actor.id, decidedAt: new Date(), decisionNote: note ?? null })
        .where(eq(clockCorrections.id, c.id));
      if (person.userId) {
        await notify(tx, { userId: person.userId, kind: `attendance.correction_${decision === "approve" ? "approved" : "rejected"}`, title: decision === "approve" ? "Your time correction was approved" : "Your time correction was rejected", body: note, link: "/attendance" });
      }
      await writeAudit({ actor, action: `clock.correction_${decision}`, targetType: "employee", targetId: c.employeeId, before: null, after: { correctionId: c.id, proposed: c.proposed, reason: c.reason }, metadata: { note: note ?? null } }, tx);
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

    await db.transaction(async (tx) => {
      const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, v.teamId)).limit(1);
      if (!team) throw new ActionFailure("That team was not found.");
      const [before] = await tx.select().from(clockRules).where(eq(clockRules.teamId, v.teamId)).limit(1);
      const values = { allowedCidrs: [...new Set(v.allowedCidrs)], selfieRequired: v.selfieRequired, idleMinutes: v.idleMinutes ?? null, graceMinutes: v.graceMinutes, updatedBy: actor.id, updatedAt: new Date() };
      await tx.insert(clockRules).values({ teamId: v.teamId, ...values }).onConflictDoUpdate({ target: clockRules.teamId, set: values });
      await writeAudit({ actor, action: "clock.rules", targetType: "team", targetId: v.teamId, before: before ? { allowedCidrs: before.allowedCidrs, selfieRequired: before.selfieRequired, idleMinutes: before.idleMinutes } : null, after: { allowedCidrs: values.allowedCidrs, selfieRequired: values.selfieRequired, idleMinutes: values.idleMinutes } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
