import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { ForbiddenError } from "@/lib/authz";
import { fieldCrypto } from "@/lib/crypto";
import { ActionFailure } from "@/lib/run-action";
import type { PayrollLevel } from "@/lib/roles";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { notify } from "@/modules/notifications/service";
import type { Tx } from "@/modules/people/service";
import { logChange } from "./changes";
import { runChecks } from "./checks";
import type { ChangeAction } from "./constants";
import { approvalRefusal, runHash } from "./rules";
import { checkInputsOf, readRun, recomputeRun, type Executor, type RunData } from "./runs";
import { payApprovals, payChangeLog, payRunItems, payRunLines, payRuns } from "./schema";
import { employeeIdForUser, lockDraftRun } from "./service";

// Review and approval. A run is sent for review by a Preparer, then approved (or sent back with a note) by an Approver who never
// prepared or changed it. The approval names a hash of every decrypted figure, so a run that changed since the page loaded is refused.
// Every function takes the acting user or a transaction, so it is called only from actions that already ran requireUser() and authorize().
// Notices carry a count and a link, never an amount, a name or the note.

type Actor = { id: string; email: string };

export const STALE_APPROVAL = "This payroll changed. Reload and review it again.";
export const NOT_IN_REVIEW = "This run is not waiting for approval.";

const hashContext = (id: string) => `pay_approval:${id}`;
const noteContext = (id: string) => `pay_approval_note:${id}`;

/** The approval hash as stored (encrypted, bound to its row). Callers must already hold `payroll.view`. */
export const decryptApprovalHash = (id: string, stored: string): string => fieldCrypto().decrypt(stored, hashContext(id));

/** Deciding is not changing: a send-back or an approval does not stop that Approver from deciding the run again later. */
const NOT_A_CHANGE: ChangeAction[] = ["run_viewed", "run_sent_back", "run_approved"];

/**
 * Everyone who prepared or changed the run: every actor in its change history (except views and decisions), plus whoever created or
 * sent it, entered an amount on it or confirmed a line, whatever their payroll level is now.
 */
export async function touchedBy(executor: Executor, run: { id: string; createdBy: string; submittedBy: string | null }): Promise<string[]> {
  const logged = await executor
    .selectDistinct({ id: payChangeLog.actorId })
    .from(payChangeLog)
    .where(and(eq(payChangeLog.runId, run.id), notInArray(payChangeLog.action, NOT_A_CHANGE)));
  const entered = await executor.selectDistinct({ id: payRunItems.enteredBy }).from(payRunItems).where(eq(payRunItems.runId, run.id));
  const confirmed = await executor.selectDistinct({ id: payRunLines.confirmedBy }).from(payRunLines).where(eq(payRunLines.runId, run.id));
  const all = [run.createdBy, run.submittedBy, ...logged.map((r) => r.id), ...entered.map((r) => r.id), ...confirmed.map((r) => r.id)];
  return [...new Set(all.filter((x): x is string => x !== null))];
}

/**
 * The hash an approval is given against, from data read by `readRun`; null when anything on the run can't be read (such a run can't be
 * approved). It covers every line's decrypted figures, inputs, items and confirmation, the dollar rate, the settings snapshot, the full
 * item history and the latest submission, so any change, and any send-back and resubmission, voids a hash handed out earlier.
 */
export async function hashOf(executor: Executor, data: RunData): Promise<string | null> {
  if ([...data.payloads.values()].some((p) => p === null) || [...data.values.values()].some((v) => v === null)) return null;
  const [submission] = await executor
    .select({ id: payChangeLog.id })
    .from(payChangeLog)
    .where(and(eq(payChangeLog.runId, data.run.id), eq(payChangeLog.action, "run_submitted")))
    .orderBy(desc(payChangeLog.createdAt))
    .limit(1);
  const itemsOf = (runLineId: string | null) =>
    data.items.filter((i) => i.runLineId === runLineId).map((i) => ({ id: i.id, employeeId: i.employeeId, type: i.type, state: i.state, value: data.values.get(i.id) }));
  const lines: { id: string; payload: unknown }[] = data.rows.map((r) => ({
    id: r.runLine.id,
    payload: {
      lineId: r.runLine.lineId,
      employeeId: r.runLine.employeeId,
      clientId: r.runLine.clientId,
      alias: r.runLine.alias,
      flags: r.runLine.flags,
      confirmedBy: r.runLine.confirmedBy,
      figures: data.payloads.get(r.runLine.id),
      items: itemsOf(r.runLine.id),
    },
  }));
  lines.push({
    id: "run",
    payload: {
      periodStart: data.run.periodStart,
      periodEnd: data.run.periodEnd,
      settingsSnapshot: data.run.settingsSnapshot,
      itemIds: data.itemIds,
      unassigned: itemsOf(null),
      submission: submission?.id ?? null,
    },
  });
  return runHash(lines, data.run.usdRateE4);
}

