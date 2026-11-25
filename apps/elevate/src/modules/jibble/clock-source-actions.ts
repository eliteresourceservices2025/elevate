"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { replayClock } from "@/modules/attendance/clock";
import { clockSourceOf } from "@/modules/attendance/clock-source";
import { rebuildAfterChange } from "@/modules/attendance/edit-service";
import { clockCorrections, clockEvents, clockSource } from "@/modules/attendance/schema";
import { MAX_EDIT_AGE_MS, checkProposal, loadRecentEvents, lockEmployeeClock } from "@/modules/attendance/service";
import { notify } from "@/modules/notifications/service";
import { reportName } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { runJibbleImport } from "./import";
import { jibbleClientMap, jibblePeople } from "./schema";
import { bulkJibbleClockSchema, clientMapSchema, clockSourceSchema, closeSessionSchema, importHoursSchema, removeClientMapSchema } from "./validators";

// HR: whose hours come from Jibble, importing them by hand, and which Jibble project or activity means which client.
// Every export here is a public endpoint: it signs the person in and authorizes first.

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;
const refresh = () => revalidatePath("/jibble");

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The one rule for changing where a person's hours come from. "jibble": they must be matched to a Jibble account and not be clocked in
 * right now, so no session is cut in two. Append-only: a change is a new row, audited, and the person is told. Throws ActionFailure with a
 * plain message when it cannot. Returns whether anything changed.
 */
async function applyClockSource(tx: Tx, actor: { id: string; email: string }, employeeId: string, source: "elevate" | "jibble", bulk: number | null): Promise<boolean> {
  const [person] = await tx
    .select({ userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
  if (!person) throw new ActionFailure("That person was not found.");
  await lockEmployeeClock(tx, employeeId);
  const current = await clockSourceOf(tx, employeeId);
  if (current === source) return false;
  if (source === "jibble") {
    const [match] = await tx.select({ id: jibblePeople.jibblePersonId }).from(jibblePeople).where(eq(jibblePeople.employeeId, employeeId));
    if (!match) throw new ActionFailure("Match them to their Jibble account first.");
  }
  if (replayClock(await loadRecentEvents(tx, employeeId)).state !== "out") {
    throw new ActionFailure(
      source === "elevate"
        ? "ELEVATE still shows them clocked in from Jibble. Ask them to clock out in Jibble (closing the app does not stop the timer), or use Close session and switch to end it at the time they really stopped."
        : "They are clocked in right now. Change this after they clock out, so no session is cut in two.",
    );
  }
  await tx.insert(clockSource).values({ employeeId, source, setBy: actor.id });
  await writeAudit({ actor, action: "clock_source.set", targetType: "employee", targetId: employeeId, before: { source: current }, after: { source }, ...(bulk ? { metadata: { bulk } } : {}) }, tx);
  if (person.userId) {
    await notify(tx, {
      userId: person.userId,
      kind: "clock_source.changed",
      title: source === "jibble" ? "Your hours now come from Jibble" : "You clock in ELEVATE again",
      body: source === "jibble" ? "Clock in and out in Jibble. ELEVATE reads your hours from there, so the ELEVATE clock is switched off for you." : "Use the clock in ELEVATE. Your Jibble hours so far stay as they were.",
      link: "/attendance",
    });
  }
  return true;
}

/** Says where one person's hours come from. See applyClockSource for the rules. */
export async function setClockSource(input: unknown): Promise<ActionResult<{ source: "elevate" | "jibble" }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = clockSourceSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, source } = parsed.data;
    await db.transaction((tx) => applyClockSource(tx, actor, employeeId, source, null));
    refresh();
    return { ok: true, data: { source } };
  });
}

/**
 * A person on the Jibble clock whom ELEVATE still shows as clocked in (Jibble left an entry open: the timer was never stopped, or the
 * clock-out was forgotten) cannot be moved back to the ELEVATE clock, and cannot clock out in ELEVATE either. HR and Super Admin end the
 * open session at the time the person really stopped, with a reason, and move them in one step. The close is a normal HR correction: new
 * events (never an edit), audited, shown to the person, and held to the same rules as "change someone's time" (not in the future, not
 * before their last event, a session of 16 hours at most, a year back at most). Nobody does this to themselves.
 */
