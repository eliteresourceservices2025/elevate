# 14 The graded mock call

**Status:** built (2026-10-23): migrations 0097 and 0098, the Learn screens, publishing and retention, with tests. No course has a call pool yet; the Customer Service course will bring the first one. Decisions with the owner (2026-10-23): the caller is text with a Listen button
(the browser's built-in read-aloud, no audio files); the learner replies by picking from choices; the call and the exam must
each be passed at 85%, separately; 3 tries each; three calls drawn per attempt from a pool of five (always at least one medical).

## What it is

A simulated phone call inside the Learn app, scored on the server like the exam. The learner sees a softphone window and a
customer record, hears (or reads) the caller, picks a reply, sees the caller answer and the mood meter move, and at the end
builds a short call note. Three calls make one attempt. The score and the answer key stay in the database.

It is a **practice of choices**, not a recording: no microphone, no audio is captured or stored, nothing the learner types is
scored. Read-aloud runs inside the browser and sends nothing anywhere.

## Rules

| Rule | Value |
| --- | --- |
| Unlocks | When every module of the track is complete (same as the exam; either can be taken first) |
| Calls per attempt | 3, drawn from the version's pool, unseen first, at least one marked medical |
| Pass mark | 85% of the points on offer across the 3 calls |
| Tries / wait | 3, then HR grants more with a reason (existing `retry_grants`); 1 hour after a fail |
| Certificate | Needs the exam passed AND the call passed. Courses without calls are unchanged |
| Time limit | None |
| Visibility | The person and HR see scores and category percentages; leads see only passed / not yet |
| After a pass | Each step shows the best reply and why. After a fail: only the six category percentages, never the key |

## Scoring

Each caller turn belongs to one category: opening and tone, listening and empathy, accuracy and confidentiality, resolution and
next steps, de-escalation, documentation. Every reply carries 0 to 3 points (3 best, 0 harmful). The final call note is a set of
slots with the same points. A call's score is points earned over the best possible; an attempt's score is the same across its
three calls. The category percentages show where points were lost. The mood meter is feedback only; it does not decide the score.

## Data (new migration; `learn` schema; RLS on; no public policies)

- `call_scenarios`: per course version, like `questions`. Public columns only reach `learn_app`: key, title, module key, medical
  flag, intro, record (title and rows), and the steps with caller text and the reply texts. No points, no mood changes, no reasons.
- `call_scenario_keys`: no grant to `learn_app`. Per step and reply: points, category, mood change, the caller's answer, the reason.
- `call_attempts`: assignment, user, attempt number, the three scenario ids in order, status, started and submitted times, score,
  passed, category scores. Same guard as `exam_attempts` (no edits after submission).
- `call_attempt_steps`: insert-only. Attempt, scenario, step, chosen option, points, mood after, answered time.
- Courses get `requires_call` (default false). `exam_config.call` holds `passPercent`, `scenarios`, `maxTries`, `waitMinutesAfterFail`.

## Functions (SECURITY DEFINER, each granted to `learn_app` on purpose)

- `start_call(user, assignment)`: checks modules, tries, wait; draws the calls; returns the attempt id (or the open one).
- `answer_call_step(user, attempt, scenario, step, option)`: steps must come in order; records the choice; returns only the caller's
  answer text, the new mood and whether the call is finished. Never points or the best option.
- `grade_call(user, attempt)`: totals, category scores, passed; then `finish_if_complete(assignment)`.
- `call_review(user, attempt)`: what the person may see after an attempt (rules above).
- `finish_if_complete(assignment)`: the one place an assignment becomes `passed` (exam passed and, when the course requires it,
  call passed). `grade_attempt` and the acceptance function call it instead of setting the status themselves.

## Learn app

A `/call/[attemptId]` page with a `CallRunner` (the Workstation window, the mood meter, a Listen button using the browser's
speech synthesis, hidden when the browser has none), results with the six category bars, and a Mock call card on the course page
next to the exam. Same handler pattern, rate limits and "browser is never trusted" rules as the exam. Reuses the lesson stage.

## Content

A `CallSeed` schema (Zod) and a `calls` bank per course, written in code like the exam questions and published with the version.
A content lint checks every call: each caller step has exactly one 3-point reply and a 0-point reply, the categories are valid,
the medical flag is set on at least two, names and details are invented, and no markup or real-looking identifiers appear.
Studio editing of calls is **not** in this first release, and the studio does not list them either; authors edit the course files. A later release adds studio support.

## Out of scope for this release

Recorded learner replies, typed replies, an AI customer, and studio editing of calls. (Caller audio was added after this release; see
"Read-aloud audio" below.)

## Tests

Zod and content lint (unit); the scoring, ordering, "answer key never returned", tries and wait rules and the pass gate (real
Postgres integration tests, as for the exam); a response-inspection test that no call response carries key fields; the runner
(render tests and a browser check). Retention follows the exam: results 6 years, per-step answers 12 months (added to the same job).

## Read-aloud audio (calls and exam)

A **Listen** button reads aloud each caller line, the caller's reply after the learner answers, and every exam question with its choices.

- **Clips are made ahead of time** with VoiceStudio on this computer, never at run time: `pnpm exec tsx scripts/learn-voice-texts.mts` (in
  `apps/elevate`) lists them, then `node customer-service/make-voice.cjs` (in `tools/recap-video`) makes the files in `apps/learn/media/voice`
  and the list in `apps/learn/src/content/voice-index.json`. 495 clips: 19 caller lines, 59 replies, 411 exam lines, 6 "Option A" clips.
- **A clip is named by a hash of its exact text** (`src/lib/voice.ts`). The name says nothing about the answer, and a reply's clip cannot be
  guessed before the reply is shown (it is shown only after the step is answered). Change a line and its clip no longer matches:
  `src/lib/voice.test.ts` fails until the clip is made again.
- **Served only to a signed-in person** by `/api/voice/[file]` (same handler as the videos, `src/lib/recap-media.ts`). Where a clip is
  missing the button falls back to the browser's own speech.
- **Exam audio** is one calm voice: the stem, then "Option A", its choice, and so on in the order shown (choices are shuffled each try, so
  each choice is its own clip). It never reads the reason or the answer.
- **Callers** are five invented people, each with a designed voice (age, gender, pitch, American accent). Tone comes from **pitch and
  pace** (angry: higher and faster; worried: higher; relieved: slower). The installed engine (OmniVoice) cannot act an emotion. IndexTTS 2.5
  can, but took over ten minutes per clip on this CPU-only computer (about 13 GB), so it was tried and uninstalled. If a faster machine
  with a GPU is available, regenerate the caller clips with it (`make-voice.cjs` has the hook for another engine).
