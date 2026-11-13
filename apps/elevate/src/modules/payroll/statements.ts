import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { logChange } from "./changes";
import { PAYSLIP_LABELS, STATEMENT_LABELS as S } from "./constants";
import { readable } from "./payslip-queries";
import { payRunLines, payRunReleases, payRuns } from "./schema";
import { payrollToday } from "./service";
import { freezeRunSignatory } from "./signatory";

// Releasing a run's contractor payment statements: one decision by a Preparer or an Approver (the caller has already authorized) that makes every
// person's statement on a REAL, approved run visible to them. A release is a fact that is never undone (a mistake is fixed by an
// adjustment on the next run). Counts and links only in the audit row, the change log and the notices: never an amount or a name.

type Actor = { id: string; email: string };

/**
 * Tells each person on a run who has a sign-in account that their contractor payment statement is ready: one notice per person (a
 * two-line person gets one), a fixed sentence and a link, never an amount, a period or anyone else's name. A person with no account is
 * simply skipped. Runs inside the transaction that releases the run.
 */
async function notifyStatementsReady(tx: Tx, runId: string): Promise<void> {
  const people = await tx
    .selectDistinct({ userId: employees.userId })
    .from(payRunLines)
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false), isNotNull(employees.userId), isNull(users.archivedAt)));
  await notify(
    tx,
    people.flatMap((p) =>
      p.userId ? [{ userId: p.userId, kind: PAYSLIP_LABELS.noticeKind, title: PAYSLIP_LABELS.noticeTitle, body: PAYSLIP_LABELS.noticeBody, link: PAYSLIP_LABELS.noticeLink }] : [],
    ),
  );
}

/** Why a run's statements can't be released right now, or null when they can. Pure on what the caller read. */
export function releaseRefusal(run: { status: string; isTest: boolean }, alreadyReleased: boolean): string | null {
  if (alreadyReleased) return S.alreadyReleased;
  if (run.isTest) return S.refusalTest;
  if (run.status !== "approved" && run.status !== "paid") return S.refusalNotApproved;
  return null;
}

/** Releases the statements of a run to the people on it. Throws ActionFailure with a plain message when it can't. */
export async function releaseRun(tx: Tx, actor: Actor, runId: string): Promise<{ people: number }> {
  const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).for("update");
  if (!run) throw new ActionFailure("That pay run was not found.");
  const [existing] = await tx.select({ id: payRunReleases.id }).from(payRunReleases).where(eq(payRunReleases.runId, runId)).limit(1);
  const refusal = releaseRefusal(run, existing !== undefined);
  if (refusal) throw new ActionFailure(refusal);

  const lines = await tx
    .select({ id: payRunLines.id, employeeId: payRunLines.employeeId, payloadEnc: payRunLines.payloadEnc })
    .from(payRunLines)
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)));
  if (lines.length === 0) throw new ActionFailure("This run has nobody on it, so there is nothing to release.");
  // A statement that can't be read must never be released: the person would open an error.
  if (lines.some((l) => readable(l.id, l.payloadEnc) === null)) throw new ActionFailure(S.refusalUnreadable);

  const people = new Set(lines.map((l) => l.employeeId)).size;
  // The statements carry whoever signs them today, kept with the run so they never change afterwards.
  await freezeRunSignatory(tx, runId, payrollToday());
  await tx.insert(payRunReleases).values({ runId, releasedBy: actor.id, peopleCount: people });
  await notifyStatementsReady(tx, runId);
  await writeAudit({ actor, action: "payroll.statements.release", targetType: "pay_run", targetId: runId, metadata: { people } }, tx);
  await logChange(tx, actor, { action: "statements_released", runId, detail: { people } });
  return { people };
}
