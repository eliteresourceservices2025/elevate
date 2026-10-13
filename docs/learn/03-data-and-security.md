# 03 Data and security

Training records are personal data about identified people and are evidence in client audits. The rules below follow
ELEVATE's non-negotiables (RLS on every table, append-only evidence, least privilege, audit, no secrets in logs).

## Tables (schema `learn`, migrations in `apps/elevate/drizzle`, RLS on, no public policies)

| Table | Purpose | Mutability |
| --- | --- | --- |
| `courses` | One row per course (HIPAA first), slug, owner | HR edits title |
| `course_versions` | A numbered version with its content JSON, status draft, published or retired | Frozen by trigger once published |
| `modules` (inside the version JSON, indexed in `module_index`) | Order, estimated minutes, minimum seconds, topic tags | Frozen with the version |
| `question_bank` / `questions` | Question stem, options with stable ids, correct ids, rationale, topic tag, module link, status | Belongs to a version; frozen on publish |
| `tracks` | Full, Essentials; which modules, exam size | With the version |
| `client_addons` | A short module attached to a client | Versioned the same way |
| `assignments` | Person, course, track, version, due date, reason (new hire, renewal, update), status | Status moves forward; never deleted |
| `module_progress` | Events: started, completed (per person, module, version) | Append-only |
| `module_time` | Server-validated seconds per person, module and day | Append-only increments |
| `exam_attempts` | Attempt number, started, deadline, submitted, score, passed | Moves forward once; then final |
| `exam_attempt_items` | The frozen question selection and option order for the attempt | Insert-only |
| `exam_answers` | The person's answers | Insert-only; purged after 12 months |
| `attestations` | Statement version, accepted at, sign-in methods, IP | Insert-only (trigger) |
| `certificates` | Reference `HC-YYYY-XXXXXX`, person, course version, issued, ends, status | Insert-only; a revocation is a new row |
| `retry_grants` | Extra tries or extra time granted by HR, with reason | Insert-only |
| `launch_tokens`, `sessions` | Handoff and session hashes | Short-lived; purged |
| `drills`, `drill_results` | Micro-drill scenarios and answers | Append-only |

Score and answers: the person and HR (and the Privacy Officer) read them. Everything else, including team leads, reads only
the **status view** (`learn.v_status`: assigned, in progress, passed, due, overdue, expires on).

## Database roles

- `learn_app` (NOLOGIN at creation): SELECT on published content and its own rows (enforced by the application checking the
  session user id in every query, plus RLS policies `TO learn_app` that require `user_id = current_setting('learn.user_id')::uuid`
  set per transaction), INSERT on the append-only tables, UPDATE only on the specific columns that move forward, **no DELETE,
  no access to `core`, `talent`, `ops` or `docs` tables**; reads people data only through the two views.
- `learn_elevate`: not needed. ELEVATE uses its owner connection; its code goes through `src/modules/learn/` only.
- The answer key (`correct_ids`, `rationale`) is **not readable by `learn_app` at all**. Grading runs in a `SECURITY DEFINER`
  function `learn.grade_attempt(attempt_id)` owned by the migration owner, which compares stored answers with the key and
  writes the score. The browser can never receive the key because the app role cannot read it either.

## Exam integrity

- The server selects the questions at **start** (stratified by module/topic so each topic is covered) and stores the selection and
  shuffled option order; the same attempt can be resumed and shows the same questions.
- Each question is sent without correctness data; answers are saved as given; submission is a single call to
  `grade_attempt`. Time limit (default 30 minutes) and deadline are server values; late answers after the deadline are ignored.
- A second attempt prefers questions not seen before. A failed attempt shows score, pass/fail and **topics to revisit with links**,
  not which options were right. A passed attempt shows the full review with rationale.
- One open attempt per person; starting a second returns the first (advisory lock).
- Rate limit on start and submit; an attempt cannot start until the required modules are complete and the wait after a failure
  (default 1 hour) has passed.
- No webcam or screen proctoring. Deterrents are randomization, a time limit, a fresh question set per attempt, and the
  attestation that the work is the person's own.

## Threat list

| Threat | Control |
| --- | --- |
| Reading the exam key from the page, API or network | Key unreadable by the app role; `grade_attempt` is a definer function; a test inspects every response for key fields |
| Replaying a handoff token | One-use, 60 seconds, hashed, POST not URL |
| Stealing the session cookie | `httpOnly`, `Secure`, `SameSite=Lax`, hashed server-side, idle and absolute limits, ends on deactivation |
| IDOR on attempts or certificates | Every query keyed by the session user; RLS with `learn.user_id`; authz tests per role |
| Forged progress or time | Server computes time from heartbeats (one accepted per 30 s, capped per day); browser values are never trusted |
| Bots or auto-clickers | Minimum time per module, activity prompt, per-attempt random order, rate limits; HR can review timing anomalies |
| Sharing answers | Randomized selection and order, rotating bank, rationale hidden after a fail |
| XSS or content injection from the studio | Content is validated JSON blocks, rendered as React elements; no HTML; strict CSP; no `dangerouslySetInnerHTML` |
| CSRF | POST only for changes, `SameSite=Lax`, Origin check on every mutating route, no cookies on public pages |
| Enumerating certificates | Check page needs the reference **and** the holder's name; fixed response timing; rate limit |
| Tampering with history | Append-only triggers, frozen versions, hash of the certificate stored |
| Leaking scores | Status view for leads, no scores in notifications, emails, exports to leads or logs |
| Accidental patient data | Content rules, authoring checklist, free-text warnings, incident form warning |
| Log leakage | No names, answers or tokens in logs; error class names only |
| Supply chain | No new dependency without owner approval; lockfile pinned; `eslint-plugin-security` on |

## Privacy and retention

- **Retention:** results, attestations and certificates are kept **6 years** (HIPAA documentation period). Per-question
  answers are removed after **12 months** by `learn-purge`; the score and pass/fail remain. Counsel confirms both periods
  before launch; they are configuration, not code.
- **Minimal data:** Learn stores a user id and takes name and work email from the views at display time; it copies neither into
  its own tables, except the name typed on a certificate at issue (needed for a stable document).
- **My data:** the person's Learn record is added to ELEVATE's "My data" export (counts and dates, no answer text).
- **Access is audited** in ELEVATE's `audit_log`: viewing another person's results (`learn.results_view`), granting a retry,
  exporting evidence, changing content, publishing a version, revoking a certificate. Audit rows never contain answers.
- **Incident reports** are stored in ELEVATE (`ops.privacy_incidents`), visible to the reporter, HR admins, Super Admins and the
  designated Privacy Officer; the form forbids patient details and says so.

## Content safety rules (for authors)

- Invented names and data only; identifiers in examples must be obviously fake.
- Public sources (HHS/OCR guidance, NIST summaries) are referenced; nothing copied verbatim from non-public or copyrighted
  training products.
- No legal advice. Where the law or a client contract decides, the lesson says "check your client's rules and ask the
  Privacy Officer".
- No claim of an official HIPAA certification: HIPAA does not issue one. Wording says "ERS HIPAA training completion".
