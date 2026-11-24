"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { REPORT_TYPE_LABELS, reportLink } from "./constants";
import { getReportThread, messageContext, type ReportThread } from "./queries";
import { reportMessages } from "./schema";
import { handlersToTell, resolveReport } from "./service";
import { postReportMessageSchema } from "./validators";

/**
 * A message on a report or request: the person it is about writes to their handler, or a handler asks or answers. The text is encrypted and kept
 * with the report; the other side is told with a neutral notice (never the text) and the audit row has ids only.
 */
export async function postReportMessage(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = postReportMessageSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the message and try again.");
    const { type, id, body } = parsed.data;
    const standing = await resolveReport(db, actor, type, id);
    if (!(await allowRequest("reportMessage", actor.id))) return fail("You have sent several messages. Please wait a few minutes.");
    const messageId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(reportMessages).values({ id: messageId, reportType: type, reportId: id, authorUserId: actor.id, authorKind: standing.standing, bodyEnc: fieldCrypto().encrypt(body, messageContext(id, messageId)) });
      await writeAudit({ actor, action: "report.message", targetType: type, targetId: id, metadata: { messageId, by: standing.standing } }, tx);
      const forHandler = standing.standing === "reporter";
      const targets = forHandler ? await handlersToTell(standing, actor.id) : standing.reporterUserId && standing.reporterUserId !== actor.id ? [standing.reporterUserId] : [];
      await notify(
        tx,
        targets.map((userId) => ({
          userId,
          kind: "report.message",
          title: forHandler ? `${standing.reporterName} wrote about their ${REPORT_TYPE_LABELS[type]}` : `New message about your ${REPORT_TYPE_LABELS[type]}`,
          link: reportLink(type, id, forHandler),
        })),
      );
    });
    revalidatePath("/attendance");
    revalidatePath("/support");
    return { ok: true, data: undefined };
  });
}

/** The messages on one report, for the thread on the screen (the person it is about, or whoever handles that kind of report). */
export async function loadReportThread(input: unknown): Promise<ActionResult<ReportThread>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: await getReportThread(input) }));
}
