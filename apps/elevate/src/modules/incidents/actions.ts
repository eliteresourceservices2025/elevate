"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { notify } from "@/modules/notifications/service";
import { clients } from "@/modules/people/schema";
import { incidentReference, kindLabel } from "./constants";
import { privacyIncidentMessages, privacyIncidents } from "./schema";
import { emailHandlers, handlerUserIds } from "./service";
import { designatePrivacyOfficerSchema, replyIncidentSchema, reportIncidentSchema, setIncidentStatusSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";

/** Today in UTC plus one day: a date picker in a zone ahead of UTC must still be accepted. */
const latestAllowedDate = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const earliestAllowedDate = () => new Date(Date.now() - 3 * 366 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Files a report. Saved first; HR, Super Admin and the Privacy Officer are told in the app (kind and wording only, never the
 * text) and by one short email each that carries no details. The audit entry holds the kind and the ongoing flag, never the text.
 */
export async function reportIncident(input: unknown): Promise<ActionResult<{ id: string; reference: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "incidents.report", { ownerUserId: actor.id });
    const parsed = reportIncidentSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.happenedOn > latestAllowedDate()) return fail("That date is in the future.");
    if (v.happenedOn < earliestAllowedDate()) return fail("That date is too long ago. Choose when you found out.");
    if (!(await allowRequest("incident", actor.id))) return fail("You have sent several reports in the last hour. Please wait a little, or tell HR directly.");

    if (v.clientId) {
      const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, v.clientId)).limit(1);
      if (!client) return fail("Choose a client from the list.");
    }

    const handlers = (await handlerUserIds()).filter((u) => u !== actor.id);
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(privacyIncidents)
        .values({
          reporterUserId: actor.id,
          kind: v.kind,
          happenedOn: v.happenedOn,
          ongoing: v.ongoing,
          howFound: v.howFound,
          whatHappened: v.whatHappened,
          clientId: v.clientId ?? null,
          whoElseKnows: v.whoElseKnows ?? null,
          actionsTaken: v.actionsTaken ?? null,
        })
        .returning({ id: privacyIncidents.id });
      await writeAudit({ actor, action: "incident.report", targetType: "privacy_incident", targetId: row.id, after: { kind: v.kind, ongoing: v.ongoing, hasClient: Boolean(v.clientId) } }, tx);
      await notify(
        tx,
        handlers.map((userId) => ({
          userId,
          kind: "incident.new",
          title: v.ongoing ? "New privacy incident report (ongoing)" : "New privacy incident report",
          body: `${kindLabel(v.kind)}. Open the inbox to read it.`,
          link: `/incidents/${row.id}`,
        })),
      );
      return row.id;
    });

    // Email after the report is safely saved; a failure here never loses it.
    await emailHandlers(handlers, v.ongoing);
    revalidatePath("/incidents");
    return { ok: true, data: { id, reference: incidentReference(id) } };
  });
}

/**
 * A message in the thread: the reporter adds to their own report, a handler asks or answers. A closed report takes none until a
 * handler reopens it. The other side is told in the app (no text).
 */
