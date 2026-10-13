"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { courseMetaSchema, createDraftSchema, discardDraftSchema, moduleMetaSchema, publishDraftSchema, questionEditSchema, screenSchemaInput } from "./studio-validators";
import { createDraft, discardDraft, editContent, editQuestion, publishDraft, userIdByEmail } from "./studio-service";

// The course studio's write actions. Each one: sign-in, permission `learn.manage_content`, validation, then the service (which
// refuses a save on a stale draft or one that would leave the course invalid). Audit entries carry course, version, module or
// screen ids and counts, NEVER the text itself.

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";

const touched = (slug?: string) => {
  revalidatePath("/course-studio");
  if (slug) revalidatePath(`/course-studio/${slug}`);
};

/** Starts a draft copied from the latest published version (or a chosen one). The course is edited in the studio from then on. */
export async function createStudioDraft(input: unknown): Promise<ActionResult<{ version: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = createDraftSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const made = await db.transaction(async (tx) => {
      const r = await createDraft(tx, { courseSlug: v.course, fromVersion: v.fromVersion, note: v.note, actorId: actor.id });
      await writeAudit({ actor, action: "learn.studio_draft", targetType: "learn_course_version", targetId: r.versionId, metadata: { course: v.course, version: r.version, fromVersion: v.fromVersion ?? null } }, tx);
      return r;
    });
    touched(v.course);
    return { ok: true, data: { version: made.version } };
  });
}

export async function saveStudioCourseMeta(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = courseMetaSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const stamp = await db.transaction(async (tx) => {
      const s = await editContent(tx, {
        versionId: v.versionId,
        stamp: v.stamp,
        actorId: actor.id,
        change: (c) => ({ ...c, title: v.title, attestation: { version: v.attestationVersion, text: v.attestationText } }),
      });
      await writeAudit({ actor, action: "learn.studio_edit", targetType: "learn_course_version", targetId: v.versionId, metadata: { part: "course" } }, tx);
      return s;
    });
    touched();
    return { ok: true, data: { stamp } };
  });
}

export async function saveStudioModuleMeta(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = moduleMetaSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const stamp = await db.transaction(async (tx) => {
      const s = await editContent(tx, {
        versionId: v.versionId,
        stamp: v.stamp,
        actorId: actor.id,
        change: (c) => {
          const m = c.modules.find((x) => x.key === v.moduleKey);
          if (!m) throw new ActionFailure("That module was not found.");
          m.title = v.title;
          m.summary = v.summary;
          m.estimatedMinutes = v.estimatedMinutes;
          m.tracks = v.tracks;
          m.keyPoints = v.keyPoints;
          return c;
        },
      });
      await writeAudit({ actor, action: "learn.studio_edit", targetType: "learn_course_version", targetId: v.versionId, metadata: { part: "module", module: v.moduleKey } }, tx);
      return s;
    });
    touched();
    return { ok: true, data: { stamp } };
  });
}

export async function saveStudioScreen(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = screenSchemaInput.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const stamp = await db.transaction(async (tx) => {
      const s = await editContent(tx, {
        versionId: v.versionId,
        stamp: v.stamp,
        actorId: actor.id,
        change: (c) => {
          const m = c.modules.find((x) => x.key === v.moduleKey);
          const screen = m?.screens.find((x) => x.id === v.screenId);
          if (!m || !screen) throw new ActionFailure("That screen was not found.");
          screen.title = v.title;
          screen.blocks = v.blocks;
          return c;
        },
      });
      await writeAudit({ actor, action: "learn.studio_edit", targetType: "learn_course_version", targetId: v.versionId, metadata: { part: "screen", module: v.moduleKey, screen: v.screenId } }, tx);
      return s;
    });
    touched();
    return { ok: true, data: { stamp } };
  });
}

export async function saveStudioQuestion(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = questionEditSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const stamp = await db.transaction(async (tx) => {
      const s = await editQuestion(tx, {
        versionId: v.versionId,
        questionId: v.questionId,
        stamp: v.stamp,
        actorId: actor.id,
        patch: { topic: v.topic, stem: v.stem, options: v.options, correctIds: v.correctIds, rationale: v.rationale },
      });
      await writeAudit({ actor, action: "learn.studio_edit", targetType: "learn_course_version", targetId: v.versionId, metadata: { part: "question", question: v.questionId } }, tx);
      return s;
    });
    touched();
    return { ok: true, data: { stamp } };
  });
}

export async function discardStudioDraft(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = discardDraftSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      await discardDraft(tx, { versionId: parsed.data.versionId, stamp: parsed.data.stamp });
      await writeAudit({ actor, action: "learn.studio_discard", targetType: "learn_course_version", targetId: parsed.data.versionId }, tx);
    });
    touched();
    return { ok: true, data: undefined };
  });
}

/**
 * Publishes a draft. The reviewer is named by sign-in email and the date counsel approved the text is recorded as a fact. Someone
 * other than the last editor must do this. The previous version is retired; people already on it finish it.
 */
export async function publishStudioDraft(input: unknown): Promise<ActionResult<{ version: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = publishDraftSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const result = await db.transaction(async (tx) => {
      const reviewerId = await userIdByEmail(tx, v.reviewerEmail);
      if (!reviewerId) throw new ActionFailure("No ELEVATE account has that reviewer email.");
      const r = await publishDraft(tx, { versionId: v.versionId, actorId: actor.id, reviewerUserId: reviewerId, counselApprovedOn: v.counselApprovedOn, material: v.material });
      await writeAudit({ actor, action: "learn.studio_publish", targetType: "learn_course_version", targetId: v.versionId, metadata: { version: r.version, counselApprovedOn: v.counselApprovedOn, material: v.material } }, tx);
      return r;
    });
    touched();
    return { ok: true, data: { version: result.version } };
  });
}
