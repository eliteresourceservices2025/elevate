import "server-only";
import { sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { diffLoaded, lintLoaded, listStudioCourses, loadVersion, type LoadedVersion, type StudioCourse } from "./studio-service";
import type { CourseDiff } from "./studio-diff";
import type { LintIssue } from "./studio-lint";
import { moduleStats, practiceStats, questionStats, type ModuleStat, type PracticeStat, type QuestionStat } from "./studio-stats";

// What the studio pages read. The exam answer key is included (editors need it), which is why every query authorizes
// `learn.manage_content` first: it never reaches the Learn app or anyone without that permission.

export async function getStudioCourses(): Promise<StudioCourse[]> {
  const user = await requireUser();
  await authorize(user, "learn.manage_content");
  return listStudioCourses(db);
}

export async function getStudioVersion(slug: string, version: number): Promise<{ loaded: LoadedVersion; lint: LintIssue[]; viewerId: string; unchangedVsLive: boolean | null } | null> {
  const user = await requireUser();
  await authorize(user, "learn.manage_content");
  if (!Number.isInteger(version) || version < 1) return null;
  const loaded = await loadVersion(db, slug, version);
  if (!loaded) return null;
  // For a draft: does it differ from the live version (null when nothing is live yet)?
  let unchangedVsLive: boolean | null = null;
  if (loaded.version.status === "draft") {
    const live = (await listStudioCourses(db)).find((c) => c.slug === slug)?.versions.find((v) => v.status === "published");
    const base = live ? await loadVersion(db, slug, live.version) : null;
    if (base) unchangedVsLive = diffLoaded(base, loaded).unchanged;
  }
  return { loaded, lint: lintLoaded(loaded), viewerId: user.id, unchangedVsLive };
}

export async function getStudioDiff(slug: string, from: number, to: number): Promise<{ from: LoadedVersion; to: LoadedVersion; diff: CourseDiff } | null> {
  const user = await requireUser();
  await authorize(user, "learn.manage_content");
  const [a, b] = [await loadVersion(db, slug, from), await loadVersion(db, slug, to)];
  if (!a || !b) return null;
  return { from: a, to: b, diff: diffLoaded(a, b) };
}

/** Active clients that do not have an add-on course yet (for "New client add-on"). */
export async function listAddonClients(): Promise<{ id: string; name: string }[]> {
  const user = await requireUser();
  await authorize(user, "learn.manage_content");
  const rows = (await db.execute(sql`
    select cl.id::text as id, cl.name from core.clients cl
    where cl.archived_at is null and cl.is_active
      and not exists (select 1 from learn.courses c where c.client_id = cl.id and c.kind = 'client_addon' and c.archived_at is null)
    order by cl.name`)) as unknown as { id: string; name: string }[];
  return rows;
}

export type CourseStats = { courseTitle: string; version: number; questions: QuestionStat[]; modules: ModuleStat[]; attempts: number; practice: PracticeStat[] } | null;

/**
 * Course-improvement statistics for one version: per question and per module, from submitted exam attempts and module time. Counts
 * only (no person, no score of anyone); a group under five people is hidden in `studio-stats.ts`. Needs `learn.manage_content`.
 */
export async function getCourseStats(slug: string, version: number): Promise<CourseStats> {
  const user = await requireUser();
  await authorize(user, "learn.manage_content");
  if (!Number.isInteger(version) || version < 1) return null;
  const loaded = await loadVersion(db, slug, version);
  if (!loaded) return null;
  const versionId = loaded.version.id;

  const wrong = sql`array(select s from unnest(coalesce(an.selected_ids, '{}'::text[])) s order by s) <> array(select s from unnest(q.correct_ids) s order by s)`;
  const qrows = (await db.execute(sql`
    select q.id::text as id, q.module_key, q.topic, q.stem,
           count(distinct x.user_id)::int as people, count(*)::int as shown, count(*) filter (where ${wrong})::int as missed
    from learn.questions q
    join learn.exam_attempt_items i on i.question_id = q.id
    join learn.exam_attempts x on x.id = i.attempt_id and x.status = 'submitted'
    left join learn.exam_answers an on an.attempt_id = i.attempt_id and an.question_id = q.id
    where q.version_id = ${versionId}
    group by q.id, q.module_key, q.topic, q.stem`)) as unknown as { id: string; module_key: string; topic: string; stem: string; people: number; shown: number; missed: number }[];

  const mrows = (await db.execute(sql`
    select m.module_key,
      (select count(distinct c.user_id)::int from learn.module_completions c join learn.assignments a on a.id = c.assignment_id
        where a.version_id = ${versionId} and c.module_key = m.module_key) as people,
      (select avg(t.secs) / 60.0 from (select sum(mt.seconds) as secs from learn.module_time mt join learn.assignments a on a.id = mt.assignment_id
        where a.version_id = ${versionId} and mt.module_key = m.module_key group by mt.assignment_id) t)::float as avg_minutes,
      (select count(*)::int from learn.questions q join learn.exam_attempt_items i on i.question_id = q.id
        join learn.exam_attempts x on x.id = i.attempt_id and x.status = 'submitted' where q.version_id = ${versionId} and q.module_key = m.module_key) as answered,
      (select count(*)::int from learn.questions q join learn.exam_attempt_items i on i.question_id = q.id
        join learn.exam_attempts x on x.id = i.attempt_id and x.status = 'submitted'
        left join learn.exam_answers an on an.attempt_id = i.attempt_id and an.question_id = q.id
        where q.version_id = ${versionId} and q.module_key = m.module_key and ${wrong}) as missed,
      (select count(distinct x.user_id)::int from learn.questions q join learn.exam_attempt_items i on i.question_id = q.id
        join learn.exam_attempts x on x.id = i.attempt_id and x.status = 'submitted' where q.version_id = ${versionId} and q.module_key = m.module_key) as people_answered
    from learn.version_modules m where m.version_id = ${versionId} order by m.position`)) as unknown as { module_key: string; people: number; avg_minutes: number | null; answered: number; missed: number; people_answered: number }[];

  const titles = new Map(loaded.content.modules.map((m) => [m.key, m.title]));
  const [{ n: attempts }] = (await db.execute(sql`select count(*)::int as n from learn.exam_attempts x join learn.assignments a on a.id = x.assignment_id where a.version_id = ${versionId} and x.status = 'submitted'`)) as unknown as { n: number }[];
  const prows = (await db.execute(sql`
    select quarter, count(*)::int as people, count(*) filter (where correct)::int as correct
    from learn.drill_results where course_slug = ${slug} group by quarter`)) as unknown as { quarter: string; people: number; correct: number }[];
  return {
    practice: practiceStats(prows),
    courseTitle: loaded.content.title ?? slug,
    version,
    attempts,
    questions: questionStats(qrows.map((r) => ({ id: r.id, moduleKey: r.module_key, topic: r.topic, stem: r.stem, people: r.people, shown: r.shown, missed: r.missed }))),
    modules: moduleStats(mrows.map((r) => ({ key: r.module_key, title: titles.get(r.module_key) ?? r.module_key, people: r.people, avgMinutes: r.avg_minutes, answered: r.answered, missed: r.missed, peopleAnswered: r.people_answered }))),
  };
}
