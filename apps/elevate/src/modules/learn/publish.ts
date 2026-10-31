import type postgres from "postgres";
import { COURSES, MIN_TIME_SHARE } from "../../../../learn/src/content";
import { HIPAA_COURSE_SLUG } from "../../../../learn/src/content/hipaa";
import { callsLint } from "../../../../learn/src/content/calls";
import { courseContentSchema, questionSeedSchema, type CallSeed, type CourseContent, type QuestionSeed } from "../../../../learn/src/content/schema";

// Loading the course into the learn schema. The course is authored in code (apps/learn/src/content); the database copy is what the
// player serves and what attempts and certificates point at. No server-only import: the `learn:publish` script uses this too.
//
// A new version is always a DRAFT first. Publishing needs a named reviewer and the date counsel approved the text (the launch gate
// in docs/learn/06-testing-and-review.md), and it freezes the version (database triggers).

type Sql = postgres.Sql;

export type PublishOptions = {
  /** Make the version live (otherwise it is saved as a draft). */
  publish?: boolean;
  /** Who reviewed the content (a core.users id). Required to publish. */
  reviewerUserId?: string;
  /** The date counsel approved the text (YYYY-MM-DD). Required to publish. */
  counselApprovedOn?: string;
  /** The person doing it (recorded as the creator and publisher). */
  actorUserId?: string;
  /** Marks a version whose changes people already trained must relearn. */
  material?: boolean;
  /**
   * Save the SAME content as a new version even though it equals the latest one. A published version is frozen, so this is how a
   * wrong reviewer or counsel date is corrected: the old version is retired and people already on it finish it.
   */
  newVersion?: boolean;
  /** Which course to load: a slug from the registry in apps/learn/src/content (default: hipaa). */
  courseSlug?: string;
  /** Tests may load a smaller course of their own. */
  course?: { slug: string; content: CourseContent; questions: QuestionSeed[]; examConfig: unknown; /** The mock-call pool (docs/learn/14-mock-call.md). */ calls?: CallSeed[] };
};

