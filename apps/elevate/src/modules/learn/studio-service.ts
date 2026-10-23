import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { MIN_TIME_SHARE } from "../../../../learn/src/content";
import { courseContentSchema, type CourseContent, type QuestionSeed } from "../../../../learn/src/content/schema";
import { users } from "@/modules/core/schema";
import { courses, courseVersions, questions, versionModules } from "./schema";
import { diffCourses, type DiffQuestion } from "./studio-diff";
import { hasPlaceholders, lintCourse, textIsAllowed, type ExamConfigLike, type LintIssue } from "./studio-lint";
import { addonSlugFor, newAddonCourse } from "./studio-scaffold";

// The course studio's database side. No authorization here: callers (studio-actions.ts, studio-queries.ts) check permissions first.
// Rules: only a DRAFT can change; every save carries the stamp it was loaded with and is refused if the draft moved on; a save
// that would leave the course invalid (lint errors) is refused; version_modules are rebuilt from the content each time.

type Tx = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

export type StudioVersion = {
  id: string;
  version: number;
  status: "draft" | "published" | "retired";
  changeNote: string | null;
  createdAt: string;
  publishedAt: string | null;
  counselApprovedOn: string | null;
  reviewerEmail: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
  updatedBy: string | null;
  editStamp: number;
  material: boolean;
};

/**
 * The three core courses are written and published from the repository (`pnpm learn:publish`), not in the Course studio: the studio does
 * not show them, cannot open a version of them and cannot start a draft of them. Client add-ons are still written in the studio. Bring a core
 * course back here later by removing its slug from this list (and rewriting what the studio cannot hold, such as the mock-call pool).
 */
export const CODE_MANAGED_COURSES: readonly string[] = ["hipaa", "cybersecurity", "customer-service"];
export const isCodeManagedCourse = (slug: string): boolean => CODE_MANAGED_COURSES.includes(slug);

export type StudioCourse = { id: string; slug: string; title: string; studioManaged: boolean; kind: "core" | "client_addon"; clientId: string | null; clientName: string | null; versions: StudioVersion[] };

const status = (s: string): StudioVersion["status"] => (s === "published" ? "published" : s === "retired" ? "retired" : "draft");

export async function listStudioCourses(tx: Tx): Promise<StudioCourse[]> {
  const rows = await tx.select().from(courses).where(sql`${courses.archivedAt} is null`).orderBy(asc(courses.title));
  const names = (await tx.execute(sql`select c.id::text as id, cl.name from learn.courses c join core.clients cl on cl.id = c.client_id`)) as unknown as { id: string; name: string }[];
  const out: StudioCourse[] = [];
  for (const c of rows) {
    if (isCodeManagedCourse(c.slug)) continue;
    out.push({
      id: c.id,
      slug: c.slug,
      title: c.title,
      studioManaged: c.studioManaged,
      kind: c.kind === "client_addon" ? "client_addon" : "core",
      clientId: c.clientId,
      clientName: names.find((n) => n.id === c.id)?.name ?? null,
      versions: await listVersions(tx, c.id),
    });
  }
  return out;
}

async function listVersions(tx: Tx, courseId: string): Promise<StudioVersion[]> {
  const rows = (await tx.execute(sql`
    select v.id, v.version, v.status, v.change_note, v.created_at, v.published_at, v.counsel_approved_on::text as counsel, v.updated_at, v.updated_by, v.edit_stamp, v.material,
           r.email as reviewer_email, u.email as updated_email
    from learn.course_versions v
    left join core.users r on r.id = v.reviewed_by
    left join core.users u on u.id = v.updated_by
    where v.course_id = ${courseId}
    order by v.version desc`)) as unknown as {
    id: string; version: number; status: string; change_note: string | null; created_at: Date; published_at: Date | null; counsel: string | null;
    updated_at: Date | null; updated_by: string | null; edit_stamp: number; material: boolean; reviewer_email: string | null; updated_email: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: status(r.status),
    changeNote: r.change_note,
    createdAt: new Date(r.created_at).toISOString(),
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    counselApprovedOn: r.counsel,
    reviewerEmail: r.reviewer_email,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    updatedByEmail: r.updated_email,
    updatedBy: r.updated_by,
    editStamp: r.edit_stamp,
    material: r.material,
  }));
}

