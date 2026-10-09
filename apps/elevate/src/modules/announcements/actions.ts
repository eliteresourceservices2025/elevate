"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { documents } from "@/modules/documents/schema";
import { notify, type NewNotification } from "@/modules/notifications/service";
import { todayInZone } from "@/modules/org/service";
import { teams } from "@/modules/org/schema";
import { employees } from "@/modules/people/schema";
import { PLACEHOLDER_MARK } from "./constants";
import { announcementRecipients, announcementTeams, announcements, acknowledgments, policies, policyVersions } from "./schema";
import { ackStatus, activeUserIds, audienceEmployees, pendingAcknowledgments, queueAckEmails, remindPending } from "./service";
import {
  acknowledgeSchema,
  announcementIdSchema,
  announcementSchema,
  createPolicySchema,
  policyIdSchema,
  saveDraftSchema,
  subjectSchema,
  updateAnnouncementSchema,
} from "./validators";

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;

function refresh(...extra: string[]) {
  for (const p of ["/announcements", "/dashboard", ...extra]) revalidatePath(p);
}

/** An attachment must be an active company document that everyone may read. */
async function checkAttachment(id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const [d] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.status, "active"), isNull(documents.archivedAt), isNull(documents.employeeId), eq(documents.audience, "all_staff")))
    .limit(1);
  return d ? null : "Choose a company document that everyone can read.";
}

// --- Announcements ---------------------------------------------------------------------

export async function createAnnouncement(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = announcementSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const today = todayInZone();

    if (v.dueOn && v.dueOn < today) return fail("The due date has already passed.");
    const teamIds = v.audience === "teams" ? [...new Set(v.teamIds)] : [];
    if (teamIds.length) {
      const found = await db.select({ id: teams.id }).from(teams).where(and(inArray(teams.id, teamIds), isNull(teams.archivedAt)));
      if (found.length !== teamIds.length) return fail("One of the teams was not found.");
    }
    const attachmentProblem = await checkAttachment(v.attachmentDocumentId);
    if (attachmentProblem) return fail(attachmentProblem);

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(announcements)
        .values({
          title: v.title,
          body: v.body,
          audience: v.audience,
          pinned: v.pinned,
          requiresAck: v.requiresAck,
          dueOn: v.requiresAck ? (v.dueOn ?? null) : null,
          attachmentDocumentId: v.attachmentDocumentId ?? null,
          publishedBy: actor.id,
        })
        .returning({ id: announcements.id });
      if (teamIds.length) await tx.insert(announcementTeams).values(teamIds.map((teamId) => ({ announcementId: row.id, teamId })));

      // Freeze who this was addressed to. The poster is not asked to acknowledge their own post.
      const audience = (await audienceEmployees(tx, v.audience === "teams" ? teamIds : null)).filter((p) => p.userId !== actor.id);
      if (audience.length) await tx.insert(announcementRecipients).values(audience.map((p) => ({ announcementId: row.id, employeeId: p.id })));

      const userIds = audience.flatMap((p) => (p.userId ? [p.userId] : []));
      const notices: NewNotification[] = userIds.map((userId) => ({
        userId,
        kind: v.requiresAck ? "announcement.ack_required" : "announcement.posted",
        title: v.requiresAck ? `Please acknowledge: ${v.title}` : v.title,
        body: v.requiresAck && v.dueOn ? `Due ${v.dueOn}` : undefined,
        link: `/announcements/${row.id}`,
      }));
      await notify(tx, notices);
      if (v.requiresAck) await queueAckEmails(tx, userIds, today);

      await writeAudit(
        { actor, action: "announcement.create", targetType: "announcement", targetId: row.id, metadata: { audience: v.audience, teams: teamIds.length, recipients: audience.length, requiresAck: v.requiresAck, dueOn: v.dueOn ?? null } },
        tx,
      );
      return row.id;
    });

    refresh();
    return { ok: true, data: { id } };
  });
}

export async function updateAnnouncement(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = updateAnnouncementSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;

    const [current] = await db.select().from(announcements).where(eq(announcements.id, v.announcementId)).limit(1);
    if (!current || current.archivedAt) return fail("That announcement was not found.");

    if (v.title !== current.title || v.body !== current.body) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(acknowledgments).where(eq(acknowledgments.announcementId, current.id));
      if (n > 0) return fail("People have already acknowledged this, so the text cannot change. Post a new announcement instead.");
    }
    if (v.dueOn && !current.requiresAck) return fail("A due date only applies when acknowledgment is required.");
    if (v.dueOn && v.dueOn !== current.dueOn && v.dueOn < todayInZone()) return fail("The due date has already passed.");
    if (v.attachmentDocumentId !== (current.attachmentDocumentId ?? undefined)) {
      const problem = await checkAttachment(v.attachmentDocumentId);
      if (problem) return fail(problem);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(announcements)
        .set({ title: v.title, body: v.body, pinned: v.pinned, dueOn: v.dueOn ?? null, attachmentDocumentId: v.attachmentDocumentId ?? null, updatedAt: new Date() })
        .where(eq(announcements.id, current.id));
      await writeAudit(
        {
          actor,
          action: "announcement.update",
          targetType: "announcement",
          targetId: current.id,
          before: { title: current.title, pinned: current.pinned, dueOn: current.dueOn },
          after: { title: v.title, pinned: v.pinned, dueOn: v.dueOn ?? null },
        },
        tx,
      );
    });
    refresh(`/announcements/${current.id}`);
    return { ok: true, data: undefined };
  });
}

