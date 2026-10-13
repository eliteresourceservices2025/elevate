"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { getEmailSender } from "@/modules/notifications/email";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { getMyDisplayName } from "@/modules/people/queries";
import { topicLabel } from "./constants";
import { renderSupportEmail } from "./mail";
import { supportRequests } from "./schema";
import { supportEmail } from "./service";
import { closeSupportRequestSchema, supportRequestSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";

/**
 * Asks for help. Saved first (so it is never lost), then HR and Super Admin are told in the app and the request is emailed to the
 * support address with the person as the reply-to. Sending the email can fail without losing the request.
 */
export async function submitSupportRequest(input: unknown): Promise<ActionResult<{ id: string; emailed: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "support.create", { ownerUserId: actor.id });
    const parsed = supportRequestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    if (!(await allowRequest("support", actor.id))) return fail("You have sent several requests in the last hour. Please wait a little, or email us directly.");
    const v = parsed.data;

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(supportRequests)
        .values({ userId: actor.id, email: actor.email, topic: v.topic, subject: v.subject, message: v.message, page: v.page ?? null })
        .returning({ id: supportRequests.id });
      await writeAudit({ actor, action: "support.request", targetType: "support_request", targetId: row.id, after: { topic: v.topic } }, tx);
      const hr = await hrUserIds();
      await notify(tx, hr.filter((u) => u !== actor.id).map((userId) => ({ userId, kind: "support.new", title: "New support request", body: `${topicLabel(v.topic)}: ${v.subject}`, link: "/support" })));
      return row.id;
    });

    // The email goes out after the request is safely saved.
    let emailed = false;
    const sender = getEmailSender();
    if (sender) {
      try {
        const name = await getMyDisplayName().catch(() => null);
        const mail = renderSupportEmail({ name, email: actor.email, topic: topicLabel(v.topic), subject: v.subject, message: v.message, page: v.page ?? null, appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", requestId: id });
        await sender.send({ to: supportEmail(), subject: mail.subject, text: mail.text, html: mail.html, replyTo: actor.email });
        emailed = true;
        await db.update(supportRequests).set({ emailed: true }).where(eq(supportRequests.id, id));
      } catch {
        console.error("support email failed");
      }
    }
    revalidatePath("/support");
    return { ok: true, data: { id, emailed } };
  });
}

/** HR and Super Admin mark a request handled, or reopen it. */
export async function closeSupportRequest(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "support.manage");
    const parsed = closeSupportRequestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { id, reopen } = parsed.data;
    await db.transaction(async (tx) => {
      const [row] = await tx.select({ status: supportRequests.status }).from(supportRequests).where(eq(supportRequests.id, id)).for("update");
      if (!row) throw new ActionFailure("That request was not found.");
      if ((row.status === "closed") === !reopen) throw new ActionFailure(reopen ? "That request is not closed." : "That request is already closed.");
      await tx
        .update(supportRequests)
        .set(reopen ? { status: "open", closedAt: null, closedBy: null } : { status: "closed", closedAt: new Date(), closedBy: actor.id })
        .where(and(eq(supportRequests.id, id)));
      await writeAudit({ actor, action: reopen ? "support.reopen" : "support.close", targetType: "support_request", targetId: id }, tx);
    });
    revalidatePath("/support");
    return { ok: true, data: undefined };
  });
}
