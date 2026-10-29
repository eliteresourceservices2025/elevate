"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { employees } from "@/modules/people/schema";
import { loadRecentEvents, lockEmployeeClock } from "@/modules/attendance/service";
import { replayClock } from "@/modules/attendance/clock";
import { breakMode, getJibbleClient, sendsAllowed } from "./client";
import { JibbleError } from "./http-client";
import { maySendNow, processMirrorQueue, runJibbleRepair, syncJibblePeople, type PeopleSync } from "./jobs";
import { jibbleCallReviews, jibbleLinkLog, jibbleOperationGuard, jibblePeople, jibbleSettings } from "./schema";
import { looksLikePersonId, resolveJibbleAccount } from "./match-rules";
import type { JibblePerson } from "./http-client";
import { mismatchReviewSchema, operationRecoverySchema, pauseSchema, retrySchema, setPersonSchema } from "./validators";
import { claimJibbleOperation, finishJibbleOperation } from "./operation-guard";
import { decideMismatch } from "./mismatch-policy";
import { checkWorkingMismatch } from "./working-mismatch-check";

const NOT_SET_UP = "Jibble is not set up yet. Add the access token on the server first.";
const BAD = "Check the request and try again.";
const refresh = () => { revalidatePath("/attendance"); revalidatePath("/jibble"); };

const friendly = (e: unknown) =>
  e instanceof JibbleError ? (e.status === 401 ? "Jibble rejected the access token. It may have expired." : e.status === 403 ? "Jibble says this token is not allowed to do that." : `Jibble did not answer properly (${e.message}).`) : "Could not reach Jibble.";

/** Preserve the failed call and mark it reviewed only when fresh states are known to align. */
export async function reviewFailedJibbleCall(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    if (process.env.JIBBLE_COORDINATION_ENABLED !== "true") return fail("Review is not available yet.");
    const parsed = retrySchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const [call] = (await db.execute(sql`select employee_id from time.jibble_link_log where id = ${parsed.data.logId}::uuid and status = 'failed'`)) as unknown as { employee_id: string }[];
    if (!call) return fail("That failed call was not found.");
    const client = getJibbleClient();
    if (!client) return fail(NOT_SET_UP);
    const token = await claimJibbleOperation(call.employee_id, { kind: "reconcile", logId: parsed.data.logId });
    if (!token) return fail("Another operation is in progress or needs investigation. No review was recorded.");
    try {
      const [mapping] = await db.select({ id: jibblePeople.jibblePersonId }).from(jibblePeople).where(eq(jibblePeople.employeeId, call.employee_id));
      if (!mapping) return fail("This person has no Jibble match.");
      if (!sendsAllowed(mapping.id)) return fail("This person is not enabled for testing in this environment.");
      if (!(await maySendNow(call.employee_id, mapping.id))) return fail("Monitoring is not enabled for this person. No Jibble status was read.");
      const events = await loadRecentEvents(db, call.employee_id, 120);
      const lastId = events.at(-1)?.id ?? null;
      let state;
      try { state = await client.latestState(mapping.id); } catch { return fail("Jibble status is unavailable. No review was recorded."); }
      if (state === null) return fail("Jibble status is unknown. No review was recorded.");
      if (!(await maySendNow(call.employee_id, mapping.id))) return fail("Monitoring permission changed. No review was recorded.");
      await db.transaction(async (tx) => {
        await lockEmployeeClock(tx, call.employee_id);
        const [current] = (await tx.execute(sql`select p.jibble_person_id from time.jibble_people p where p.employee_id = ${call.employee_id}::uuid for update`)) as unknown as { jibble_person_id: string }[];
        const recent = await loadRecentEvents(tx, call.employee_id, 120);
        const [queued] = (await tx.execute(sql`select 1 as present from time.jibble_link_log where employee_id = ${call.employee_id}::uuid and status = 'queued' limit 1`)) as unknown as { present: number }[];
        if (!current || current.jibble_person_id !== mapping.id || (recent.at(-1)?.id ?? null) !== lastId || queued) throw new ActionFailure("The person's status changed or a call is waiting. Check again.");
        if (decideMismatch({ elevate: replayClock(recent).state, jibble: state, breakMode: breakMode(), outCause: "unknown" }) !== "aligned") throw new ActionFailure("The current statuses do not match. Investigate before marking this reviewed.");
        const [failed] = (await tx.execute(sql`select id from time.jibble_link_log where id = ${parsed.data.logId}::uuid and status = 'failed' for update`)) as unknown as { id: string }[];
        if (!failed) throw new ActionFailure("That call is no longer failed.");
        const [review] = await tx.insert(jibbleCallReviews).values({ logId: failed.id, reviewedBy: actor.id }).onConflictDoNothing().returning({ logId: jibbleCallReviews.logId });
        if (!review) throw new ActionFailure("This call was already reviewed.");
        await writeAudit({ actor, action: "jibble.failure_reviewed", targetType: "employee", targetId: call.employee_id, metadata: { logId: failed.id } }, tx);
      });
      refresh();
      return { ok: true, data: undefined };
    } finally { await finishJibbleOperation(call.employee_id, token); }
  });
}