export async function archiveAnnouncement(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = announcementIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);

    await db.transaction(async (tx) => {
      const archived = await tx
        .update(announcements)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(announcements.id, parsed.data.announcementId), isNull(announcements.archivedAt)))
        .returning({ id: announcements.id });
      if (archived.length === 0) throw new ActionFailure("That announcement was not found.");
      await writeAudit({ actor, action: "announcement.archive", targetType: "announcement", targetId: parsed.data.announcementId }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

// --- Acknowledging ---------------------------------------------------------------------

/** Records that the signed-in person read and understood an announcement or a policy version. Once, forever. */
export async function acknowledge(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.acknowledge", { ownerUserId: actor.id });
    const parsed = acknowledgeSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const { kind, id } = parsed.data;

    const [me] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, actor.id), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`))
      .limit(1);

    await db.transaction(async (tx) => {
      if (kind === "announcement") {
        const [a] = await tx.select({ requiresAck: announcements.requiresAck, archivedAt: announcements.archivedAt }).from(announcements).where(eq(announcements.id, id)).limit(1);
        if (!a || a.archivedAt || !a.requiresAck) throw new ActionFailure("Nothing to acknowledge here.");
        if (!me) throw new ActionFailure("Only people with an active ELEVATE profile can acknowledge.");
        const [r] = await tx
          .select({ employeeId: announcementRecipients.employeeId })
          .from(announcementRecipients)
          .where(and(eq(announcementRecipients.announcementId, id), eq(announcementRecipients.employeeId, me.id)))
          .limit(1);
        if (!r) throw new ActionFailure("This announcement was not addressed to you.");
      } else {
        const [pv] = await tx
          .select({ policyId: policyVersions.policyId, version: policyVersions.version, status: policyVersions.status, requiresAck: policyVersions.requiresAck, archivedAt: policies.archivedAt, policyKind: policies.kind })
          .from(policyVersions)
          .innerJoin(policies, eq(policies.id, policyVersions.policyId))
          .where(eq(policyVersions.id, id))
          .limit(1);
        if (!pv || pv.status !== "published" || !pv.requiresAck || pv.archivedAt) throw new ActionFailure("Nothing to acknowledge here.");
        // Everyone with an account accepts the privacy notice, even without a people record (for example a Super Admin).
        if (!me && pv.policyKind !== "privacy_notice") throw new ActionFailure("Only people with an active ELEVATE profile can acknowledge.");
        const [{ latest }] = await tx
          .select({ latest: sql<number>`max(${policyVersions.version})::int` })
          .from(policyVersions)
          .where(and(eq(policyVersions.policyId, pv.policyId), eq(policyVersions.status, "published")));
        if (pv.version !== latest) throw new ActionFailure("A newer version was published. Open the policy and acknowledge the current one.");
      }

      const rows = await tx
        .insert(acknowledgments)
        .values(kind === "announcement" ? { userId: actor.id, announcementId: id } : { userId: actor.id, policyVersionId: id })
        .onConflictDoNothing()
        .returning({ id: acknowledgments.id });
      if (rows.length > 0) {
        await writeAudit({ actor, action: "acknowledgment.create", targetType: kind, targetId: id }, tx);
      }
    });

    refresh();
    revalidatePath("/announcements/[id]", "page");
    return { ok: true, data: undefined };
  });
}

// --- Status, reminders, export ---------------------------------------------------------

async function subjectIsOpen(kind: "announcement" | "policy_version", id: string): Promise<{ title: string } | null> {
  if (kind === "announcement") {
    const [a] = await db.select({ title: announcements.title, requiresAck: announcements.requiresAck, archivedAt: announcements.archivedAt }).from(announcements).where(eq(announcements.id, id)).limit(1);
    return a && a.requiresAck && !a.archivedAt ? { title: a.title } : null;
  }
  const [pv] = await db
    .select({ title: policies.title, policyId: policyVersions.policyId, version: policyVersions.version, status: policyVersions.status, requiresAck: policyVersions.requiresAck, archivedAt: policies.archivedAt })
    .from(policyVersions)
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(eq(policyVersions.id, id))
    .limit(1);
  if (!pv || pv.status !== "published" || !pv.requiresAck || pv.archivedAt) return null;
  const [{ latest }] = await db
    .select({ latest: sql<number>`max(${policyVersions.version})::int` })
    .from(policyVersions)
    .where(and(eq(policyVersions.policyId, pv.policyId), eq(policyVersions.status, "published")));
  return pv.version === latest ? { title: pv.title } : null;
}

/** HR's "Send reminder": notifies everyone still pending for one item. Once a day per item. */
export async function sendReminder(input: unknown): Promise<ActionResult<{ recipients: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.remind");
    const parsed = subjectSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const subject = parsed.data;

    if (!(await subjectIsOpen(subject.kind, subject.id))) return fail("That item is not open for acknowledgment.");
    const today = todayInZone();

    const recipients = await db.transaction(async (tx) => {
      const pending = (await pendingAcknowledgments(tx)).filter((p) => (subject.kind === "announcement" ? p.kind === "announcement" && p.id === subject.id : p.versionId === subject.id));
      if (pending.length === 0) throw new ActionFailure("Everyone with an account has already acknowledged this.");
      const notified = await remindPending(tx, subject, pending, today, "manual", actor.id);
      if (!notified) throw new ActionFailure("A reminder was already sent today for this item.");
      await queueAckEmails(tx, notified, today);
      await writeAudit({ actor, action: "acknowledgment.reminder_sent", targetType: subject.kind, targetId: subject.id, metadata: { recipients: notified.length } }, tx);
      return notified.length;
    });

    return { ok: true, data: { recipients } };
  });
}

/** CSV of who has and has not acknowledged. Audited. The browser turns the text into a download. */
export async function exportAcknowledgments(input: unknown): Promise<ActionResult<{ fileName: string; csv: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.export");
    const parsed = subjectSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const subject = parsed.data;
    if (!(await allowRequest("download", actor.id))) return fail("Too many exports. Wait a few minutes and try again.");

    const rows = await ackStatus(db, subject, null);
    const csv = toCsv(
      ["Employee number", "Name", "Team", "Has account", "Status", "Acknowledged at"],
      rows.map((r) => [
        r.employeeNumber,
        r.name,
        r.team,
        r.hasAccount ? "Yes" : "No",
        r.acknowledgedAt ? "Acknowledged" : "Not acknowledged",
        r.acknowledgedAt ? formatInZone(r.acknowledgedAt, DEFAULT_TIMEZONE, "yyyy-MM-dd HH:mm") : "",
      ]),
    );
    await writeAudit({ actor, action: "acknowledgment.export", targetType: subject.kind, targetId: subject.id, metadata: { rows: rows.length } });
    return { ok: true, data: { fileName: `acknowledgments-${todayInZone()}.csv`, csv } };
  });
}

// --- Policies --------------------------------------------------------------------------

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "policy";

export async function createPolicy(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = createPolicySchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.dueOn && v.dueOn < todayInZone()) return fail("The due date has already passed.");

    const base = slugify(v.title);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      try {
        const id = await db.transaction(async (tx) => {
          const [p] = await tx.insert(policies).values({ slug, title: v.title, kind: "general" }).returning({ id: policies.id });
          await tx.insert(policyVersions).values({ policyId: p.id, version: 1, body: v.body, status: "draft", requiresAck: v.requiresAck, dueOn: v.requiresAck ? (v.dueOn ?? null) : null });
          await writeAudit({ actor, action: "policy.create", targetType: "policy", targetId: p.id, metadata: { slug } }, tx);
          return p.id;
        });
        refresh();
        return { ok: true, data: { id } };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error; // a taken slug: try the next suffix
      }
    }
    return fail("Choose a different title.");
  });
}

/** Saves the working draft of a policy, starting a new one (from the last published text) if there is none. */
export async function saveDraft(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = saveDraftSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.dueOn && v.dueOn < todayInZone()) return fail("The due date has already passed.");

    await db.transaction(async (tx) => {
      const [policy] = await tx.select({ id: policies.id, archivedAt: policies.archivedAt }).from(policies).where(eq(policies.id, v.policyId)).limit(1);
      if (!policy || policy.archivedAt) throw new ActionFailure("That policy was not found.");

      const [draft] = await tx.select({ id: policyVersions.id }).from(policyVersions).where(and(eq(policyVersions.policyId, v.policyId), eq(policyVersions.status, "draft"))).limit(1);
      const values = { body: v.body, changeNote: v.changeNote ?? null, requiresAck: v.requiresAck, dueOn: v.requiresAck ? (v.dueOn ?? null) : null, updatedAt: new Date() };
      if (draft) {
        await tx.update(policyVersions).set(values).where(eq(policyVersions.id, draft.id));
      } else {
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${policyVersions.version}), 0)::int + 1` })
          .from(policyVersions)
          .where(eq(policyVersions.policyId, v.policyId));
        await tx.insert(policyVersions).values({ policyId: v.policyId, version: next, status: "draft", ...values });
      }
      await writeAudit({ actor, action: "policy.draft_saved", targetType: "policy", targetId: v.policyId }, tx);
    });
    refresh(`/announcements/policies/${v.policyId}`);
    return { ok: true, data: undefined };
  });
}

