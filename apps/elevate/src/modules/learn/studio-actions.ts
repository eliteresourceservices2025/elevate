"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { addModuleSchema, addQuestionSchema, addScreenSchema, courseMetaSchema, createAddonSchema, createDraftSchema, discardDraftSchema, examRulesSchema, moduleMetaSchema, moduleRefSchema, moveModuleSchema, moveScreenSchema, publishDraftSchema, questionEditSchema, removeQuestionSchema, screenRefSchema, screenSchemaInput, commentSchema, resolveCommentSchema } from "./studio-validators";
import { addComment, resolveComment } from "./studio-comments";
import { newModule, newQuestion, newScreen } from "./studio-scaffold";
import { createClientAddon, createDraft, discardDraft, editContent, editDraft, editQuestion, publishDraft, userIdByEmail, type DraftState } from "./studio-service";

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

/**
 * Creates a client add-on course (extra training for the people assigned to one client) with a first draft to write. Nothing is
 * assigned until it is published, and nobody learns of it from this step.
 */
export async function createStudioAddon(input: unknown): Promise<ActionResult<{ slug: string; version: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = createAddonSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const made = await db.transaction(async (tx) => {
      const r = await createClientAddon(tx, { clientId: parsed.data.clientId, actorId: actor.id, topic: parsed.data.topic });
      // The course address and ids only: never the lesson text.
      await writeAudit({ actor, action: "learn.studio_addon_create", targetType: "learn_course_version", targetId: r.versionId, metadata: { course: r.slug, clientId: parsed.data.clientId } }, tx);
      return r;
    });
    touched(made.slug);
    return { ok: true, data: { slug: made.slug, version: made.version } };
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
        patch: { topic: v.topic, stem: v.stem, options: v.options, correctIds: v.correctIds, rationale: v.rationale, type: v.type, moduleKey: v.moduleKey },
      });
      await writeAudit({ actor, action: "learn.studio_edit", targetType: "learn_course_version", targetId: v.versionId, metadata: { part: "question", question: v.questionId, ...(v.type || v.moduleKey ? { retyped: true } : {}) } }, tx);
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
      await writeAudit({ actor, action: "learn.studio_publish", targetType: "learn_course_version", targetId: v.versionId, metadata: { version: r.version, counselApprovedOn: v.counselApprovedOn, material: v.material, startedPaused: r.startedPaused } }, tx);
      return r;
    });
    touched();
    return { ok: true, data: { version: result.version } };
  });
}

// ---- Structure (phase 3) ------------------------------------------------------------------------------------------------------

/** Runs one structural change on a draft: authorize, validate, edit, audit (the part and ids only), and give back the new stamp. */
async function structural(
  actor: Awaited<ReturnType<typeof requireUser>>,
  versionId: string,
  stamp: number,
  part: string,
  meta: Record<string, unknown>,
  apply: (s: DraftState) => DraftState,
): Promise<ActionResult<{ stamp: number }>> {
  const next = await db.transaction(async (tx) => {
    const s = await editDraft(tx, { versionId, stamp, actorId: actor.id, apply });
    await writeAudit({ actor, action: "learn.studio_edit", targetType: "learn_course_version", targetId: versionId, metadata: { part, ...meta } }, tx);
    return s;
  });
  touched();
  return { ok: true, data: { stamp: next } };
}

function swap<T>(list: T[], index: number, direction: "up" | "down"): T[] {
  const to = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || to < 0 || to >= list.length) throw new ActionFailure("It cannot move further that way.");
  const copy = [...list];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

export async function addStudioModule(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = addModuleSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "module_add", {}, (s) => {
      s.content.modules.push(newModule({ title: v.title, estimatedMinutes: v.estimatedMinutes, tracks: v.tracks }, s.content.modules.map((m) => m.key)));
      return s;
    });
  });
}

export async function removeStudioModule(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = moduleRefSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "module_remove", { module: v.moduleKey }, (s) => {
      if (s.content.modules.length <= 1) throw new ActionFailure("A course needs at least one module.");
      if (!s.content.modules.some((m) => m.key === v.moduleKey)) throw new ActionFailure("That module was not found.");
      s.content.modules = s.content.modules.filter((m) => m.key !== v.moduleKey);
      s.questions = s.questions.filter((q) => q.moduleKey !== v.moduleKey);
      return s;
    });
  });
}

