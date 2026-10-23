# Graded Mock Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (the owner chose to build in this session, in small tested steps). Steps use checkbox (`- [ ]`) syntax. **Commit only when the owner says so.**

**Goal:** A server-scored simulated phone call (3 calls per attempt, picked replies, mood meter, read-aloud caller, call note) that must be passed at 85%, separately from the exam, before a course's certificate is issued.

**Architecture:** Mirrors the exam. Scenario text is public to `learn_app`; the scoring key lives in a table `learn_app` cannot read. Security-definer SQL functions start an attempt, record each pick, return only the caller's answer and mood, and grade at the end. One function, `learn.finish_if_complete`, decides when an assignment becomes `passed` (exam passed and, if the course requires it, call passed). The Learn app adds API actions, a `/call/[attemptId]` page with a `CallRunner`, and a course-page card.

**Tech Stack:** Postgres (Drizzle schema + hand-written SQL migration), Zod, Next.js 16 (Learn app), vitest, real-Postgres integration tests (`pnpm test:integration` in `apps/elevate`).

**Spec:** `docs/learn/14-mock-call.md`

## Global Constraints

- Answer key never reaches `learn_app`: no column grant on `call_scenario_keys`; no function returns points, the best option or reasons except `call_review` after a PASSED attempt.
- The browser is never trusted for score, user, order or "finished"; the server computes them.
- Evidence is append-only (`call_attempt_steps`); `call_attempts` cannot change after submission.
- Leads see only passed / not yet; scores are for the person, HR, the Privacy Officer.
- No patient data: scenario people and details are invented. No microphone, no audio stored, nothing typed is scored. Read-aloud uses the browser only.
- Pass mark 85% of points on offer; 3 calls per attempt from a pool, unseen first, at least one `medical`; 3 tries then HR grants more (`retry_grants`, kind `tries`); 1 hour wait after a fail; no time limit.
- Rubric categories (exactly): `opening`, `listening`, `accuracy`, `resolution`, `deescalation`, `documentation`. Reply points are integers 0 to 3.
- Retention: results 6 years, per-step answers 12 months (same job as exam answers).
- Every new `learn` function is granted to `learn_app` on purpose; every new table has RLS enabled and no public policy. No new dependency.
- Courses without calls behave exactly as today.

## Review Focus

- A step answered twice, out of order, or in a scenario not in the attempt: refused, nothing recorded twice.
- Another person's attempt id: `learn:not_found`, no information leaked.
- Pass order: exam passed first then call, and call first then exam, both end with the assignment `passed` exactly once.
- Double submit of `grade_call`: returns the stored result, never regrades.
- A pool with fewer than 3 scenarios or no medical scenario: a clear `learn:bank_too_small`, no half-made attempt.
- A browser without speech synthesis: the Listen button is absent and the call still works.
- A failed attempt's review contains category percentages only (no best option, no reasons).

## File Structure

- `apps/learn/src/content/schema.ts` (modify): `callSeedSchema`, `CallSeed`, `CALL_CATEGORIES`.
- `apps/learn/src/content/calls.ts` (create): `callsLint(calls)` pure checks shared by tests and publish.
- `apps/learn/src/content/index.ts` (modify): `CourseDefinition.calls?: CallSeed[]`.
- `apps/elevate/src/modules/learn/schema.ts` (modify): tables `callScenarios`, `callScenarioKeys`, `callAttempts`, `callAttemptSteps`; `courses.requiresCall`.
- `apps/elevate/drizzle/0097_*.sql`, `0098_learn_mock_call.sql` (create): generated tables, then hand-written functions, guards, grants.
- `apps/elevate/src/modules/learn/publish.ts` (modify): validate and write calls.
- `apps/learn/src/lib/api.ts`, `queries.ts` (modify): actions and views.
- `apps/learn/src/components/call-runner.tsx`, `listen-button.tsx` (create); `apps/learn/src/app/call/[attemptId]/page.tsx` (create); course page card (modify).
- `apps/elevate/src/modules/learn/jobs.ts` (modify): retention.
- Tests: `apps/learn/src/content/calls.test.ts`, `apps/elevate/tests/integration/learn-mock-call.test.ts`, component render tests.