export async function closeSessionAndUseElevateClock(input: unknown): Promise<ActionResult<{ closed: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    if (scopeFor(actor, "attendance.edit_hours") !== "all") throw new ForbiddenError("attendance.edit_hours");
    const parsed = closeSessionSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, reason } = parsed.data;
    const closeMs = Date.parse(parsed.data.closeAt);
    const closeIso = new Date(closeMs).toISOString();

    let earliest = closeMs;
    let closed = false;
    await db.transaction(async (tx) => {
      const [person] = await tx
        .select({ userId: employees.userId })
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
      if (!person) throw new ActionFailure("That person was not found.");
      if (person.userId === actor.id) throw new ActionFailure("Someone else must change your own time. Ask HR or your lead.");
      await lockEmployeeClock(tx, employeeId);
      if ((await clockSourceOf(tx, employeeId)) !== "jibble") throw new ActionFailure("They already use the ELEVATE clock.");

      const recent = await loadRecentEvents(tx, employeeId);
      const replay = replayClock(recent);
      if (replay.state !== "out") {
        const lastEventAt = Math.max(...recent.map((e) => e.at));
        if (closeMs <= lastEventAt) throw new ActionFailure("Choose a time after their last clock event.");
        // On a break, the break ends and the session ends at the same moment.
        const added = (replay.state === "break" ? ["break_end", "clock_out"] : ["clock_out"]) as ("break_end" | "clock_out")[];
        const proposal = added.map((type) => ({ type, at: closeIso }));
        const problem = await checkProposal(employeeId, proposal, Date.now(), tx, { maxAgeMs: MAX_EDIT_AGE_MS });
        if (problem) throw new ActionFailure(problem);

        const [row] = await tx
          .insert(clockCorrections)
          .values({ employeeId, requestedBy: actor.id, reason, kind: "other", proposed: proposal, voidEventIds: [], status: "approved", decidedBy: actor.id, decidedAt: new Date(), decisionNote: "Session left open in Jibble, closed by HR to move to the ELEVATE clock" })
          .returning({ id: clockCorrections.id });
        // One at a time, so the end of a break is recorded before the clock-out even though both carry the same time.
        for (const e of proposal) {
          await tx.insert(clockEvents).values({ employeeId, type: e.type, occurredAt: new Date(e.at), source: "admin_correction", correctionId: row.id, correctionReason: reason, createdBy: actor.id, createdAt: sql`clock_timestamp()` as unknown as Date });
        }
        const open = replay.sessions[replay.sessions.length - 1];
        earliest = Math.min(closeMs, open?.startAt ?? closeMs);
        if (person.userId) await notify(tx, { userId: person.userId, kind: "attendance.time_changed", title: "Your recorded time was changed", body: reason, link: "/attendance" });
        await writeAudit({ actor, action: "clock_source.close_session", targetType: "employee", targetId: employeeId, after: { added: proposal, sessionStartedAt: open ? new Date(open.startAt).toISOString() : null }, metadata: { correctionId: row.id, reason } }, tx);
        closed = true;
      }
      // The session is closed now, so the ordinary rule (clocked out, append-only row, audit, notice) passes.
      await applyClockSource(tx, actor, employeeId, "elevate", null);
    });
    if (closed) await rebuildAfterChange(employeeId, earliest);
    refresh();
    for (const p of ["/attendance", "/team-attendance", "/hours-review"]) revalidatePath(p);
    return { ok: true, data: { closed } };
  });
}

/**
 * Moves many people to the Jibble clock at once (the contractors who clock in Jibble alone). Each person is checked on their own: someone
 * who is not matched or is clocked in right now is skipped with the reason, and the others still move. Afterwards their last 14 days are
 * imported in the background (the 30-minute job then keeps them up to date).
 */
