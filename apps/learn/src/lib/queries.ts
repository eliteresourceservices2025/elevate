import type { CourseContent, CourseModule } from "../content/schema";
import { withUser, type Sql } from "./db";

// What the pages read. Every query runs as the signed-in person (row-level security keyed on learn.user_id), so even a mistake here
// cannot return another person's rows. Nothing here can read the exam answer key: the app role has no grant on it.

export type ExamConfig = { passPercent: number; maxTries: number; waitMinutesAfterFail: number; renewalMonths: number; tracks: Record<string, { questions: number; minutes: number }> };

export type AssignmentSummary = { id: string; title: string; track: string; status: string; dueOn: string };

export async function listAssignments(sql: Sql, userId: string): Promise<AssignmentSummary[]> {
  return withUser(sql, userId, async (tx) => {
    const rows = await tx`
      select a.id, c.title, a.track, a.status, a.due_on::text as due_on
      from learn.assignments a join learn.courses c on c.id = a.course_id
      order by a.assigned_at desc`;
    return rows.map((r) => ({ id: r.id as string, title: r.title as string, track: r.track as string, status: r.status as string, dueOn: r.due_on as string }));
  });
}

export type ModuleState = {
  key: string;
  title: string;
  summary: string;
  position: number;
  estimatedMinutes: number;
  minSeconds: number;
  screenCount: number;
  completed: boolean;
  seconds: number;
  locked: boolean;
};

export type AttemptSummary = { id: string; attemptNo: number; status: string; submittedAt: string | null; scorePercent: number | null; passed: boolean | null };

export type Overview = {
  assignment: { id: string; courseTitle: string; track: string; status: string; dueOn: string };
  modules: ModuleState[];
  allModulesDone: boolean;
  exam: { questions: number; minutes: number; passPercent: number; triesAllowed: number; attempts: AttemptSummary[]; openAttemptId: string | null; waitUntil: string | null; waitMinutes: number };
  certificate: { reference: string; holderName: string; issuedOn: string; endsOn: string; revoked: boolean } | null;
  attestation: { version: string; text: string };
};

export async function getOverview(sql: Sql, userId: string, assignmentId: string): Promise<Overview | null> {
  if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) return null;
  return withUser(sql, userId, async (tx) => {
    const [a] = await tx`
      select a.id, a.track, a.status, a.due_on::text as due_on, a.version_id, c.title as course_title, v.exam_config, v.content
      from learn.assignments a join learn.courses c on c.id = a.course_id join learn.course_versions v on v.id = a.version_id
      where a.id = ${assignmentId}`;
    if (!a) return null;
    const config = a.exam_config as ExamConfig;
    const content = a.content as CourseContent;

    const mods = await tx`
      select m.module_key, m.title, m.position, m.estimated_minutes, m.min_seconds, m.screen_count,
             exists (select 1 from learn.module_completions c where c.assignment_id = ${assignmentId} and c.module_key = m.module_key) as completed,
             coalesce((select sum(t.seconds) from learn.module_time t where t.assignment_id = ${assignmentId} and t.module_key = m.module_key), 0)::int as seconds
      from learn.track_modules(${a.version_id as string}::uuid, ${a.track as string}) m
      order by m.position`;
    let earlierDone = true;
    const modules: ModuleState[] = mods.map((m) => {
      const summary = content.modules.find((x) => x.key === m.module_key)?.summary ?? "";
      const state: ModuleState = {
        key: m.module_key as string,
        title: m.title as string,
        summary,
        position: m.position as number,
        estimatedMinutes: m.estimated_minutes as number,
        minSeconds: m.min_seconds as number,
        screenCount: m.screen_count as number,
        completed: m.completed as boolean,
        seconds: m.seconds as number,
        locked: !earlierDone,
      };
      earlierDone = earlierDone && state.completed;
      return state;
    });

    const attempts = (await tx`
      select id, attempt_no, status, submitted_at, score_percent::float as score, passed
      from learn.exam_attempts where assignment_id = ${assignmentId} order by attempt_no`).map((r) => ({
      id: r.id as string,
      attemptNo: r.attempt_no as number,
      status: r.status as string,
      submittedAt: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
      scorePercent: r.score as number | null,
      passed: r.passed as boolean | null,
    }));
    const [grants] = await tx`select coalesce(sum(extra_tries), 0)::int as tries from learn.retry_grants where assignment_id = ${assignmentId} and kind = 'tries'`;
    const lastFail = attempts.filter((x) => x.status === "submitted" && x.passed !== true).at(-1);
    const waitUntil = lastFail?.submittedAt ? new Date(Date.parse(lastFail.submittedAt) + (config.waitMinutesAfterFail ?? 60) * 60_000) : null;
    const trackConfig = config.tracks[a.track as string] ?? { questions: 0, minutes: 0 };

    const [cert] = await tx`
      select c.reference, c.holder_name, c.issued_on::text as issued_on, c.ends_on::text as ends_on,
             exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id) as revoked
      from learn.certificates c where c.assignment_id = ${assignmentId}`;

    return {
      assignment: { id: a.id as string, courseTitle: a.course_title as string, track: a.track as string, status: a.status as string, dueOn: a.due_on as string },
      modules,
      allModulesDone: modules.length > 0 && modules.every((m) => m.completed),
      exam: {
        questions: trackConfig.questions,
        minutes: trackConfig.minutes,
        passPercent: config.passPercent,
        triesAllowed: config.maxTries + (grants.tries as number),
        attempts,
        openAttemptId: attempts.find((x) => x.status === "in_progress")?.id ?? null,
        waitUntil: waitUntil && waitUntil.getTime() > Date.now() ? waitUntil.toISOString() : null,
        waitMinutes: waitUntil && waitUntil.getTime() > Date.now() ? Math.ceil((waitUntil.getTime() - Date.now()) / 60000) : 0,
      },
      certificate: cert ? { reference: cert.reference as string, holderName: cert.holder_name as string, issuedOn: cert.issued_on as string, endsOn: cert.ends_on as string, revoked: cert.revoked as boolean } : null,
      attestation: content.attestation,
    } satisfies Overview;
  });
}