/** The approval hash of a run as it is now; null when there is no such run or something on it can't be read. */
export async function computeRunHash(executor: Executor, runId: string): Promise<string | null> {
  const data = await readRun(executor, runId);
  return data ? hashOf(executor, data) : null;
}

/** Why `approverId` may not approve this run (separation of duties, their own line, blocking checks), or null when they may. */
export async function refusalFor(executor: Executor, data: RunData, approverId: string): Promise<string | null> {
  const ownEmployeeId = await employeeIdForUser(executor, approverId);
  const ownLines = ownEmployeeId === null ? [] : data.rows.filter((r) => r.runLine.employeeId === ownEmployeeId).map((r) => ({ confirmedBy: r.runLine.confirmedBy }));
  const checks = runChecks(await checkInputsOf(executor, data, data.run.submittedBy));
  return approvalRefusal({ approverId, touchedBy: await touchedBy(executor, data.run), ownLines, blockingChecks: checks.blocking.length });
}

/**
 * The level is read again inside the transaction, with the account row locked against a concurrent change of level: an Approver whose
 * level was removed (or whose account was archived) is refused on the very next call, even if the request started before.
 */
async function assertStillApprover(tx: Tx, userId: string): Promise<void> {
  const [me] = await tx.select({ level: users.payrollAccess, archivedAt: users.archivedAt }).from(users).where(eq(users.id, userId)).limit(1).for("share");
  if (!me || me.archivedAt !== null || me.level !== "approver") throw new ForbiddenError("payroll.approve");
}

async function holders(tx: Tx, level: PayrollLevel, except: string): Promise<string[]> {
  const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.payrollAccess, level), isNull(users.archivedAt)));
  return rows.map((r) => r.id).filter((id) => id !== except);
}

const runsWord = (n: number) => `${n} pay ${n === 1 ? "run is" : "runs are"}`;

async function lockRun(tx: Tx, runId: string) {
  const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).for("update");
  if (!run) throw new ActionFailure("That pay run was not found.");
  return run;
}

/**
 * Sends a draft for review. Under the run lock the run is recomputed from its sources and the checks are worked out again in the same
 * transaction, relative to the person sending it, so nothing that blocks can slip in between the page and the submit.
 */
export async function submit(tx: Tx, actor: Actor, runId: string): Promise<void> {
  await lockDraftRun(tx, runId);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(payRunLines).where(eq(payRunLines.runId, runId));
  if (n === 0) throw new ActionFailure("This run has no lines, so there is nothing to send for review.");

  await recomputeRun(tx, runId);
  const data = (await readRun(tx, runId))!;
  const checks = runChecks(await checkInputsOf(tx, data, actor.id));
  if (checks.blocking.length > 0) {
    const k = checks.blocking.length;
    throw new ActionFailure(`This run can't be sent for review yet: ${k} ${k === 1 ? "problem must" : "problems must"} be fixed first. They are listed on the page.`);
  }

  await tx.update(payRuns).set({ status: "in_review", submittedBy: actor.id, decidedBy: null }).where(eq(payRuns.id, runId));
  await writeAudit({ actor, action: "payroll.run.submit", targetType: "pay_run", targetId: runId, metadata: { lines: n, warnings: checks.warnings.length } }, tx);
  await logChange(tx, actor, { action: "run_submitted", runId, detail: { lines: n, warnings: checks.warnings.length } });

  const [{ waiting }] = await tx.select({ waiting: sql<number>`count(*)::int` }).from(payRuns).where(eq(payRuns.status, "in_review"));
  await notify(
    tx,
    (await holders(tx, "approver", actor.id)).map((userId) => ({
      userId,
      kind: "payroll.review",
      title: "A pay run is waiting for your approval",
      body: `${runsWord(waiting)} waiting for approval.`,
      link: `/payroll/${runId}`,
    })),
  );
}