export type StudioQuestion = DiffQuestion & { id: string };

export type LoadedVersion = {
  course: { id: string; slug: string; title: string; studioManaged: boolean; kind: "core" | "client_addon" };
  version: StudioVersion;
  content: CourseContent;
  examConfig: ExamConfigLike & Record<string, unknown>;
  questions: StudioQuestion[];
};

export async function loadVersion(tx: Tx, slug: string, versionNumber: number): Promise<LoadedVersion | null> {
  if (isCodeManagedCourse(slug)) return null;
  const [course] = await tx.select().from(courses).where(eq(courses.slug, slug)).limit(1);
  if (!course) return null;
  const versions = await listVersions(tx, course.id);
  const version = versions.find((v) => v.version === versionNumber);
  if (!version) return null;
  const [row] = await tx.select({ content: courseVersions.content, examConfig: courseVersions.examConfig }).from(courseVersions).where(eq(courseVersions.id, version.id)).limit(1);
  const parsed = courseContentSchema.safeParse(row.content);
  if (!parsed.success) throw new ActionFailure("This version's content could not be read.");
  const qs = await tx.select().from(questions).where(eq(questions.versionId, version.id)).orderBy(asc(questions.moduleKey), asc(questions.createdAt), asc(questions.id));
  return {
    course: { id: course.id, slug: course.slug, title: course.title, studioManaged: course.studioManaged, kind: course.kind === "client_addon" ? "client_addon" : "core" },
    version,
    content: parsed.data,
    examConfig: row.examConfig as LoadedVersion["examConfig"],
    questions: qs.map((q) => ({
      id: q.id,
      lineage: q.lineage,
      moduleKey: q.moduleKey,
      topic: q.topic,
      type: q.type as QuestionSeed["type"],
      stem: q.stem,
      options: q.options as QuestionSeed["options"],
      correctIds: q.correctIds,
      rationale: q.rationale,
    })),
  };
}

export const lintLoaded = (v: Pick<LoadedVersion, "content" | "questions" | "examConfig">): LintIssue[] => lintCourse(v.content, v.questions, v.examConfig);

export function diffLoaded(a: LoadedVersion, b: LoadedVersion) {
  return diffCourses({ content: a.content, examConfig: a.examConfig, questions: a.questions }, { content: b.content, examConfig: b.examConfig, questions: b.questions });
}

// ---- Writing ------------------------------------------------------------------------------------------------------------------

async function writeModules(tx: Tx, versionId: string, content: CourseContent) {
  await tx.delete(versionModules).where(eq(versionModules.versionId, versionId));
  await tx.insert(versionModules).values(
    content.modules.map((m, i) => ({
      versionId,
      moduleKey: m.key,
      position: i + 1,
      title: m.title,
      estimatedMinutes: m.estimatedMinutes,
      minSeconds: Math.round(m.estimatedMinutes * 60 * MIN_TIME_SHARE),
      screenCount: m.screens.length,
      tracks: m.tracks as string[],
    })),
  );
}

/** Locks one draft for a save: it must be a draft and the stamp must be the one the editor loaded. */
async function lockDraft(tx: Tx, versionId: string, stamp: number) {
  const [v] = await tx.select().from(courseVersions).where(eq(courseVersions.id, versionId)).for("update");
  if (!v) throw new ActionFailure("That version was not found.");
  if (v.status !== "draft") throw new ActionFailure("Only a draft can be edited. Make a new draft from this version.");
  if (v.editStamp !== stamp) throw new ActionFailure("Someone saved this draft after you opened it. Reload the page to see their changes.");
  return v;
}

const failIfErrors = (issues: LintIssue[]) => {
  const first = issues.find((i) => i.level === "error");
  if (first) throw new ActionFailure(`${first.where}: ${first.message}`);
};

