import type { CourseContent, CourseModule } from "../content/schema";
import { drillFor, quarterOf, type Drill } from "../content/drills";
import { withUser, type Sql } from "./db";
import { letterUrl, voiceUrl } from "./voice";

// What the pages read. Every query runs as the signed-in person (row-level security keyed on learn.user_id), so even a mistake here
// cannot return another person's rows. Nothing here can read the exam answer key: the app role has no grant on it.

export type CallConfig = { passPercent: number; scenarios: number; maxTries: number; waitMinutesAfterFail: number };
export type ExamConfig = { passPercent: number; maxTries: number; waitMinutesAfterFail: number; renewalMonths: number; tracks: Record<string, { questions: number; minutes?: number }>; call?: CallConfig };

export type AssignmentSummary = { id: string; title: string; slug: string; track: string; status: string; dueOn: string; isUpdate: boolean };

/** The home list. A cancelled assignment (a retired version nobody finished) is history and shows only in My training record. */
export async function listAssignments(sql: Sql, userId: string): Promise<AssignmentSummary[]> {
  return withUser(sql, userId, async (tx) => {
    const rows = await tx`
      select a.id, c.title, c.slug, a.track, a.status, a.reason, a.due_on::text as due_on
      from learn.assignments a join learn.courses c on c.id = a.course_id
      where a.status <> 'cancelled'
      order by a.assigned_at desc`;
    return rows.map((r) => ({ id: r.id as string, title: r.title as string, slug: r.slug as string, track: r.track as string, status: r.status as string, dueOn: r.due_on as string, isUpdate: r.reason === "update" }));
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
  assignment: { id: string; courseTitle: string; courseSlug: string; track: string; status: string; dueOn: string; isUpdate: boolean; accepted: boolean };
  modules: ModuleState[];
  allModulesDone: boolean;
  exam: { questions: number; minutes: number | null; passPercent: number; triesAllowed: number; attempts: AttemptSummary[]; openAttemptId: string | null; waitUntil: string | null; waitMinutes: number };
  /** The graded mock call, only for a course that requires one (docs/learn/14-mock-call.md). */
  call: CallOverview | null;
  certificate: { reference: string; holderName: string; issuedOn: string; endsOn: string; revoked: boolean } | null;
  attestation: { version: string; text: string };
  /** False for an acknowledgment-only course: every module read and the statement accepted finishes it. */
  requiresExam: boolean;
};

export async function getOverview(sql: Sql, userId: string, assignmentId: string): Promise<Overview | null> {
  if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) return null;
  return withUser(sql, userId, async (tx) => {
    const [a] = await tx`
      select a.id, a.track, a.status, a.reason, a.due_on::text as due_on, a.version_id, c.title as course_title, c.slug as course_slug, c.requires_exam, c.requires_call, v.exam_config, v.content
      from learn.assignments a join learn.courses c on c.id = a.course_id join learn.course_versions v on v.id = a.version_id
      where a.id = ${assignmentId}`;
    if (!a) return null;
    const config = a.exam_config as ExamConfig;
    const content = a.content as CourseContent;

    const mods = await tx`
      select m.module_key, m.title, m.position, m.estimated_minutes, learn.assignment_min_seconds(${assignmentId}::uuid, m.module_key) as min_seconds, m.screen_count, learn.update_screen_indexes(${assignmentId}::uuid, m.module_key) as only_screens,
             exists (select 1 from learn.module_completions c where c.assignment_id = ${assignmentId} and c.module_key = m.module_key) as completed,
             coalesce((select sum(t.seconds) from learn.module_time t where t.assignment_id = ${assignmentId} and t.module_key = m.module_key), 0)::int as seconds
      from learn.assignment_modules(${assignmentId}::uuid) m
      order by m.position`;
    let earlierDone = true;
    const modules: ModuleState[] = mods.map((m) => {
      const summary = content.modules.find((x) => x.key === m.module_key)?.summary ?? "";
      const state: ModuleState = {
        key: m.module_key as string,
        title: m.title as string,
        summary,
        position: m.position as number,
        // an update teaches only the new or changed screens, so it shows their number and their share of the time
        estimatedMinutes: m.only_screens ? Math.max(1, Math.ceil(((m.estimated_minutes as number) * (m.only_screens as number[]).length) / Math.max(1, m.screen_count as number))) : (m.estimated_minutes as number),
        minSeconds: m.min_seconds as number,
        screenCount: m.only_screens ? (m.only_screens as number[]).length : (m.screen_count as number),
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
    const trackConfig = config.tracks[a.track as string] ?? { questions: 0 };
    // An update asks the count set when it was assigned (already the smaller of 5 and what its changed modules can supply). The app role cannot
    // read the question bank, so it is not counted here.
    const [scope] = await tx`select s.question_count::int as questions from learn.update_scopes s where s.assignment_id = ${assignmentId}`;
    const [acc] = await tx`select exists (select 1 from learn.attestations where assignment_id = ${assignmentId}) as accepted`;

    const [cert] = await tx`
      select c.reference, c.holder_name, c.issued_on::text as issued_on, c.ends_on::text as ends_on,
             exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id) as revoked
      from learn.certificates c where c.assignment_id = ${assignmentId}`;

    const call = a.requires_call && a.reason !== "update" && config.call ? await callOverview(tx, assignmentId, config.call) : null;

    return {
      assignment: { id: a.id as string, courseTitle: a.course_title as string, courseSlug: a.course_slug as string, track: a.track as string, status: a.status as string, dueOn: a.due_on as string, isUpdate: a.reason === "update", accepted: acc.accepted as boolean },
      modules,
      allModulesDone: modules.length > 0 && modules.every((m) => m.completed),
      exam: {
        questions: scope ? (scope.questions as number) : trackConfig.questions,
        minutes: trackConfig.minutes ?? null,
        passPercent: config.passPercent,
        triesAllowed: config.maxTries + (grants.tries as number),
        attempts,
        openAttemptId: attempts.find((x) => x.status === "in_progress")?.id ?? null,
        waitUntil: waitUntil && waitUntil.getTime() > Date.now() ? waitUntil.toISOString() : null,
        waitMinutes: waitUntil && waitUntil.getTime() > Date.now() ? Math.ceil((waitUntil.getTime() - Date.now()) / 60000) : 0,
      },
      certificate: cert ? { reference: cert.reference as string, holderName: cert.holder_name as string, issuedOn: cert.issued_on as string, endsOn: cert.ends_on as string, revoked: cert.revoked as boolean } : null,
      call,
      attestation: content.attestation,
      requiresExam: a.requires_exam as boolean,
    } satisfies Overview;
  });
}

export type CallAttemptSummary = { id: string; attemptNo: number; status: string; submittedAt: string | null; scorePercent: number | null; passed: boolean | null };
export type CallOverview = {
  scenarios: number;
  passPercent: number;
  triesAllowed: number;
  attempts: CallAttemptSummary[];
  openAttemptId: string | null;
  waitUntil: string | null;
  waitMinutes: number;
};

async function callOverview(tx: Sql, assignmentId: string, config: CallConfig): Promise<CallOverview> {
  const attempts = (await tx`
    select id, attempt_no, status, submitted_at, score_percent::float as score, passed
    from learn.call_attempts where assignment_id = ${assignmentId} order by attempt_no`).map((r) => ({
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
  const waiting = waitUntil !== null && waitUntil.getTime() > Date.now();
  return {
    scenarios: config.scenarios ?? 3,
    passPercent: config.passPercent,
    triesAllowed: (config.maxTries ?? 3) + (grants.tries as number),
    attempts,
    openAttemptId: attempts.find((x) => x.status === "in_progress")?.id ?? null,
    waitUntil: waiting ? waitUntil.toISOString() : null,
    waitMinutes: waiting ? Math.ceil((waitUntil.getTime() - Date.now()) / 60000) : 0,
  };
}

export type CallStepView = { kind: "caller" | "note"; id: string; text: string; /** The caller's line spoken ahead of time, when a clip exists. */ audio: string | null; choices: { id: string; text: string }[] };
export type CallScenarioView = {
  id: string;
  title: string;
  intro: string;
  record: { title: string; rows: { label: string; value: string }[] } | null;
  startMood: number;
  steps: CallStepView[];
  /** What the person picked so far and the mood after it (never the points). */
  answered: { stepId: string; optionId: string; moodAfter: number }[];
};
export type CallView = {
  id: string;
  assignmentId: string;
  status: string;
  scenarios: CallScenarioView[];
  result: { scorePercent: number; passed: boolean; categories: Record<string, number> } | null;
  /** After a PASSED attempt only: every step with the pick, the best reply and the reason. */
  review: { scenarioId: string; stepId: string; chosen: string; best: string; points: number; maxPoints: number; why: string }[];
  config: { passPercent: number; maxTries: number };
};

/** One mock-call attempt for the runner and the result page, or null when it is not the person's. The key is never read. */
export async function getCallView(sql: Sql, userId: string, attemptId: string): Promise<CallView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
  return withUser(sql, userId, async (tx) => {
    const [x] = await tx`
      select c.id, c.assignment_id, c.status, c.scenario_ids, c.score_percent::float as score, c.passed, c.category_scores, v.exam_config
      from learn.call_attempts c join learn.assignments a on a.id = c.assignment_id join learn.course_versions v on v.id = a.version_id
      where c.id = ${attemptId}`;
    if (!x) return null;
    const config = (x.exam_config as ExamConfig).call ?? { passPercent: 85, scenarios: 3, maxTries: 3, waitMinutesAfterFail: 60 };
    const ids = x.scenario_ids as string[];
    const rows = await tx`select id, title, intro, start_mood, record, steps from learn.call_scenarios where id = any(${ids}::uuid[])`;
    const picks = await tx`select scenario_id, step_id, option_id, mood_after from learn.call_attempt_steps where attempt_id = ${attemptId} order by answered_at, step_id`;
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    const scenarios: CallScenarioView[] = ids.flatMap((id) => {
      const r = byId.get(id);
      if (!r) return [];
      const steps = (r.steps as { kind: "caller" | "note"; id: string; caller?: string; label?: string; choices: { id: string; text: string }[] }[]).map((s) => ({
        kind: s.kind,
        id: s.id,
        text: (s.kind === "caller" ? s.caller : s.label) ?? "",
        audio: s.kind === "caller" ? voiceUrl(s.caller ?? "") : null,
        choices: s.choices.map((c) => ({ id: c.id, text: c.text })),
      }));
      return [
        {
          id,
          title: r.title as string,
          intro: r.intro as string,
          record: (r.record as CallScenarioView["record"]) ?? null,
          startMood: r.start_mood as number,
          steps,
          answered: picks.filter((p) => p.scenario_id === id).map((p) => ({ stepId: p.step_id as string, optionId: p.option_id as string, moodAfter: p.mood_after as number })),
        },
      ];
    });

    let review: CallView["review"] = [];
    if (x.status === "submitted" && x.passed === true) {
      const r = await tx`select * from learn.call_review(${userId}::uuid, ${attemptId}::uuid)`;
      review = r.map((row) => ({ scenarioId: row.scenario_id as string, stepId: row.step_id as string, chosen: row.chosen as string, best: row.best as string, points: row.points as number, maxPoints: row.max_points as number, why: row.why as string }));
    }
    return {
      id: x.id as string,
      assignmentId: x.assignment_id as string,
      status: x.status as string,
      scenarios,
      result: x.status === "submitted" ? { scorePercent: x.score as number, passed: x.passed as boolean, categories: (x.category_scores as Record<string, number>) ?? {} } : null,
      review,
      config: { passPercent: config.passPercent, maxTries: config.maxTries },
    } satisfies CallView;
  });
}

export type ModuleView = {
  assignmentId: string;
  /** The course's address (for example hipaa): the optional recap video is looked up by course and module. */
  courseSlug: string;
  /** The version number the person is on (a recap is only offered for versions its words were written for). */
  version: number;
  module: CourseModule;
  /** For an update: the indexes of the screens that are new or changed, which are the only ones the person learns. Null = the whole module. */
  onlyScreens: number[] | null;
  seenScreens: number[];
  seconds: number;
  minSeconds: number;
  completed: boolean;
  /** True when a PASSED course is read again: the player records nothing (no screens, no time) and does not wait for answers. */
  review: boolean;
  nextModule: { key: string; title: string } | null;
};

/**
 * One module for the player, or null when it does not exist, is not on the person's track or is still locked. A passed course can be
 * read again (review): every module is open, and nothing about the visit is recorded.
 */
export async function getModuleView(sql: Sql, userId: string, assignmentId: string, key: string): Promise<ModuleView | null> {
  const overview = await getOverview(sql, userId, assignmentId);
  if (!overview) return null;
  const review = overview.assignment.status === "passed";
  if (!review && !["assigned", "in_progress"].includes(overview.assignment.status)) return null;
  const index = overview.modules.findIndex((m) => m.key === key);
  if (index < 0 || (overview.modules[index].locked && !review)) return null;
  const state = overview.modules[index];
  return withUser(sql, userId, async (tx) => {
    const [a] = await tx`select v.content, v.version, c.slug from learn.assignments a join learn.course_versions v on v.id = a.version_id join learn.courses c on c.id = a.course_id where a.id = ${assignmentId}`;
    const found = (a.content as CourseContent).modules.find((m) => m.key === key);
    if (!found) return null;
    const seen = await tx`select screen_index from learn.module_screens where assignment_id = ${assignmentId} and module_key = ${key} order by screen_index`;
    const [scoped] = await tx`select learn.update_screen_indexes(${assignmentId}::uuid, ${key}) as idx`;
    const onlyScreens = (scoped?.idx as number[] | null) ?? null;
    const next = overview.modules[index + 1];
    return {
      assignmentId,
      courseSlug: a.slug as string,
      version: a.version as number,
      module: found,
      onlyScreens,
      seenScreens: seen.map((r) => r.screen_index as number),
      seconds: state.seconds,
      minSeconds: state.minSeconds,
      completed: state.completed,
      review,
      nextModule: next ? { key: next.key, title: next.title } : null,
    } satisfies ModuleView;
  });
}

/** Clips that read an exam question and its choices aloud, in the order shown: the stem, then "Option A" and the choice, and so on. Null where none was made. */
export type ExamAudio = { stem: string | null; options: { letter: string | null; text: string | null }[] };
export type ExamItem = { position: number; questionId: string; type: string; stem: string; options: { id: string; text: string }[]; selected: string[]; audio: ExamAudio };

export type AttemptView = {
  id: string;
  assignmentId: string;
  status: string;
  /** Null when the exam has no time limit. */
  deadlineAt: string | null;
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
        const shown = (r.option_order as string[]).map((id) => ({ id, text: byId.get(id) ?? "" }));
        return {
          position: r.position as number,
          questionId: r.question_id as string,
          type: r.type as string,
          stem: r.stem as string,
          options: shown,
          selected: r.selected as string[],
          audio: { stem: voiceUrl(r.stem as string), options: shown.map((o, i) => ({ letter: letterUrl(i), text: voiceUrl(o.text) })) },
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
      deadlineAt: x.deadline_at ? (x.deadline_at as Date).toISOString() : null,
      serverNow: (x.server_now as Date).toISOString(),
      total: x.total_count as number,
      result: x.status === "submitted" ? { scorePercent: x.score as number, correct: x.correct_count as number, passed: x.passed as boolean } : null,
      items,
      review,
      tracks: { passPercent: config.passPercent, maxTries: config.maxTries },
    } satisfies AttemptView;
  });
}

export type RecordEntry = {
  assignmentId: string;
  courseTitle: string;
  courseSlug: string;
  track: string;
  status: string;
  assignedOn: string;
  dueOn: string;
  passedOn: string | null;
  /** Active reading time on the modules, in minutes (as credited by the server). */
  minutesSpent: number;
  attempts: number;
  /** The score of the passing try (the person's own score: it is theirs to see). */
  scorePercent: number | null;
  /** The newest certificate for this course, even from an earlier round (a renewal in progress must not hide a valid certificate). */
  certificate: { assignmentId: string; reference: string; issuedOn: string; endsOn: string; revoked: boolean } | null;
};

/**
 * The person's training, newest first: ONE entry per course (the current round) with its newest certificate. Earlier rounds and older
 * course versions stay in the database as evidence for HR and the privacy team, but the learner is not shown them, and no version number.
 */
export async function getRecord(sql: Sql, userId: string): Promise<RecordEntry[]> {
  return withUser(sql, userId, async (tx) => {
    const rows = await tx`
      select distinct on (a.course_id) a.id, co.title, co.slug, a.track, a.status, a.assigned_at::date::text as assigned_on, a.due_on::text as due_on,
             a.passed_at::date::text as passed_on,
             coalesce((select sum(t.seconds) from learn.module_time t where t.assignment_id = a.id), 0)::int as seconds,
             (select count(*) from learn.exam_attempts x where x.assignment_id = a.id and x.status = 'submitted')::int as attempts,
             (select x.score_percent::float from learn.exam_attempts x where x.assignment_id = a.id and x.passed order by x.attempt_no desc limit 1) as score,
             c.assignment_id as cert_assignment_id, c.reference, c.issued_on::text as issued_on, c.ends_on::text as ends_on,
             exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id) as revoked
      from learn.assignments a
      join learn.courses co on co.id = a.course_id
      left join lateral (
        select c2.id, c2.assignment_id, c2.reference, c2.issued_on, c2.ends_on
        from learn.certificates c2 join learn.assignments a2 on a2.id = c2.assignment_id
        where a2.course_id = a.course_id
        order by c2.issued_on desc, c2.ends_on desc limit 1
      ) c on true
      where a.status <> 'cancelled'
      order by a.course_id, (a.reason = 'update'), a.assigned_at desc`;
    return rows
      .map((r) => ({
        assignmentId: r.id as string,
        courseTitle: r.title as string,
        courseSlug: r.slug as string,
        track: r.track as string,
        status: r.status as string,
        assignedOn: r.assigned_on as string,
        dueOn: r.due_on as string,
        passedOn: (r.passed_on as string | null) ?? null,
        minutesSpent: Math.round((r.seconds as number) / 60),
        attempts: r.attempts as number,
        scorePercent: (r.score as number | null) ?? null,
        certificate: r.reference ? { assignmentId: r.cert_assignment_id as string, reference: r.reference as string, issuedOn: r.issued_on as string, endsOn: r.ends_on as string, revoked: r.revoked as boolean } : null,
      }))
      .sort((x, y) => (x.assignedOn < y.assignedOn ? 1 : x.assignedOn > y.assignedOn ? -1 : 0));
  });
}

// ---- Quick-reference cards and quarterly practice (Release 3) --------------------------------------------------------------------

export type CardModule = { key: string; title: string; keyPoints: string[] };
export type CourseCards = { courseSlug: string; courseTitle: string; modules: CardModule[] };

/** The key points of every module in the person's own track, per course they have (not cancelled), from the version they were assigned. */
export async function getCards(sql: Sql, userId: string): Promise<CourseCards[]> {
  return withUser(sql, userId, async (tx) => {
    const rows = await tx`
      select distinct on (a.course_id) a.course_id, c.slug, c.title, a.version_id, a.track, v.content
      from learn.assignments a join learn.courses c on c.id = a.course_id join learn.course_versions v on v.id = a.version_id
      where a.status <> 'cancelled' order by a.course_id, a.assigned_at desc`;
    const out: CourseCards[] = [];
    for (const r of rows) {
      const keys = await tx`select module_key from learn.track_modules(${r.version_id as string}::uuid, ${r.track as string}) order by position`;
      const content = r.content as CourseContent;
      const modules = keys
        .map((k) => content.modules.find((m) => m.key === (k.module_key as string)))
        .filter((m): m is CourseContent["modules"][number] => Boolean(m))
        .map((m) => ({ key: m.key, title: m.title, keyPoints: m.keyPoints }));
      out.push({ courseSlug: r.slug as string, courseTitle: r.title as string, modules });
    }
    return out.sort((x, y) => x.courseTitle.localeCompare(y.courseTitle));
  });
}

export type PracticeItem = {
  courseSlug: string;
  courseTitle: string;
  quarter: string;
  drill: Drill;
  answered: { choice: string; correct: boolean } | null;
};

/** This quarter's drill for each course the person has (not cancelled), with their answer when they already gave one. */
export async function getPractice(sql: Sql, userId: string, now: Date = new Date()): Promise<PracticeItem[]> {
  const quarter = quarterOf(now);
  return withUser(sql, userId, async (tx) => {
    const courses = await tx`
      select distinct c.slug, c.title from learn.assignments a join learn.courses c on c.id = a.course_id where a.status <> 'cancelled' order by c.title`;
    const answers = await tx`select course_slug, choice, correct from learn.drill_results where quarter = ${quarter}`;
    const items: PracticeItem[] = [];
    for (const c of courses) {
      const drill = drillFor(c.slug as string, quarter);
      if (!drill) continue;
      const mine = answers.find((a) => a.course_slug === c.slug);
      items.push({ courseSlug: c.slug as string, courseTitle: c.title as string, quarter, drill, answered: mine ? { choice: mine.choice as string, correct: mine.correct as boolean } : null });
    }
    return items;
  });
}