export async function moveStudioModule(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = moveModuleSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "module_move", { module: v.moduleKey, direction: v.direction }, (s) => {
      s.content.modules = swap(s.content.modules, s.content.modules.findIndex((m) => m.key === v.moduleKey), v.direction);
      return s;
    });
  });
}

export async function addStudioScreen(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = addScreenSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "screen_add", { module: v.moduleKey }, (s) => {
      const m = s.content.modules.find((x) => x.key === v.moduleKey);
      if (!m) throw new ActionFailure("That module was not found.");
      m.screens.push(newScreen(v.title, m.screens.map((x) => x.id)));
      return s;
    });
  });
}

export async function removeStudioScreen(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = screenRefSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "screen_remove", { module: v.moduleKey, screen: v.screenId }, (s) => {
      const m = s.content.modules.find((x) => x.key === v.moduleKey);
      if (!m || !m.screens.some((x) => x.id === v.screenId)) throw new ActionFailure("That screen was not found.");
      m.screens = m.screens.filter((x) => x.id !== v.screenId);
      return s;
    });
  });
}

export async function moveStudioScreen(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = moveScreenSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "screen_move", { module: v.moduleKey, screen: v.screenId, direction: v.direction }, (s) => {
      const m = s.content.modules.find((x) => x.key === v.moduleKey);
      if (!m) throw new ActionFailure("That module was not found.");
      m.screens = swap(m.screens, m.screens.findIndex((x) => x.id === v.screenId), v.direction);
      return s;
    });
  });
}

export async function addStudioQuestion(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = addQuestionSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "question_add", { module: v.moduleKey, type: v.type }, (s) => {
      if (!s.content.modules.some((m) => m.key === v.moduleKey)) throw new ActionFailure("That module was not found.");
      s.questions.push(newQuestion({ moduleKey: v.moduleKey, type: v.type, existingStems: s.questions.map((q) => q.stem) }));
      return s;
    });
  });
}

export async function removeStudioQuestion(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = removeQuestionSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "question_remove", { question: v.questionId }, (s) => {
      if (!s.questions.some((q) => q.id === v.questionId)) throw new ActionFailure("That question was not found.");
      s.questions = s.questions.filter((q) => q.id !== v.questionId);
      return s;
    });
  });
}

/** The exam and certificate rules of a draft: pass mark, tries, wait, how long a certificate lasts, and questions per track. */
export async function saveStudioExamRules(input: unknown): Promise<ActionResult<{ stamp: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const p = examRulesSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const v = p.data;
    return structural(actor, v.versionId, v.stamp, "exam_rules", {}, (s) => {
      const tracks = (s.examConfig.tracks ?? {}) as Record<string, Record<string, unknown>>;
      for (const t of Object.keys(v.tracks)) if (!(t in tracks)) throw new ActionFailure(`There is no ${t} track.`);
      s.examConfig = {
        ...s.examConfig,
        passPercent: v.passPercent,
        maxTries: v.maxTries,
        waitMinutesAfterFail: v.waitMinutesAfterFail,
        renewalMonths: v.renewalMonths,
        tracks: Object.fromEntries(Object.entries(tracks).map(([t, cfg]) => [t, { ...cfg, questions: v.tracks[t] ?? (cfg.questions as number) }])),
      };
      return s;
    });
  });
}

/** An editor's note on a draft (the whole course or one module). Never carries into audit entries or notices as text. */
export async function addStudioComment(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const made = await db.transaction(async (tx) => {
      const r = await addComment(tx, { versionId: v.versionId, authorId: actor.id, target: v.target, body: v.body });
      await writeAudit({ actor, action: "learn.studio_comment", targetType: "learn_course_version", targetId: v.versionId, metadata: { comment: r.id, target: v.target } }, tx);
      return r;
    });
    touched(made.slug);
    return { ok: true, data: { id: made.id } };
  });
}

export async function resolveStudioComment(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.manage_content");
    const parsed = resolveCommentSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const r = await resolveComment(tx, { commentId: parsed.data.commentId, actorId: actor.id });
      await writeAudit({ actor, action: "learn.studio_comment_resolve", targetType: "learn_course_version", targetId: r.versionId, metadata: { comment: parsed.data.commentId } }, tx);
    });
    touched();
    return { ok: true, data: undefined };
  });
}