---

### Task 1: Call content schema and lint

**Files:** Modify `apps/learn/src/content/schema.ts`, `index.ts`; Create `apps/learn/src/content/calls.ts`, `calls.test.ts`.

**Interfaces:**
- Produces: `CALL_CATEGORIES` (the six slugs, as a const tuple); `callSeedSchema` / `CallSeed` = `{ key, title, moduleKey, medical: boolean, intro, record?: {title, rows[{label,value}]}, startMood: number (10..90), steps: Array<CallerStep | NoteStep> }` where `CallerStep = { kind: "caller", id, caller, category, choices: Choice[2..4] }`, `NoteStep = { kind: "note", id, label, choices: Choice[2..4] }` (category is always `documentation`), `Choice = { id: "a".."d", text, points: 0..3, mood: -30..30, reply, why }`; `callsLint(calls: CallSeed[], moduleKeys: string[]): string[]` returns problems (empty = ok); `CourseDefinition.calls?`.

- [ ] **Step 1:** Write failing tests in `calls.test.ts`: a valid fixture parses; `callsLint` reports a step with no 3-point choice, one with two 3-point choices, no 0-point choice, duplicate scenario keys, an unknown `moduleKey`, fewer than 2 medical calls in a pool of 5 or more (pools under 5 need at least 1), text containing `<`, a web address or a US phone shape.
- [ ] **Step 2:** Run `pnpm --filter learn test calls` and see it fail.
- [ ] **Step 3:** Implement the schema and `callsLint` (reuse the text rules style of `content.test.ts`).
- [ ] **Step 4:** Run the learn tests; expect pass.

### Task 2: Database tables and functions

**Files:** Modify `apps/elevate/src/modules/learn/schema.ts`; Create migrations `0097`/`0098`; Test `apps/elevate/tests/integration/learn-mock-call.test.ts`.

**Interfaces:**
- Tables (all `learn` schema, RLS on): `call_scenarios(id, version_id→course_versions, key, title, module_key, medical, intro, record jsonb null, steps jsonb)` with `unique(version_id,key)`; `call_scenario_keys(scenario_id pk→call_scenarios, start_mood smallint, steps jsonb)` (`[{id,category,choices:[{id,points,mood,reply,why}]}]`); `call_attempts(id, assignment_id, user_id, attempt_no, status in_progress|submitted, scenario_ids uuid[3], started_at, submitted_at, score_percent numeric(5,2), passed bool, category_scores jsonb)` with the same done-check as `exam_attempts` and unique `(assignment_id, attempt_no)`; `call_attempt_steps(attempt_id, scenario_id, step_id, option_id, points smallint, mood_after smallint, answered_at)` primary key `(attempt_id, scenario_id, step_id)`, insert-only trigger; `courses.requires_call boolean default false`.
- Grants to `learn_app`: SELECT on `call_scenarios` public columns (not keys), own rows of `call_attempts` and `call_attempt_steps` (policy `user_id = learn.current_user_id()` via attempt), nothing on `call_scenario_keys`.
- Functions (security definer, `search_path = learn, pg_catalog, pg_temp`, EXECUTE to `learn_app`): `start_call(p_user uuid, p_assignment uuid) returns uuid`; `answer_call_step(p_user uuid, p_attempt uuid, p_scenario uuid, p_step text, p_option text) returns table(reply text, mood int, call_done boolean, attempt_done boolean)`; `grade_call(p_user uuid, p_attempt uuid) returns table(score_percent numeric, passed boolean, categories jsonb)`; `call_review(p_user uuid, p_attempt uuid) returns table(scenario_id uuid, step_id text, chosen text, best text, points int, max_points int, why text)` (zero rows unless the attempt passed); `finish_if_complete(p_assignment uuid) returns void` (not granted to `learn_app`). `grade_attempt` is re-created with its last `IF v_passed` line replaced by `PERFORM learn.finish_if_complete(x.assignment_id)`. `accept_and_certify` is unchanged (it already requires status `passed`).
- Rules: `start_call` needs all track modules complete, `exam_config.call` present (`learn:calls_not_configured`), returns an open attempt if one exists, enforces tries (`call.maxTries` + `retry_grants`) and wait (`call.waitMinutesAfterFail`, default 60) with the same error codes as `start_exam`, draws `call.scenarios` (default 3) with unseen first and at least one medical (`learn:bank_too_small` otherwise). `answer_call_step` requires the step to be the next unanswered one of the next unfinished scenario in `scenario_ids` order; mood = clamp(start_mood + sum of mood deltas so far, 0, 100). `finish_if_complete` sets `passed` when an exam attempt passed (or the course is exam-less) and (`requires_call` is false, or reason is `update`, or a call attempt passed) and the status is `in_progress`.