export async function setJibbleClockForMany(input: unknown): Promise<ActionResult<{ switched: number; already: number; skipped: { name: string; reason: string }[] }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = bulkJibbleClockSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const ids = [...new Set(parsed.data.employeeIds)];
    const switchedIds: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    let already = 0;
    for (const employeeId of ids) {
      try {
        const changed = await db.transaction((tx) => applyClockSource(tx, actor, employeeId, "jibble", ids.length));
        if (changed) switchedIds.push(employeeId);
        else already += 1;
      } catch (error) {
        if (!(error instanceof ActionFailure)) throw error;
        const [e] = (await db.execute(sql`select legal_first_name as first, legal_last_name as last, preferred_name as preferred from core.employees where id = ${employeeId}`)) as unknown as { first: string; last: string; preferred: string | null }[];
        skipped.push({ name: e ? reportName({ first: e.first, last: e.last, preferred: e.preferred }) : "Someone", reason: error.message });
      }
    }
    if (switchedIds.length > 0) await requestJibbleImport(switchedIds, 14);
    refresh();
    return { ok: true, data: { switched: switchedIds.length, already, skipped } };
  });
}

/** Asks the job runner to import these people's last days now. Best effort: without the event key the 30-minute job picks them up (3 days back). */
async function requestJibbleImport(employeeIds: string[], days: number): Promise<void> {
  if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_DEV) return;
  try {
    const { inngest } = await import("@/inngest/client");
    await Promise.race([inngest.send({ name: "jibble/import.requested", data: { employeeIds, days } }), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch (error) {
    console.error("jibble import request failed:", error instanceof Error ? error.name : "unknown error");
  }
}

/** Imports the last few days of Jibble entries now for one person whose hours come from Jibble (the job does it every 30 minutes). */
export async function importJibbleHours(input: unknown): Promise<ActionResult<{ imported: number; voided: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = importHoursSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, days } = parsed.data;
    if ((await clockSourceOf(db, employeeId)) !== "jibble") return fail("Their hours do not come from Jibble.");
    const result = await runJibbleImport({ employeeId, days });
    if (result.skipped === "not_configured") return fail("Jibble is not set up yet, or cannot list time entries.");
    if (result.skipped === "paused") return fail("The Jibble link is paused. Turn it on first.");
    if (result.failed > 0) return fail("Jibble could not be reached for that person. Try again in a few minutes.");
    await writeAudit({ actor, action: "jibble.import_requested", targetType: "employee", targetId: employeeId, metadata: { days, imported: result.imported, voided: result.voided } });
    refresh();
    return { ok: true, data: { imported: result.imported, voided: result.voided } };
  });
}

/** Says which ELEVATE client a Jibble project or activity means. It applies at the next import (within 30 minutes). */
export async function saveClientMap(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = clientMapSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { kind, jibbleId, clientId } = parsed.data;
    await db.transaction(async (tx) => {
      const [client] = (await tx.execute(sql`select id from core.clients where id = ${clientId} and archived_at is null`)) as unknown as { id: string }[];
      if (!client) throw new ActionFailure("That client was not found.");
      await tx
        .insert(jibbleClientMap)
        .values({ kind, jibbleId, clientId, setBy: actor.id })
        .onConflictDoUpdate({ target: [jibbleClientMap.kind, jibbleClientMap.jibbleId], set: { clientId, setBy: actor.id, setAt: sql`now()` } });
      await tx.execute(sql`delete from time.jibble_unmapped_ids where kind = ${kind} and jibble_id = ${jibbleId}`);
      await writeAudit({ actor, action: "jibble.client_map", targetType: "client", targetId: clientId, after: { kind, jibbleId } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Removes a mapping (the Jibble id then shows up as unmapped again the next time it is seen). */
export async function removeClientMap(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = removeClientMapSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [row] = await tx.delete(jibbleClientMap).where(eq(jibbleClientMap.id, parsed.data.id)).returning({ kind: jibbleClientMap.kind, jibbleId: jibbleClientMap.jibbleId, clientId: jibbleClientMap.clientId });
      if (!row) throw new ActionFailure("That mapping was not found.");
      await writeAudit({ actor, action: "jibble.client_unmap", targetType: "client", targetId: row.clientId, before: { kind: row.kind, jibbleId: row.jibbleId } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