/** Resolve an open mismatch only after both systems are freshly observed in an aligned state. */
export async function reviewJibbleMismatch(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    if (process.env.JIBBLE_COORDINATION_ENABLED !== "true") return fail("Review is not available yet.");
    const parsed = mismatchReviewSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const [issue] = (await db.execute(sql`select employee_id, kind from time.jibble_mismatches where id = ${parsed.data.mismatchId}::uuid and resolved_at is null`)) as unknown as { employee_id: string; kind: string }[];
    if (!issue) return fail("That open mismatch was not found.");
    if (issue.kind === "possible_jibble_only" && (parsed.data.note?.length ?? 0) < 10) return fail("Review the Jibble entry and any time correction, then describe your findings in at least 10 characters.");
    const client = getJibbleClient();
    if (!client) return fail(NOT_SET_UP);
    const token = await claimJibbleOperation(issue.employee_id, { kind: "reconcile" });
    if (!token) return fail("Another operation is in progress or needs investigation. No review was recorded.");
    try {
      const [mapping] = await db.select({ id: jibblePeople.jibblePersonId }).from(jibblePeople).where(eq(jibblePeople.employeeId, issue.employee_id));
      if (!mapping || !sendsAllowed(mapping.id)) return fail("Jibble status is not available for this person in this environment.");
      if (!(await maySendNow(issue.employee_id, mapping.id))) return fail("Monitoring is not enabled for this person. No Jibble status was read.");
      const events = await loadRecentEvents(db, issue.employee_id, 120);
      const lastId = events.at(-1)?.id ?? null;
      let state;
      try { state = await client.latestState(mapping.id); } catch { return fail("Jibble status is unavailable. No review was recorded."); }
      if (state === null) return fail("Jibble status is unknown. No review was recorded.");
      if (!(await maySendNow(issue.employee_id, mapping.id))) return fail("Monitoring permission changed. No review was recorded.");
      await db.transaction(async (tx) => {
        await lockEmployeeClock(tx, issue.employee_id);
        const [mappingNow] = (await tx.execute(sql`select jibble_person_id from time.jibble_people where employee_id = ${issue.employee_id}::uuid for update`)) as unknown as { jibble_person_id: string }[];
        const recent = await loadRecentEvents(tx, issue.employee_id, 120);
        const [queued] = (await tx.execute(sql`select 1 as present from time.jibble_link_log where employee_id = ${issue.employee_id}::uuid and status = 'queued' limit 1`)) as unknown as { present: number }[];
        if (!mappingNow || mappingNow.jibble_person_id !== mapping.id || (recent.at(-1)?.id ?? null) !== lastId || queued) throw new ActionFailure("The person's status changed or a call is waiting. Check again.");
        if (decideMismatch({ elevate: replayClock(recent).state, jibble: state, breakMode: breakMode(), outCause: "unknown" }) !== "aligned") throw new ActionFailure("The current statuses do not match. Investigate before marking this reviewed.");
        if (issue.kind === "possible_jibble_only") {
          const [pending] = (await tx.execute(sql`select 1 from time.clock_corrections where employee_id = ${issue.employee_id}::uuid and status = 'pending' limit 1`)) as unknown as { "?column?": number }[];
          if (pending) throw new ActionFailure("A time correction is still pending. Review it before resolving this issue.");
        }
        const resolution = issue.kind === "possible_jibble_only" ? `reviewed: ${parsed.data.note}` : "reviewed: statuses aligned";
        const resolved = (await tx.execute(sql`update time.jibble_mismatches set resolved_at = now(), resolved_by = ${actor.id}::uuid, resolution = ${resolution}
          where id = ${parsed.data.mismatchId}::uuid and kind = ${issue.kind} and resolved_at is null returning id`)) as unknown as { id: string }[];
        if (!resolved.length) throw new ActionFailure("That mismatch was already resolved.");
        await writeAudit({ actor, action: "jibble.mismatch_reviewed", targetType: "employee", targetId: issue.employee_id, metadata: { mismatchId: parsed.data.mismatchId, ...(issue.kind === "possible_jibble_only" ? { note: parsed.data.note } : {}) } }, tx);
      });
      refresh();
      return { ok: true, data: undefined };
    } finally { await finishJibbleOperation(issue.employee_id, token); }
  });
}