export async function discardDraft(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = policyIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const { policyId } = parsed.data;

    await db.transaction(async (tx) => {
      const [published] = await tx.select({ id: policyVersions.id }).from(policyVersions).where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, "published"))).limit(1);
      if (!published) throw new ActionFailure("A policy needs a first version. Edit the draft instead.");
      const gone = await tx.delete(policyVersions).where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, "draft"))).returning({ id: policyVersions.id });
      if (gone.length === 0) throw new ActionFailure("There is no draft to discard.");
      await writeAudit({ actor, action: "policy.draft_discarded", targetType: "policy", targetId: policyId }, tx);
    });
    refresh(`/announcements/policies/${policyId}`);
    return { ok: true, data: undefined };
  });
}

/**
 * Removes a policy that was never published (a test or a mistake). It is archived, not erased, and nothing that was published can be
 * removed this way: published versions are the record of what people were asked to accept. The built-in privacy notice and monitoring
 * policy are never archived (the sign-in gate and the Jibble switch read them).
 */
export async function archivePolicy(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = policyIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const { policyId } = parsed.data;

    await db.transaction(async (tx) => {
      const [p] = await tx.select({ id: policies.id, kind: policies.kind }).from(policies).where(and(eq(policies.id, policyId), isNull(policies.archivedAt))).limit(1);
      if (!p) throw new ActionFailure("That policy was not found.");
      if (p.kind !== "general") throw new ActionFailure("The privacy notice and the monitoring policy cannot be removed. Edit their text instead.");
      const [published] = await tx.select({ id: policyVersions.id }).from(policyVersions).where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, "published"))).limit(1);
      if (published) throw new ActionFailure("A published policy cannot be removed.");
      await tx.update(policies).set({ archivedAt: new Date() }).where(eq(policies.id, policyId));
      await writeAudit({ actor, action: "policy.archive", targetType: "policy", targetId: policyId }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Publishes the draft as the new current version: frozen from now on, everyone is notified. */
export async function publishDraft(input: unknown): Promise<ActionResult<{ version: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = policyIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const { policyId } = parsed.data;
    const today = todayInZone();

    const version = await db.transaction(async (tx) => {
      const [policy] = await tx.select().from(policies).where(eq(policies.id, policyId)).limit(1);
      if (!policy || policy.archivedAt) throw new ActionFailure("That policy was not found.");
      const [draft] = await tx.select().from(policyVersions).where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, "draft"))).limit(1);
      if (!draft) throw new ActionFailure("There is no draft to publish.");
      if (draft.body.includes(PLACEHOLDER_MARK)) throw new ActionFailure("Replace the placeholder text before publishing.");
      if (draft.dueOn && draft.dueOn < today) throw new ActionFailure("The due date has already passed. Change it first.");

      // The privacy notice and monitoring policy always need acknowledgment: the first-login screen and the Jibble gate depend on it.
      const requiresAck = draft.requiresAck || policy.kind !== "general";
      await tx.update(policyVersions).set({ status: "published", requiresAck, publishedAt: new Date(), publishedBy: actor.id, updatedAt: new Date() }).where(eq(policyVersions.id, draft.id));

      const userIds = (await activeUserIds(tx)).filter((id) => id !== actor.id);
      const notices: NewNotification[] = userIds.map((userId) => ({
        userId,
        kind: requiresAck ? "policy.ack_required" : "policy.published",
        title: requiresAck ? `Please acknowledge: ${policy.title} (version ${draft.version})` : `${policy.title} was updated (version ${draft.version})`,
        body: draft.changeNote ?? undefined,
        link: `/announcements/policies/${policy.id}`,
      }));
      await notify(tx, notices);
      if (requiresAck) await queueAckEmails(tx, userIds, today);

      await writeAudit(
        { actor, action: "policy.publish", targetType: "policy", targetId: policy.id, metadata: { slug: policy.slug, version: draft.version, requiresAck, dueOn: draft.dueOn, notified: userIds.length } },
        tx,
      );
      return draft.version;
    });
    refresh(`/announcements/policies/${policyId}`);
    return { ok: true, data: { version } };
  });
}