export type PublishResult = { courseId: string; versionId: string; version: number; status: "draft" | "published"; created: boolean; questions: number; calls: number; modules: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks the content the way the player and the exam rely on it, before anything is written. */
export function checkCourse(content: CourseContent, questions: QuestionSeed[], calls: CallSeed[] = []): void {
  const parsed = courseContentSchema.safeParse(content);
  if (!parsed.success) throw new Error(`Course content is invalid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const keys = new Set(content.modules.map((m) => m.key));
  if (keys.size !== content.modules.length) throw new Error("Module keys must be unique");
  for (const question of questions) {
    const r = questionSeedSchema.safeParse(question);
    if (!r.success) throw new Error(`Invalid question "${question.stem.slice(0, 40)}": ${r.error.issues[0]?.message}`);
    if (!keys.has(question.moduleKey)) throw new Error(`Question points at an unknown module: ${question.moduleKey}`);
  }
  const problems = callsLint(calls, [...keys]);
  if (problems.length > 0) throw new Error(`Call content is invalid: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`);
}

export async function loadCourse(sql: Sql, options: PublishOptions = {}): Promise<PublishResult> {
  const known = Object.hasOwn(COURSES, options.courseSlug ?? HIPAA_COURSE_SLUG) ? COURSES[options.courseSlug ?? HIPAA_COURSE_SLUG] : undefined;
  if (!options.course && !known) throw new Error(`Unknown course: ${options.courseSlug}. Known: ${Object.keys(COURSES).join(", ")}`);
  const course = options.course ?? { slug: known!.slug, content: known!.content, questions: known!.questions, examConfig: known!.examConfig, calls: known!.calls };
  const calls = course.calls ?? [];
  checkCourse(course.content, course.questions, calls);
  if (options.publish) {
    if (!options.reviewerUserId) throw new Error("Publishing needs the reviewer (who read the content).");
    if (!options.counselApprovedOn || !DATE.test(options.counselApprovedOn)) throw new Error("Publishing needs the date counsel approved the text (YYYY-MM-DD).");
  }

  return (await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Sql;
    const [existing] = await tx`select id, studio_managed from learn.courses where slug = ${course.slug}`;
    // A course edited in the course studio is not loaded over from the code files (that would overwrite the studio's work).
    if (existing?.studio_managed && !options.course) {
      throw new Error(`The ${course.slug} course is edited in the course studio now. Change and publish it there; this command no longer loads it from code.`);
    }
    const courseId: string =
      existing?.id ?? (await tx`insert into learn.courses (slug, title) values (${course.slug}, ${course.content.title}) returning id`)[0].id;
    // A course with a mock-call pool needs the call passed as well as the exam (learn.finish_if_complete).
    await tx`update learn.courses set requires_call = ${calls.length > 0} where id = ${courseId}`;

    const content = JSON.stringify(course.content);
    const config = JSON.stringify(course.examConfig);
    const contentJson = tx.json(course.content as never);
    const configJson = tx.json(course.examConfig as never);
    const versions = await tx`select id, version, status, content::text as content, exam_config::text as config from learn.course_versions where course_id = ${courseId} order by version desc`;
    const latest = versions[0];

    // The same content again: nothing to load (but it may still be published now).
    const sameAsLatest = !options.newVersion && Boolean(latest) && stableEquals(latest.content as string, content) && stableEquals(latest.config as string, config);
    let versionId: string;
    let version: number;
    let created = false;

    if (sameAsLatest) {
      versionId = latest.id as string;
      version = latest.version as number;
      if (latest.status === "draft") {
        await replaceQuestions(tx, versionId, course.questions); // keeps a draft's bank current
        await replaceCalls(tx, versionId, calls);
      }
    } else if (latest && latest.status === "draft" && !options.newVersion) {
      // A draft is still editable: bring it up to date in place.
      versionId = latest.id as string;
      version = latest.version as number;
      await replaceCalls(tx, versionId, []); // the calls reference nothing else; cleared first, written again below
      await tx`delete from learn.questions where version_id = ${versionId}`;
      await tx`delete from learn.version_modules where version_id = ${versionId}`;
      await tx`update learn.course_versions set content = ${contentJson}, exam_config = ${configJson} where id = ${versionId}`;
      await writeChildren(tx, versionId, course.content, course.questions, calls);
    } else {
      version = ((latest?.version as number | undefined) ?? 0) + 1;
      const [row] = await tx`
        insert into learn.course_versions (course_id, version, content, exam_config, material, created_by)
        values (${courseId}, ${version}, ${contentJson}, ${configJson}, ${options.material ?? false}, ${options.actorUserId ?? null})
        returning id`;
      versionId = row.id as string;
      created = true;
      await writeChildren(tx, versionId, course.content, course.questions, calls);
    }

    let status: "draft" | "published" = latest && sameAsLatest && latest.status === "published" ? "published" : "draft";
    if (options.publish && status !== "published") {
      await tx`update learn.course_versions set status = 'retired', retired_at = now() where course_id = ${courseId} and status = 'published' and id <> ${versionId}`;
      await tx`
        update learn.course_versions
        set status = 'published', published_at = now(), published_by = ${options.actorUserId ?? options.reviewerUserId ?? null},
            reviewed_by = ${options.reviewerUserId ?? null}, counsel_approved_on = ${options.counselApprovedOn ?? null}, material = ${options.material ?? false}
        where id = ${versionId}`;
      status = "published";
    }
    return { courseId, versionId, version, status, created, questions: course.questions.length, calls: calls.length, modules: course.content.modules.length } satisfies PublishResult;
  })) as PublishResult;
}

/** Equal as data: object key order is ignored (the database stores jsonb with its own key order). */
const canonical = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canonical(x)])) : v);
const stableEquals = (a: string, b: string): boolean => JSON.stringify(canonical(JSON.parse(a))) === JSON.stringify(canonical(JSON.parse(b)));

async function writeChildren(tx: Sql, versionId: string, content: CourseContent, questions: QuestionSeed[], calls: CallSeed[]) {
  let position = 0;
  for (const m of content.modules) {
    position += 1;
    await tx`
      insert into learn.version_modules (version_id, module_key, position, title, estimated_minutes, min_seconds, screen_count, tracks)
      values (${versionId}, ${m.key}, ${position}, ${m.title}, ${m.estimatedMinutes}, ${Math.round(m.estimatedMinutes * 60 * MIN_TIME_SHARE)}, ${m.screens.length}, ${m.tracks as string[]})`;
  }
  await replaceQuestions(tx, versionId, questions);
  await replaceCalls(tx, versionId, calls);
}

async function replaceQuestions(tx: Sql, versionId: string, questions: QuestionSeed[]) {
  await tx`delete from learn.questions where version_id = ${versionId}`;
  for (const x of questions) {
    await tx`
      insert into learn.questions (version_id, module_key, topic, type, stem, options, correct_ids, rationale)
      values (${versionId}, ${x.moduleKey}, ${x.topic}, ${x.type}, ${x.stem}, ${tx.json(x.options as never)}, ${x.correctIds}::text[], ${x.rationale})`;
  }
}

/**
 * The mock calls of a draft version: the text the app shows goes in call_scenarios, the scoring (points, mood, the caller's answer, the
 * reason) goes in call_scenario_keys, which the app's database role cannot read. A note step is always scored under documentation.
 */
async function replaceCalls(tx: Sql, versionId: string, calls: CallSeed[]) {
  await tx`delete from learn.call_scenario_keys where scenario_id in (select id from learn.call_scenarios where version_id = ${versionId})`;
  await tx`delete from learn.call_scenarios where version_id = ${versionId}`;
  for (const c of calls) {
    const publicSteps = c.steps.map((st) =>
      st.kind === "caller"
        ? { kind: st.kind, id: st.id, caller: st.caller, choices: st.choices.map((x) => ({ id: x.id, text: x.text })) }
        : { kind: st.kind, id: st.id, label: st.label, choices: st.choices.map((x) => ({ id: x.id, text: x.text })) },
    );
    const keySteps = c.steps.map((st) => ({
      id: st.id,
      category: st.kind === "caller" ? st.category : "documentation",
      choices: st.choices.map((x) => ({ id: x.id, points: x.points, mood: x.mood, reply: x.reply, why: x.why })),
    }));
    const [row] = await tx`
      insert into learn.call_scenarios (version_id, key, title, module_key, medical, intro, start_mood, record, steps)
      values (${versionId}, ${c.key}, ${c.title}, ${c.moduleKey}, ${c.medical}, ${c.intro}, ${c.startMood}, ${c.record ? tx.json(c.record as never) : null}, ${tx.json(publicSteps as never)})
      returning id`;
    await tx`insert into learn.call_scenario_keys (scenario_id, steps) values (${row.id}, ${tx.json(keySteps as never)})`;
  }
}

export type AssignOptions = { userId: string; track: "full" | "essentials" | "refresher"; reason?: "new_hire" | "renewal" | "update" | "manual"; dueOn?: string; createdBy?: string; courseSlug?: string };

/** Gives a person the published course on a track. One open assignment per person and course: asking again returns it. */
export async function assignCourse(sql: Sql, o: AssignOptions): Promise<{ assignmentId: string; created: boolean; dueOn: string }> {
  const slug = o.courseSlug ?? HIPAA_COURSE_SLUG;
  // Keep this policy at the service boundary too: scripts and future callers
  // cannot accidentally create a new Essentials HIPAA assignment.
  const track = slug === HIPAA_COURSE_SLUG && o.track === "essentials" ? "full" : o.track;
  const [version] = await sql`
    select v.id, v.course_id from learn.course_versions v join learn.courses c on c.id = v.course_id
    where c.slug = ${slug} and v.status = 'published'`;
  if (!version) throw new Error("The course is not published yet.");
  const [open] = await sql`select id, due_on::text as due_on from learn.assignments where user_id = ${o.userId} and course_id = ${version.course_id} and status in ('assigned','in_progress')`;
  if (open) return { assignmentId: open.id as string, created: false, dueOn: open.due_on as string };
  const [row] = await sql`
    insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on, created_by)
    values (${o.userId}, ${version.course_id}, ${version.id}, ${track}, ${o.reason ?? "manual"},
            ${o.dueOn ?? sql`((now() at time zone 'America/Phoenix')::date + 30)`}, ${o.createdBy ?? null})
    returning id, due_on::text as due_on`;
  return { assignmentId: row.id as string, created: true, dueOn: row.due_on as string };
}