export type ModuleView = {
  assignmentId: string;
  module: CourseModule;
  seenScreens: number[];
  seconds: number;
  minSeconds: number;
  completed: boolean;
  nextModule: { key: string; title: string } | null;
};

/** One module for the player, or null when it does not exist, is not on the person's track or is still locked. */
export async function getModuleView(sql: Sql, userId: string, assignmentId: string, key: string): Promise<ModuleView | null> {
  const overview = await getOverview(sql, userId, assignmentId);
  if (!overview || !["assigned", "in_progress"].includes(overview.assignment.status)) return null;
  const index = overview.modules.findIndex((m) => m.key === key);
  if (index < 0 || overview.modules[index].locked) return null;
  const state = overview.modules[index];
  return withUser(sql, userId, async (tx) => {
    const [a] = await tx`select v.content from learn.assignments a join learn.course_versions v on v.id = a.version_id where a.id = ${assignmentId}`;
    const found = (a.content as CourseContent).modules.find((m) => m.key === key);
    if (!found) return null;
    const seen = await tx`select screen_index from learn.module_screens where assignment_id = ${assignmentId} and module_key = ${key} order by screen_index`;
    const next = overview.modules[index + 1];
    return {
      assignmentId,
      module: found,
      seenScreens: seen.map((r) => r.screen_index as number),
      seconds: state.seconds,
      minSeconds: state.minSeconds,
      completed: state.completed,
      nextModule: next ? { key: next.key, title: next.title } : null,
    } satisfies ModuleView;
  });
}

export type ExamItem = { position: number; questionId: string; type: string; stem: string; options: { id: string; text: string }[]; selected: string[] };

export type AttemptView = {
  id: string;
  assignmentId: string;
  status: string;
  deadlineAt: string;
  serverNow: string;
  total: number;
  result: { scorePercent: number; correct: number; passed: boolean } | null;
  items: ExamItem[];
  review: { position: number; moduleKey: string; topic: string; moduleTitle: string; isCorrect: boolean; selectedIds: string[] | null; correctIds: string[] | null; rationale: string | null }[];
  tracks: { passPercent: number; maxTries: number };
};

export async function getAttemptView(sql: Sql, userId: string, attemptId: string): Promise<AttemptView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
  return withUser(sql, userId, async (tx) => {
    const [x] = await tx`
      select e.id, e.assignment_id, e.status, e.deadline_at, e.total_count, e.correct_count, e.score_percent::float as score, e.passed, v.exam_config, now() as server_now
      from learn.exam_attempts e join learn.assignments a on a.id = e.assignment_id join learn.course_versions v on v.id = a.version_id
      where e.id = ${attemptId}`;
    if (!x) return null;
    const config = x.exam_config as ExamConfig;

    let items: ExamItem[] = [];
    if (x.status === "in_progress") {
      const rows = await tx`
        select i.position, i.question_id, i.option_order, q.type, q.stem, q.options,
               coalesce((select an.selected_ids from learn.exam_answers an where an.attempt_id = i.attempt_id and an.question_id = i.question_id), '{}') as selected
        from learn.exam_attempt_items i join learn.questions q on q.id = i.question_id
        where i.attempt_id = ${attemptId} order by i.position`;
      items = rows.map((r) => {
        const byId = new Map((r.options as { id: string; text: string }[]).map((o) => [o.id, o.text]));
        return {
          position: r.position as number,
          questionId: r.question_id as string,
          type: r.type as string,
          stem: r.stem as string,
          options: (r.option_order as string[]).map((id) => ({ id, text: byId.get(id) ?? "" })),
          selected: r.selected as string[],
        };
      });
    }

    let review: AttemptView["review"] = [];
    if (x.status === "submitted") {
      const rows = await tx`select * from learn.attempt_review(${userId}::uuid, ${attemptId}::uuid)`;
      const titles = await tx`select m.module_key, m.title from learn.version_modules m join learn.assignments a on a.version_id = m.version_id where a.id = ${x.assignment_id as string}`;
      const title = new Map(titles.map((t) => [t.module_key as string, t.title as string]));
      review = rows.map((r) => ({
        position: r.item_position as number,
        moduleKey: r.module_key as string,
        topic: r.topic as string,
        moduleTitle: title.get(r.module_key as string) ?? (r.module_key as string),
        isCorrect: r.is_correct as boolean,
        selectedIds: r.selected_ids as string[] | null,
        correctIds: r.correct_ids as string[] | null,
        rationale: r.rationale as string | null,
      }));
    }

    return {
      id: x.id as string,
      assignmentId: x.assignment_id as string,
      status: x.status as string,
      deadlineAt: (x.deadline_at as Date).toISOString(),
      serverNow: (x.server_now as Date).toISOString(),
      total: x.total_count as number,
      result: x.status === "submitted" ? { scorePercent: x.score as number, correct: x.correct_count as number, passed: x.passed as boolean } : null,
      items,
      review,
      tracks: { passPercent: config.passPercent, maxTries: config.maxTries },
    } satisfies AttemptView;
  });
}