export async function replyIncident(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = replyIncidentSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { id, body } = parsed.data;
    const isHandler = can(actor, "incidents.handle");
    if (!isHandler) await authorize(actor, "incidents.report", { ownerUserId: actor.id });
    if (!(await allowRequest("incident", actor.id))) return fail("You have sent several messages in the last hour. Please wait a little.");

    const handlers = (await handlerUserIds()).filter((u) => u !== actor.id);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ reporter: privacyIncidents.reporterUserId, status: privacyIncidents.status })
        .from(privacyIncidents)
        .where(eq(privacyIncidents.id, id))
        .for("update");
      // Someone who may not see it gets the same answer as a report that does not exist.
      if (!row || (!isHandler && row.reporter !== actor.id)) throw new ActionFailure("That report was not found.");
      if (row.status === "closed") throw new ActionFailure("This report is closed. Ask the privacy team to reopen it, or file a new report.");
      const mine = row.reporter === actor.id;
      await tx.insert(privacyIncidentMessages).values({ incidentId: id, authorUserId: actor.id, authorKind: mine ? "reporter" : "handler", body });
      await tx.update(privacyIncidents).set({ updatedAt: new Date() }).where(eq(privacyIncidents.id, id));
      await writeAudit({ actor, action: "incident.reply", targetType: "privacy_incident", targetId: id, after: { by: mine ? "reporter" : "handler" } }, tx);
      const toNotify = mine ? handlers : [row.reporter];
      await notify(
        tx,
        toNotify
          .filter((u) => u !== actor.id)
          .map((userId) => ({ userId, kind: "incident.reply", title: "New message on a privacy incident report", body: `Report ${incidentReference(id)} has a new message.`, link: `/incidents/${id}` })),
      );
    });
    revalidatePath(`/incidents/${id}`);
    return { ok: true, data: undefined };
  });
}

/** A handler moves a report between new, in review and closed (closing needs a short note). Nobody handles their own report. */
export async function setIncidentStatus(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "incidents.handle");
    const parsed = setIncidentStatusSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { id, status, resolution } = parsed.data;

    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ reporter: privacyIncidents.reporterUserId, status: privacyIncidents.status })
        .from(privacyIncidents)
        .where(eq(privacyIncidents.id, id))
        .for("update");
      if (!row) throw new ActionFailure("That report was not found.");
      if (row.reporter === actor.id) throw new ActionFailure("Another person on the privacy team has to handle a report you filed.");
      if (row.status === status) throw new ActionFailure("No change.");
      const closing = status === "closed";
      await tx
        .update(privacyIncidents)
        .set({
          status,
          resolution: closing ? (resolution ?? null) : null,
          closedAt: closing ? new Date() : null,
          closedBy: closing ? actor.id : null,
          updatedAt: new Date(),
        })
        .where(eq(privacyIncidents.id, id));
      await writeAudit(
        { actor, action: closing ? "incident.close" : row.status === "closed" ? "incident.reopen" : "incident.status", targetType: "privacy_incident", targetId: id, before: { status: row.status }, after: { status } },
        tx,
      );
      await notify(tx, { userId: row.reporter, kind: "incident.status", title: "Your privacy incident report was updated", body: `Report ${incidentReference(id)} is now ${status === "in_review" ? "in review" : status === "closed" ? "closed" : "new"}.`, link: `/incidents/${id}` });
    });
    revalidatePath("/incidents");
    revalidatePath(`/incidents/${id}`);
    return { ok: true, data: undefined };
  });
}

/** HR or Super Admin names or removes a Privacy Officer by sign-in email. Audited; the person is told in the app. */
export async function setPrivacyOfficer(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "incidents.designate");
    const parsed = designatePrivacyOfficerSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { email, enabled } = parsed.data;

    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, current: users.isPrivacyOfficer, archivedAt: users.archivedAt })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .for("update");
      if (!target || target.archivedAt) throw new ActionFailure("No active account has that email.");
      if (target.current === enabled) throw new ActionFailure("No change.");
      await tx.update(users).set({ isPrivacyOfficer: enabled }).where(and(eq(users.id, target.id)));
      await writeAudit(
        { actor, action: "user.privacy_officer.update", targetType: "user", targetId: target.id, before: { isPrivacyOfficer: target.current }, after: { isPrivacyOfficer: enabled } },
        tx,
      );
      await notify(tx, {
        userId: target.id,
        kind: "incident.officer",
        title: enabled ? "You are now a Privacy Officer in ELEVATE" : "You are no longer a Privacy Officer in ELEVATE",
        body: enabled ? "You can read and handle privacy incident reports." : undefined,
        link: "/incidents",
      });
    });
    revalidatePath("/incidents");
    return { ok: true, data: undefined };
  });
}