- [ ] **Step 1:** Update `schema.ts`; run `pnpm db:generate` for the table SQL; create the second migration with `pnpm --filter elevate exec drizzle-kit generate --custom --name=learn_mock_call` and write the functions, guards, grants and `grade_attempt` replacement (copy its body from `0054_learn_schema.sql`).
- [ ] **Step 2:** Write the failing integration tests (real DB, helper style of `learn.test.ts`): app role gets a permission error selecting `call_scenario_keys`; `answer_call_step` result has exactly the columns `reply, mood, call_done, attempt_done`; wrong order, repeat, foreign scenario and foreign user all raise; full run of 3 scenarios scores 100 with all best picks and fails with all zero picks; 84% fails and 85% passes at the boundary (use a fixture with 20 points); double `grade_call` returns the same row; tries and wait codes; `call_review` is empty after a fail and complete after a pass; pass order both ways ends `passed` once; a course with `requires_call = false` still passes on the exam alone; an `update` assignment ignores the call.
- [ ] **Step 3:** Run `pnpm test:integration -- learn-mock-call` and see failures, then run `pnpm db:migrate` locally and implement until they pass.
- [ ] **Step 4:** Run the full `pnpm test:integration` file set for learn (`learn*.test.ts`) to prove exam behaviour is unchanged.

### Task 3: Publish calls with a version

**Files:** Modify `apps/elevate/src/modules/learn/publish.ts`; Test in `apps/elevate/tests/integration/learn-mock-call.test.ts` (publish section).

**Interfaces:** Consumes `CallSeed`, `callsLint`. Produces `PublishResult.calls: number`; `publishCourse` accepts `course.calls?: CallSeed[]`; `replaceCalls(tx, versionId, calls)` writes `call_scenarios` (public parts) and `call_scenario_keys` (key parts); `checkCourse` also runs `callsLint`; a draft re-publish replaces calls like questions; a frozen published version never changes.

- [ ] **Step 1:** Failing tests: publishing a fixture course writes N scenarios and N keys with `requires_call` true and `exam_config.call` kept; `callsLint` problems abort publishing; a course with no calls publishes as before (`calls: 0`).
- [ ] **Step 2:** Implement; add `requires_call` to the course upsert (true when `calls` is non-empty).
- [ ] **Step 3:** Run the publish tests and `pnpm --filter elevate typecheck`.

### Task 4: Learn app API and views

**Files:** Modify `apps/learn/src/lib/api.ts`, `queries.ts`, error `MESSAGES` map; Test `apps/elevate/tests/integration/learn-mock-call.test.ts` (API section, using `handleApi` by relative path like `learn-handoff.test.ts`).