/** A new draft copied from a version (the latest by default). It becomes the course's working copy: the code files stop being loaded. */
export async function createDraft(tx: Tx, p: { courseSlug: string; fromVersion?: number; note: string; actorId: string }): Promise<{ versionId: string; version: number }> {
  const [course] = await tx.select().from(courses).where(eq(courses.slug, p.courseSlug)).for("update");
  if (!course) throw new ActionFailure("That course has not been loaded yet.");
  if (isCodeManagedCourse(course.slug)) throw new ActionFailure("This course is written in the course files and published from there, not in the Course studio.");
  // The studio does not hold the mock-call pool (docs/learn/14-mock-call.md): a copy would drop it and nobody could earn the certificate.
  if (course.requiresCall) throw new ActionFailure("This course has a graded mock call, which the studio cannot edit yet. Change it in the course files and publish it from there.");
  const versions = await tx.select().from(courseVersions).where(eq(courseVersions.courseId, course.id)).orderBy(desc(courseVersions.version));
  if (versions.some((v) => v.status === "draft")) throw new ActionFailure("There is already a draft of this course. Edit or discard it first.");
  const source = p.fromVersion ? versions.find((v) => v.version === p.fromVersion) : (versions.find((v) => v.status === "published") ?? versions[0]);
  if (!source) throw new ActionFailure("There is no version to copy from.");

  const [created] = await tx
    .insert(courseVersions)
    .values({
      courseId: course.id,
      version: (versions[0]?.version ?? 0) + 1,
      status: "draft",
      content: source.content,
      examConfig: source.examConfig,
      material: false,
      createdBy: p.actorId,
      changeNote: p.note,
      updatedBy: p.actorId,
      updatedAt: new Date(),
    })
    .returning({ id: courseVersions.id, version: courseVersions.version });
  const content = courseContentSchema.parse(source.content);
  await writeModules(tx, created.id, content);
  const sourceQuestions = await tx.select().from(questions).where(eq(questions.versionId, source.id));
  if (sourceQuestions.length > 0) {
    await tx.insert(questions).values(
      sourceQuestions.map((q) => ({
        versionId: created.id,
        moduleKey: q.moduleKey,
        topic: q.topic,
        type: q.type,
        stem: q.stem,
        options: q.options,
        correctIds: q.correctIds,
        rationale: q.rationale,
        lineage: q.lineage,
      })),
    );
  }
  await tx.update(courses).set({ studioManaged: true }).where(eq(courses.id, course.id));
  return { versionId: created.id, version: created.version };
}

/** Changes the content of a draft. `change` receives a copy of the content and returns the new content. Returns the new stamp. */
export async function editContent(tx: Tx, p: { versionId: string; stamp: number; actorId: string; change: (c: CourseContent) => CourseContent }): Promise<number> {
  const v = await lockDraft(tx, p.versionId, p.stamp);
  const current = courseContentSchema.parse(v.content);
  const next = p.change(structuredClone(current));
  const qs = await tx.select().from(questions).where(eq(questions.versionId, p.versionId));
  const seeds: QuestionSeed[] = qs.map((q) => ({ moduleKey: q.moduleKey, topic: q.topic, type: q.type as QuestionSeed["type"], stem: q.stem, options: q.options as QuestionSeed["options"], correctIds: q.correctIds, rationale: q.rationale }));
  failIfErrors(lintCourse(next, seeds, v.examConfig as ExamConfigLike));
  const stamp = v.editStamp + 1;
  await tx.update(courseVersions).set({ content: next, updatedBy: p.actorId, updatedAt: new Date(), editStamp: stamp }).where(eq(courseVersions.id, p.versionId));
  await writeModules(tx, p.versionId, next);
  await tx.update(courses).set({ title: next.title }).where(eq(courses.id, v.courseId));
  return stamp;
}

export type DraftState = { content: CourseContent; examConfig: Record<string, unknown>; questions: (QuestionSeed & { id?: string })[] };

/**
 * A structural edit: `apply` receives copies of the whole draft (content, exam rules, questions) and returns the new state. A
 * question with an `id` is updated, one without is added, and one that is no longer listed is removed. The result must pass the
 * checks. Returns the new stamp.
 */
