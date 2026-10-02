import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import type { SafevoiceOutcome, SafevoiceStatus } from "./constants";
import { svdb } from "./handler-db";
import { safevoiceMessages, safevoiceReports } from "./schema";

// Handler writes. The case itself lives behind the restricted `safevoice_handler` connection; the audit trail lives in the main database.
// Audit rows record WHO did WHAT to WHICH case (ids, statuses, outcome codes) and never any report or message text. The case change and
// its audit row are written inside nested transactions (the case in the restricted connection, the audit in the main one): if either
// write throws, both roll back. They are two database connections, so a failure of the very last commit is the only way to get one without the other.

type Actor = { id: string; email: string };

/** The day (UTC) a change is made; Safe Voice keeps no time of day anywhere. */
const utcDay = () => new Date().toISOString().slice(0, 10);

async function lockedCase(tx: Pick<typeof svdb, "select">, caseId: string) {
  const [row] = await tx
    .select({ id: safevoiceReports.id, status: safevoiceReports.status })
    .from(safevoiceReports)
    .where(eq(safevoiceReports.id, caseId))
    .for("update");
  if (!row) throw new ActionFailure("That case was not found.");
  return row as { id: string; status: SafevoiceStatus };
}

export async function replyAsHandler(actor: Actor, input: { caseId: string; body: string; expectReply: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    await svdb.transaction(async (sv) => {
      const current = await lockedCase(sv, input.caseId);
      if (current.status === "closed") throw new ActionFailure("This case is closed. Reopen it before replying.");
      const next: SafevoiceStatus = input.expectReply ? "awaiting_reporter" : "in_review";
      await sv.insert(safevoiceMessages).values({ reportId: input.caseId, author: "handler", body: input.body });
      await sv.update(safevoiceReports).set({ status: next }).where(eq(safevoiceReports.id, input.caseId));
      await writeAudit({ actor, action: "safevoice.reply", targetType: "safevoice_case", targetId: input.caseId, before: { status: current.status }, after: { status: next } }, tx);
    });
  });
}

export async function changeCaseStatus(actor: Actor, input: { caseId: string; status: "in_review" | "awaiting_reporter" }): Promise<void> {
  await db.transaction(async (tx) => {
    await svdb.transaction(async (sv) => {
      const current = await lockedCase(sv, input.caseId);
      if (current.status === input.status) return;
      // Reopening a closed case clears its outcome (the database requires an outcome exactly when a case is closed).
      await sv.update(safevoiceReports).set({ status: input.status, outcome: null, closedDay: null }).where(eq(safevoiceReports.id, input.caseId));
      await writeAudit({ actor, action: current.status === "closed" ? "safevoice.reopen" : "safevoice.status", targetType: "safevoice_case", targetId: input.caseId, before: { status: current.status }, after: { status: input.status } }, tx);
    });
  });
}

export async function closeAsHandler(actor: Actor, input: { caseId: string; outcome: SafevoiceOutcome; message?: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await svdb.transaction(async (sv) => {
      const current = await lockedCase(sv, input.caseId);
      if (current.status === "closed") throw new ActionFailure("This case is already closed.");
      if (input.message) await sv.insert(safevoiceMessages).values({ reportId: input.caseId, author: "handler", body: input.message });
      await sv.update(safevoiceReports).set({ status: "closed", outcome: input.outcome, closedDay: utcDay() }).where(eq(safevoiceReports.id, input.caseId));
      await writeAudit({ actor, action: "safevoice.close", targetType: "safevoice_case", targetId: input.caseId, before: { status: current.status }, after: { status: "closed", outcome: input.outcome, closingMessage: Boolean(input.message) } }, tx);
    });
  });
}