/** Confirm a completed request by its pre-recorded ID. Absence, active requests and unsupported break calls remain blocked. */
export async function confirmUncertainJibbleOperation(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    if (process.env.JIBBLE_COORDINATION_ENABLED !== "true") return fail("Recovery is not available yet.");
    const parsed = operationRecoverySchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const [guard] = await db.select().from(jibbleOperationGuard).where(eq(jibbleOperationGuard.employeeId, parsed.data.employeeId));
    if (!guard || guard.phase !== "uncertain" || !guard.requestId || !guard.logId || !guard.jibblePersonId || !["In", "Out"].includes(guard.action ?? "")) return fail("This operation cannot be confirmed automatically. Keep it blocked and investigate.");
    const client = getJibbleClient();
    if (!client?.entryEvidence || !sendsAllowed(guard.jibblePersonId) || !(await maySendNow(guard.employeeId, guard.jibblePersonId))) return fail("Jibble verification is unavailable or monitoring is not enabled. The operation remains blocked.");
    let evidence;
    try { evidence = await client.entryEvidence(guard.jibblePersonId, guard.requestId); } catch { return fail("Jibble verification is unavailable. The operation remains blocked."); }
    const expected = guard.action === "In" ? "in" : "out";
    if (!evidence || evidence.id !== guard.requestId || evidence.personId !== guard.jibblePersonId || evidence.state !== expected || !evidence.elevateOrigin || evidence.clientType !== "Web" || evidence.createdAt !== evidence.updatedAt || Date.parse(evidence.createdAt) < guard.createdAt.getTime() - 60_000 || Date.parse(evidence.createdAt) > Date.now() + 60_000) return fail("The exact unmodified request could not be confirmed. The operation remains blocked.");
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(jibbleOperationGuard).where(eq(jibbleOperationGuard.employeeId, guard.employeeId)).for("update");
      if (!current || current.phase !== "uncertain" || current.token !== guard.token || current.requestId !== guard.requestId || current.logId !== guard.logId || current.action !== guard.action || current.jibblePersonId !== guard.jibblePersonId) throw new ActionFailure("The operation changed. Check it again.");
      const [log] = (await tx.execute(sql`select id, action, status, jibble_entry_id from time.jibble_link_log where id = ${guard.logId}::uuid and employee_id = ${guard.employeeId}::uuid for update`)) as unknown as { id: string; action: string; status: string; jibble_entry_id: string | null }[];
      const fallback = (log?.action === "StartBreak" && guard.action === "Out") || (log?.action === "EndBreak" && guard.action === "In");
      if (!log || !["queued", "sent"].includes(log.status) || (log.action !== guard.action && !fallback) || (log.jibble_entry_id && log.jibble_entry_id !== guard.requestId)) throw new ActionFailure("The call record changed. Keep the operation blocked and investigate.");
      await tx.update(jibbleLinkLog).set({ status: "sent", attempts: sql`greatest(${jibbleLinkLog.attempts}, 1)`, sentAt: new Date(), jibbleEntryId: guard.requestId, fallback, lastError: "confirmed by exact Jibble entry; check current status" }).where(eq(jibbleLinkLog.id, log.id));
      await tx.delete(jibbleOperationGuard).where(eq(jibbleOperationGuard.employeeId, guard.employeeId));
      await writeAudit({ actor, action: "jibble.operation_confirmed", targetType: "employee", targetId: guard.employeeId, metadata: { logId: log.id, requestId: guard.requestId } }, tx);
    });
    try {
      // Only current, guarded queue handling runs here; old calls remain held and no failed historical call is replayed.
      await processMirrorQueue(new Date(), client, { employeeId: guard.employeeId });
      await checkWorkingMismatch(guard.employeeId, client);
    } catch (error) {
      console.error("jibble recovery follow-up failed:", error instanceof Error ? error.name : "unknown error");
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Checks the token works by reading the people list. Reads names only to count them. */
export async function testJibbleConnection(): Promise<ActionResult<{ people: number; breaks: number | null }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const client = getJibbleClient();
    if (!client) return fail(NOT_SET_UP);
    try {
      const people = await client.listPeople();
      // Native breaks come from each person's schedule in Jibble; check the first person as a sample. Failing to read them is not a failed connection.
      const breaks = people.length === 0 ? null : await client.listBreaks(people[0].id).then((b) => b.length, () => null);
      await writeAudit({ actor, action: "jibble.test", targetType: "integration", metadata: { people: people.length, breaks } });
      return { ok: true, data: { people: people.length, breaks } };
    } catch (error) {
      return fail(friendly(error));
    }
  });
}