export async function editDraft(tx: Tx, p: { versionId: string; stamp: number; actorId: string; apply: (s: DraftState) => DraftState }): Promise<number> {
  const v = await lockDraft(tx, p.versionId, p.stamp);
  const rows = await tx.select().from(questions).where(eq(questions.versionId, p.versionId)).orderBy(asc(questions.moduleKey), asc(questions.createdAt), asc(questions.id));
  const before: DraftState = {
    content: courseContentSchema.parse(v.content),
    examConfig: structuredClone(v.examConfig as Record<string, unknown>),
    questions: rows.map((q) => ({ id: q.id, moduleKey: q.moduleKey, topic: q.topic, type: q.type as QuestionSeed["type"], stem: q.stem, options: q.options as QuestionSeed["options"], correctIds: q.correctIds, rationale: q.rationale })),
  };
  const next = p.apply(structuredClone(before));
  failIfErrors(lintCourse(next.content, next.questions, next.examConfig as ExamConfigLike));

  const keep = new Set(next.questions.flatMap((q) => (q.id ? [q.id] : [])));
  for (const old of rows) if (!keep.has(old.id)) await tx.delete(questions).where(eq(questions.id, old.id));
  for (const q of next.questions) {
    if (q.id) {
      await tx.update(questions).set({ moduleKey: q.moduleKey, topic: q.topic, stem: q.stem, options: q.options, correctIds: q.correctIds, rationale: q.rationale }).where(and(eq(questions.id, q.id), eq(questions.versionId, p.versionId)));
    } else {
      await tx.insert(questions).values({ versionId: p.versionId, moduleKey: q.moduleKey, topic: q.topic, type: q.type, stem: q.stem, options: q.options, correctIds: q.correctIds, rationale: q.rationale });
    }
  }
  const stamp = v.editStamp + 1;
  await tx.update(courseVersions).set({ content: next.content, examConfig: next.examConfig, updatedBy: p.actorId, updatedAt: new Date(), editStamp: stamp }).where(eq(courseVersions.id, p.versionId));
  await writeModules(tx, p.versionId, next.content);
  await tx.update(courses).set({ title: next.content.title }).where(eq(courses.id, v.courseId));
  return stamp;
}

/** `type` and `moduleKey` are optional: left out, the question keeps its own. Changing them keeps the question's place in the version history. */
export type QuestionPatch = { topic: string; stem: string; options: { id: string; text: string }[]; correctIds: string[]; rationale: string; type?: QuestionSeed["type"]; moduleKey?: string };

/** Changes one exam question of a draft: wording, options, key, reason, and optionally its type and module. Returns the new stamp. */
export async function editQuestion(tx: Tx, p: { versionId: string; questionId: string; stamp: number; actorId: string; patch: QuestionPatch }): Promise<number> {
  const v = await lockDraft(tx, p.versionId, p.stamp);
  const all = await tx.select().from(questions).where(eq(questions.versionId, p.versionId));
  const target = all.find((q) => q.id === p.questionId);
  if (!target) throw new ActionFailure("That question was not found in this draft.");
  const content = courseContentSchema.parse(v.content);
  const moduleKey = p.patch.moduleKey ?? target.moduleKey;
  const type = p.patch.type ?? (target.type as QuestionSeed["type"]);
  if (!content.modules.some((m) => m.key === moduleKey)) throw new ActionFailure("That module is not in this draft.");
  const seeds: QuestionSeed[] = all.map((q) =>
    q.id === p.questionId
      ? { moduleKey, topic: p.patch.topic, type, stem: p.patch.stem, options: p.patch.options as QuestionSeed["options"], correctIds: p.patch.correctIds, rationale: p.patch.rationale }
      : { moduleKey: q.moduleKey, topic: q.topic, type: q.type as QuestionSeed["type"], stem: q.stem, options: q.options as QuestionSeed["options"], correctIds: q.correctIds, rationale: q.rationale },
  );
  failIfErrors(lintCourse(content, seeds, v.examConfig as ExamConfigLike));
  await tx.update(questions).set({ moduleKey, type, topic: p.patch.topic, stem: p.patch.stem, options: p.patch.options, correctIds: p.patch.correctIds, rationale: p.patch.rationale }).where(and(eq(questions.id, p.questionId), eq(questions.versionId, p.versionId)));
  const stamp = v.editStamp + 1;
  await tx.update(courseVersions).set({ updatedBy: p.actorId, updatedAt: new Date(), editStamp: stamp }).where(eq(courseVersions.id, p.versionId));
  return stamp;
}