**Interfaces:** Actions `startCall {assignmentId}` → `{ok, attemptId}`; `answerCall {attemptId, scenarioId, stepId, optionId}` → `{ok, reply, mood, callDone, attemptDone}`; `submitCall {attemptId}` → `{ok, scorePercent, passed, categories}`. Queries `getCallView(sql, userId, attemptId): CallView | null` (in progress: scenarios with public steps and answered steps; submitted: result, categories, review when passed) and `getOverview` gains `call: {required, questions, passPercent, triesAllowed, attempts[]} | null`. New error messages for the new codes (same style as the exam's).

- [ ] **Step 1:** Failing tests: the three actions work end to end; **no JSON response from any call action or from `getCallView` in progress contains `points`, `best`, `why` or `correct`** (recursive key scan, like the exam's key-leak test); `wait_after_fail` returns `retryAt`; unsigned-in and foreign-user requests are refused.
- [ ] **Step 2:** Implement actions and queries (use `withUser` for reads, as `moduleSeconds` does).
- [ ] **Step 3:** Run the API tests and `pnpm --filter learn typecheck`.

### Task 5: Call runner, results page and course card

**Files:** Create `components/call-runner.tsx`, `components/listen-button.tsx`, `app/call/[attemptId]/page.tsx`; Modify `app/course/[assignmentId]/page.tsx`; Test `apps/learn/src/components/call-runner.test.ts` (render tests with `renderToStaticMarkup`).

**Interfaces:** Consumes `CallView`, `post` from `api-client`, `Workstation`, `Meter`, `celebrate`. `ListenButton({ text }: { text: string })` renders nothing when `window.speechSynthesis` is missing, otherwise reads `text` with `speechSynthesis.speak`, cancelling any earlier speech. `CallRunner` shows one scenario at a time in the Workstation (record beside the call), the caller line with Listen, the choices, the caller's reply and the mood meter after each pick, then the note steps, then submits and routes to the result. The results view shows score, pass or not yet, six category bars, tries left, and (passed only) the review. The course page shows a "Mock call" card beside the exam when `call.required`, unlocked with the exam, and says the certificate needs both.

- [ ] **Step 1:** Failing render tests: runner start state shows the first caller line and all choices but no key words; `ListenButton` renders empty without `speechSynthesis`; the results view for a failed attempt shows percentages and no review text; the course page card appears only when required.
- [ ] **Step 2:** Implement. Disable choices after picking until Continue; confirm leaving mid-call is safe (answers are saved per step, refresh resumes).
- [ ] **Step 3:** Run learn tests, lint, typecheck.
- [ ] **Step 4:** Browser check with the local database: seed a fixture course, take a call end to end (light and dark, phone width), confirm the Listen button works and refresh resumes.

### Task 6: Retention, docs and final verification

**Files:** Modify `apps/elevate/src/modules/learn/jobs.ts` (+ its test), `docs/modules/learn.md`, `docs/learn/14-mock-call.md` (status), `CLAUDE.md` Learn bullets (one line).

**Interfaces:** The existing exam-answer retention function also deletes `call_attempt_steps` older than 12 months (attempt summaries stay 6 years).

- [ ] **Step 1:** Failing test in the jobs integration test: a 13-month-old step is purged, a recent one and the attempt row stay.
- [ ] **Step 2:** Implement; update the docs (rules table, new functions, "calls are authored in code; studio shows them read-only" as a known limit).
- [ ] **Step 3:** Run `pnpm lint && pnpm typecheck && pnpm test`, `pnpm test:integration` (learn files), `pnpm --filter learn build`. Report failures verbatim.
- [ ] **Step 4:** Ask the owner before committing (they commit on request only). Do not push.

## Spec coverage check

Rules table → Tasks 2, 4; scoring/categories → Tasks 1, 2; data and functions → Task 2; Learn app → Tasks 4, 5; content and lint → Task 1, 3; out of scope items stay out; tests and retention → Tasks 2 to 6.