/** Returns a run in review to draft with a note (kept encrypted), so a Preparer can change it. A later approval needs a fresh hash. */
export async function sendBack(tx: Tx, actor: Actor, v: { runId: string; note: string }): Promise<void> {
  const run = await lockRun(tx, v.runId);
  if (run.status !== "in_review") throw new ActionFailure(NOT_IN_REVIEW);
  await assertStillApprover(tx, actor.id);

  const data = (await readRun(tx, v.runId))!;
  const hash = await hashOf(tx, data);
  const id = randomUUID();
  await tx.insert(payApprovals).values({
    id,
    runId: v.runId,
    decision: "sent_back",
    runHashEnc: fieldCrypto().encrypt(hash ?? "unreadable", hashContext(id)),
    noteEnc: fieldCrypto().encrypt(v.note, noteContext(id)),
    decidedBy: actor.id,
  });
  await tx.update(payRuns).set({ status: "draft", decidedBy: actor.id }).where(eq(payRuns.id, v.runId));
  await writeAudit({ actor, action: "payroll.run.send_back", targetType: "pay_run", targetId: v.runId, metadata: { lines: data.rows.length } }, tx);
  await logChange(tx, actor, { action: "run_sent_back", runId: v.runId, detail: { note: v.note } });
  await notify(
    tx,
    (await holders(tx, "preparer", actor.id)).map((userId) => ({
      userId,
      kind: "payroll.sent_back",
      title: "A pay run was sent back",
      body: "1 pay run was sent back for changes. Open it to read the note.",
      link: `/payroll/${v.runId}`,
    })),
  );
}

/**
 * Approves a run in review. Refused, writing nothing, when the approver prepared or changed the run, when their own line is not
 * confirmed by another Preparer, when a check blocks, or when the run's hash differs from the one their page was given.
 * The run row is locked first, so of two approvals at once the second finds the run already approved.
 */
export async function approve(tx: Tx, actor: Actor, v: { runId: string; expectedHash: string }): Promise<void> {
  const run = await lockRun(tx, v.runId);
  if (run.status !== "in_review") throw new ActionFailure(NOT_IN_REVIEW);
  await assertStillApprover(tx, actor.id);

  const data = (await readRun(tx, v.runId))!;
  const refusal = await refusalFor(tx, data, actor.id);
  if (refusal) throw new ActionFailure(refusal);
  const hash = await hashOf(tx, data);
  if (hash === null) throw new ActionFailure("Something on this run can't be read, so it can't be approved. Tell the system owner.");
  if (hash !== v.expectedHash) throw new ActionFailure(STALE_APPROVAL);

  const id = randomUUID();
  await tx.insert(payApprovals).values({ id, runId: v.runId, decision: "approved", runHashEnc: fieldCrypto().encrypt(hash, hashContext(id)), decidedBy: actor.id });
  await tx.update(payRuns).set({ status: "approved", decidedBy: actor.id }).where(eq(payRuns.id, v.runId));
  await writeAudit({ actor, action: "payroll.run.approve", targetType: "pay_run", targetId: v.runId, metadata: { lines: data.rows.length } }, tx);
  await logChange(tx, actor, { action: "run_approved", runId: v.runId, detail: { lines: data.rows.length } });
  await notify(
    tx,
    (await holders(tx, "preparer", actor.id)).map((userId) => ({
      userId,
      kind: "payroll.approved",
      title: "A pay run was approved",
      body: "1 pay run was approved and is ready to pay.",
      link: `/payroll/${v.runId}`,
    })),
  );
}

/** The note of the latest send-back while the run is back in draft; null otherwise. Callers must already hold `payroll.view`. */
export async function latestSendBackNote(executor: Executor, run: { id: string; status: string }): Promise<string | null> {
  if (run.status !== "draft") return null;
  const [last] = await executor.select().from(payApprovals).where(eq(payApprovals.runId, run.id)).orderBy(desc(payApprovals.createdAt)).limit(1);
  if (!last || last.decision !== "sent_back" || !last.noteEnc) return null;
  try {
    return fieldCrypto().decrypt(last.noteEnc, noteContext(last.id));
  } catch (error) {
    console.error("payroll send-back note unreadable:", { approvalId: last.id, error: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

/** Runs in review that this Approver could decide: none they created, sent, changed or entered an amount on. No figures. */
export async function countAwaiting(executor: Executor, approverId: string): Promise<number> {
  const [row] = (await executor.execute(sql`
    select count(*)::int as n from payroll.pay_runs r
    where r.status = 'in_review'
      and r.created_by is distinct from ${approverId}::uuid
      and r.submitted_by is distinct from ${approverId}::uuid
      and not exists (
        select 1 from payroll.pay_change_log c
        where c.run_id = r.id and c.actor_id = ${approverId}::uuid and c.action not in ('run_viewed', 'run_sent_back', 'run_approved'))
      and not exists (select 1 from payroll.pay_run_items i where i.run_id = r.id and i.entered_by = ${approverId}::uuid)
      and not exists (select 1 from payroll.pay_run_lines l where l.run_id = r.id and l.confirmed_by = ${approverId}::uuid)`)) as unknown as { n: number }[];
  return row?.n ?? 0;
}