/** Matches people to Jibble accounts by work email now. Hand-made matches stay. */
export async function syncJibblePeopleNow(): Promise<ActionResult<PeopleSync>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const client = getJibbleClient();
    if (!client) return fail(NOT_SET_UP);
    try {
      const result = await syncJibblePeople(client);
      await writeAudit({ actor, action: "jibble.sync", targetType: "integration", metadata: result });
      refresh();
      return { ok: true, data: result };
    } catch (error) {
      return fail(friendly(error));
    }
  });
}

/** Sets or removes a hand-made match between a person and their Jibble account. */
export async function setJibblePerson(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = setPersonSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? BAD);
    const { employeeId, jibblePersonId: typed } = parsed.data;
    // What was typed is an email, a member code or an id. The server finds the Jibble account itself and stores the id it found.
    let jibblePersonId: string | null = null;
    if (typed !== null) {
      let people: JibblePerson[] = [];
      if (!looksLikePersonId(typed)) {
        const client = getJibbleClient();
        if (!client) return fail(NOT_SET_UP);
        try {
          people = await client.listPeople();
        } catch (error) {
          return fail(friendly(error));
        }
      }
      const found = resolveJibbleAccount(typed, people);
      if (found.kind === "none") return fail("No Jibble account has that email or member code. Check it exactly as it is in Jibble.");
      if (found.kind === "many") return fail("More than one Jibble account has that. Paste the Jibble person id instead.");
      jibblePersonId = found.kind === "id" ? found.id : found.person.id;
    }
    const guardedMapping = process.env.JIBBLE_COORDINATION_ENABLED === "true";
    const mappingToken = guardedMapping ? await claimJibbleOperation(employeeId, { kind: "reconcile" }) : null;
    if (guardedMapping && !mappingToken) return fail("This person has an operation in progress or needing review. Their Jibble match was not changed.");
    try {
    await db.transaction(async (tx) => {
      const [person] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!person) throw new ActionFailure("That person was not found.");
      if (jibblePersonId === null) {
        await tx.delete(jibblePeople).where(eq(jibblePeople.employeeId, employeeId));
      } else {
        const holders = (await tx.execute(sql`
          select p.employee_id as id, (e.archived_at is not null or e.status = 'separated') as stale
          from time.jibble_people p join core.employees e on e.id = p.employee_id
          where p.jibble_person_id = ${jibblePersonId} and p.employee_id <> ${employeeId}`)) as unknown as { id: string; stale: boolean }[];
        if (holders.some((h) => !h.stale)) throw new ActionFailure("That Jibble account is already matched to someone else.");
        if (guardedMapping && holders.length) throw new ActionFailure("Remove the former person's Jibble match first, then try again.");
        // An archived or departed record's old link is dropped, so the account can move to the current record.
        for (const h of holders) await tx.delete(jibblePeople).where(eq(jibblePeople.employeeId, h.id));
        await tx
          .insert(jibblePeople)
          .values({ employeeId, jibblePersonId, matchedBy: "manual" })
          .onConflictDoUpdate({ target: jibblePeople.employeeId, set: { jibblePersonId, matchedBy: "manual", matchedAt: new Date() } });
      }
      await writeAudit({ actor, action: "jibble.map", targetType: "employee", targetId: employeeId, after: { matched: jibblePersonId !== null } }, tx);
    });
    } finally {
      if (mappingToken) await finishJibbleOperation(employeeId, mappingToken);
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Puts a failed call back in the queue and sends the queue now. */
export async function retryJibbleSend(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = retrySchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    let reservation: { employeeId: string; token: string } | null = null;
    if (process.env.JIBBLE_COORDINATION_ENABLED === "true") {
      const [candidate] = (await db.execute(sql`select employee_id from time.jibble_link_log where id = ${parsed.data.logId}::uuid`)) as unknown as { employee_id: string }[];
      if (!candidate) return fail("That call was not found.");
      const token = await claimJibbleOperation(candidate.employee_id, { kind: "reconcile", logId: parsed.data.logId });
      if (!token) return fail("This person has another operation in progress or needing review. No retry was requested.");
      reservation = { employeeId: candidate.employee_id, token };
    }
    try {
    // Never replay an old or superseded action against a person's current session.
    const done = (await db.execute(sql`update time.jibble_link_log l
      set status = 'queued', attempts = greatest(l.attempts, 1), next_attempt_at = now(), last_error = null
      where l.id = ${parsed.data.logId}::uuid and l.status = 'failed' and l.source = 'event'
        and l.created_at >= now() - interval '10 minutes'
        and not exists (select 1 from time.jibble_link_log later where later.employee_id = l.employee_id and later.id <> l.id and later.created_at >= l.created_at)
      returning l.id, l.employee_id`)) as unknown as { id: string; employee_id: string }[];
    if (done.length === 0) return fail("This call cannot be retried. Check the person's current status in ELEVATE and Jibble.");
    await writeAudit({ actor, action: "jibble.retry", targetType: "integration", metadata: { logId: parsed.data.logId } });
    if (reservation) {
      await finishJibbleOperation(reservation.employeeId, reservation.token);
      reservation = null;
    }
    await processMirrorQueue(new Date(), undefined, { employeeId: done[0].employee_id });
    refresh();
    const [result] = await db.select({ status: jibbleLinkLog.status }).from(jibbleLinkLog).where(eq(jibbleLinkLog.id, parsed.data.logId));
    if (result?.status !== "sent") return fail(result?.status === "queued" ? "The call is waiting. Check its status again shortly." : "Jibble did not accept the call. Check the person's current status.");
    return { ok: true, data: undefined };
    } finally {
      if (reservation) await finishJibbleOperation(reservation.employeeId, reservation.token);
    }
  });
}