/** Deletes a draft's content: its editor comments, questions and modules, then the version itself. */
async function deleteDraftContent(tx: Tx, versionId: string): Promise<void> {
  await tx.execute(sql`delete from learn.studio_comments where version_id = ${versionId}`);
  await tx.delete(questions).where(eq(questions.versionId, versionId));
  await tx.delete(versionModules).where(eq(versionModules.versionId, versionId));
  await tx.delete(courseVersions).where(eq(courseVersions.id, versionId));
}

/**
 * Discards a draft. When it was the only version of a client add-on (an add-on that never went live), the empty course is closed
 * with it, so a discarded add-on does not stay in the list. Returns whether the course is gone.
 */
export async function discardDraft(tx: Tx, p: { versionId: string; stamp: number }): Promise<{ courseGone: boolean }> {
  const v = await lockDraft(tx, p.versionId, p.stamp);
  await deleteDraftContent(tx, v.id);
  const [course] = await tx.select().from(courses).where(eq(courses.id, v.courseId)).limit(1);
  const left = (await tx.execute(sql`select 1 from learn.course_versions where course_id = ${v.courseId}`)) as unknown as unknown[];
  if (course?.kind === "client_addon" && left.length === 0) {
    await tx.update(courses).set({ archivedAt: new Date() }).where(eq(courses.id, v.courseId));
    return { courseGone: true };
  }
  return { courseGone: false };
}

/**
 * Removes a client add-on that never went live (no published or retired version, and so nobody was ever assigned it): its draft is
 * deleted and the course is closed (archived, never deleted). A live or retired add-on is a training record and stays.
 */
export async function removeAddon(tx: Tx, p: { slug: string }): Promise<{ courseId: string; clientId: string | null }> {
  const [course] = await tx.select().from(courses).where(and(eq(courses.slug, p.slug), sql`${courses.archivedAt} is null`)).for("update").limit(1);
  if (!course) throw new ActionFailure("That course was not found.");
  if (course.kind !== "client_addon") throw new ActionFailure("Only a client add-on can be removed.");
  const live = (await tx.execute(sql`select 1 from learn.course_versions where course_id = ${course.id} and status <> 'draft' limit 1`)) as unknown as unknown[];
  const assigned = (await tx.execute(sql`select 1 from learn.assignments where course_id = ${course.id} limit 1`)) as unknown as unknown[];
  if (live.length > 0 || assigned.length > 0) throw new ActionFailure("This add-on has been published, so it is part of the training record and cannot be removed.");
  const drafts = (await tx.execute(sql`select id::text as id from learn.course_versions where course_id = ${course.id}`)) as unknown as { id: string }[];
  for (const d of drafts) await deleteDraftContent(tx, d.id);
  await tx.update(courses).set({ archivedAt: new Date() }).where(eq(courses.id, course.id));
  return { courseId: course.id, clientId: course.clientId };
}

/**
 * Publishes a draft. Rules: the draft must differ from the current published version, pass the checks, and be published by someone
 * OTHER than the person who saved it last (a second pair of eyes). The previous published version is retired in the same step.
 */