/**
 * HR's pause switch for everything sent to Jibble. While paused, clock calls wait in the queue and nothing is sent. When resumed, calls
 * that waited more than 10 minutes are dropped (replaying a long backlog would put Jibble in a wrong state), and the repair job puts
 * everyone's Jibble state right from ELEVATE's. The ELEVATE clock is never affected.
 */
export async function setJibblePaused(input: unknown): Promise<ActionResult<{ dropped: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = pauseSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    let dropped = 0;
    await db.transaction(async (tx) => {
      await tx
        .insert(jibbleSettings)
        .values({ id: 1, paused: parsed.data.paused, pausedBy: actor.id, pausedAt: new Date() })
        .onConflictDoUpdate({ target: jibbleSettings.id, set: { paused: parsed.data.paused, pausedBy: actor.id, pausedAt: new Date() } });
      if (!parsed.data.paused && process.env.JIBBLE_COORDINATION_ENABLED !== "true") {
        const old = (await tx.execute(sql`update time.jibble_link_log l set status = 'skipped', last_error = 'dropped: waited too long while paused'
          where l.status = 'queued' and l.created_at < now() - interval '10 minutes'
          returning 1`)) as unknown as unknown[];
        dropped = old.length;
      }
      await writeAudit({ actor, action: parsed.data.paused ? "jibble.pause" : "jibble.resume", targetType: "integration", metadata: { dropped } }, tx);
    });
    if (!parsed.data.paused) {
      await processMirrorQueue();
      await runJibbleRepair();
    }
    refresh();
    return { ok: true, data: { dropped } };
  });
}