export async function publishDraft(tx: Tx, p: { versionId: string; actorId: string; reviewerUserId: string; counselApprovedOn: string; material: boolean }): Promise<{ version: number; startedPaused: boolean }> {
  const [v] = await tx.select().from(courseVersions).where(eq(courseVersions.id, p.versionId)).for("update");
  if (!v) throw new ActionFailure("That version was not found.");
  if (v.status !== "draft") throw new ActionFailure("Only a draft can be published.");
  if (v.updatedBy && v.updatedBy === p.actorId) throw new ActionFailure("Someone else has to publish this: you saved the last change.");

  const [course] = await tx.select({ slug: courses.slug }).from(courses).where(eq(courses.id, v.courseId));
  const draft = await loadVersion(tx, course.slug, v.version);
  if (!draft) throw new ActionFailure("That version was not found.");
  const issues = lintLoaded(draft);
  failIfErrors(issues);
  if (hasPlaceholders(issues)) throw new ActionFailure("Some text still says TO WRITE:. Finish it before publishing.");
  const [published] = await tx.select({ version: courseVersions.version }).from(courseVersions).where(and(eq(courseVersions.courseId, v.courseId), eq(courseVersions.status, "published")));
  if (published) {
    const base = await loadVersion(tx, course.slug, published.version);
    if (base && diffLoaded(base, draft).unchanged) throw new ActionFailure("Nothing has changed since the published version.");
  }
  // The first time a course goes live nobody is assigned automatically until HR chooses who (a pilot or everyone): a paused rule.
  const [earlier] = await tx.select({ id: courseVersions.id }).from(courseVersions).where(and(eq(courseVersions.courseId, v.courseId), sql`${courseVersions.status} in ('published', 'retired')`)).limit(1);
  let startedPaused = false;
  if (!earlier) {
    const made = (await tx.execute(sql`insert into learn.assignment_rules (course_id, mode, team_ids) values (${v.courseId}, 'paused', '{}'::uuid[]) on conflict (course_id) do nothing returning course_id`)) as unknown as unknown[];
    startedPaused = made.length > 0;
  }
  await tx.update(courseVersions).set({ status: "retired", retiredAt: new Date() }).where(and(eq(courseVersions.courseId, v.courseId), eq(courseVersions.status, "published")));
  await tx
    .update(courseVersions)
    .set({ status: "published", publishedAt: new Date(), publishedBy: p.actorId, reviewedBy: p.reviewerUserId, counselApprovedOn: p.counselApprovedOn, material: p.material })
    .where(eq(courseVersions.id, p.versionId));
  return { version: v.version, startedPaused };
}

export async function userIdByEmail(tx: Tx, email: string): Promise<string | null> {
  const [u] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return u?.id ?? null;
}

/**
 * Creates a client's add-on course and its first draft (one module, three screens, five placeholder questions). One add-on per
 * client for now. The course is studio-managed from the start (it has no code files). Nothing is assigned until it is published.
 */
export async function createClientAddon(tx: Tx, p: { clientId: string; actorId: string; topic?: string; acknowledgmentOnly?: boolean }): Promise<{ slug: string; versionId: string; version: number; clientName: string }> {
  const [client] = (await tx.execute(sql`select id::text as id, name from core.clients where id = ${p.clientId} and archived_at is null for update`)) as unknown as { id: string; name: string }[];
  if (!client) throw new ActionFailure("That client was not found.");
  // A client may have several add-ons. From the second one on, a short topic tells them apart.
  const existing = (await tx.execute(sql`select 1 from learn.courses where client_id = ${p.clientId} and kind = 'client_addon' and archived_at is null`)) as unknown as unknown[];
  const topic = p.topic?.trim() || undefined;
  if (existing.length > 0 && !topic) throw new ActionFailure("This client already has an add-on course. Give this one a short topic to tell them apart.");

  const taken = ((await tx.execute(sql`select slug from learn.courses`)) as unknown as { slug: string }[]).map((r) => r.slug);
  const slug = addonSlugFor(client.name, taken);
  const draft = newAddonCourse(client.name, textIsAllowed, topic, p.acknowledgmentOnly === true);
  failIfErrors(lintCourse(draft.content, draft.questions, draft.examConfig));

  const [course] = await tx
    .insert(courses)
    .values({ slug, title: draft.title, kind: "client_addon", clientId: p.clientId, label: draft.label, noun: draft.noun, fixedTrack: "full", studioManaged: true, requiresExam: p.acknowledgmentOnly !== true })
    .returning({ id: courses.id });
  const [created] = await tx
    .insert(courseVersions)
    .values({ courseId: course.id, version: 1, status: "draft", content: draft.content, examConfig: draft.examConfig, material: false, createdBy: p.actorId, changeNote: "New client add-on", updatedBy: p.actorId, updatedAt: new Date() })
    .returning({ id: courseVersions.id, version: courseVersions.version });
  await writeModules(tx, created.id, draft.content);
  if (draft.questions.length > 0)
    await tx.insert(questions).values(draft.questions.map((q) => ({ versionId: created.id, moduleKey: q.moduleKey, topic: q.topic, type: q.type, stem: q.stem, options: q.options, correctIds: q.correctIds, rationale: q.rationale })));
  return { slug, versionId: created.id, version: created.version, clientName: client.name };
}
