# 03 Data and security

Training records are personal data about identified people and are evidence in client audits. The rules below follow
ELEVATE's non-negotiables (RLS on every table, append-only evidence, least privilege, audit, no secrets in logs).

## Tables (schema `learn`, migrations in `apps/elevate/drizzle`, RLS on, no public policies)

| Table | Purpose | Mutability |
| --- | --- | --- |
| `courses` | One row per course (HIPAA first), slug, title | HR edits title; archived, never deleted |
| `course_versions` | A numbered version: lesson content JSON, exam rules (`exam_config`), status draft, published or retired, reviewer and counsel approval | Frozen by trigger once published; can only be retired; one published version per course |
| `version_modules` | Per module: order, estimated minutes, minimum seconds (40%), screen count, tracks that include it | Frozen with the version |
| `questions` | Stem, options with stable ids, **`correct_ids` and `rationale` (the answer key)**, topic, module | Frozen with the version; key unreadable by the app role |
| `assignments` | Person, course, version, track, reason (new hire, renewal, update, manual), due date, status | Identity never changes; status only moves forward; never deleted |
| `module_screens` | A screen the person opened | Insert-only |
| `module_time` | Server-credited seconds per person, module and day | Only ever grows; never deleted |
| `module_completions` | A module completed | Insert-only |
| `exam_attempts` | Attempt number, start, **server deadline**, submitted, score, passed | Submitted once, then final; never deleted |
| `exam_attempt_items` | The frozen question selection and shuffled option order | Insert-only |
| `exam_answers` | The person's answers | Changeable only while the attempt is open; final once submitted; purged after 12 months |
| `attestations` | Statement version, typed name, IP, sign-in methods | Insert-only; one per assignment |
| `certificates` | Reference `ERSHC-YYYY-XXXXXX` (HIPAA) or `ERSCSC-YYYY-XXXXXX` (Cybersecurity basics), holder name, version, track, issued, ends | Insert-only |
| `certificate_revocations` | A revocation with who and why | Insert-only (a revoked certificate is shown as revoked, never edited) |
| `retry_grants` | Extra tries or extra time granted by HR, with reason and who | Insert-only |
| `launch_tokens`, `sessions` | Handoff and session hashes (never the values) | Short-lived; purged by `learn-purge` |

Later releases add `client_addons`, `drills` and `drill_results` (append-only), and `ops.privacy_incidents` lives in ELEVATE.

Score and answers: the person and HR (and the Privacy Officer) read them. Everything else, including team leads, reads only
the **status view** (`learn.v_status`: assigned, in progress, passed, due, overdue, expires on).

## Database roles and functions (built in migration 0054)

- **`learn_app`** is created NOLOGIN (ops sets the password out of band). It has **SELECT only**, on its own rows (RLS policies
  `TO learn_app` keyed on `learn.user_id`, set per transaction with `set_config`), the published content, the question text
  and options (column grant: **no `correct_ids`, no `rationale`**), and two filtered views (`v_learners`, `v_staff_roles`: only
  the signed-in person, never a list). It has **no INSERT, UPDATE or DELETE on any table**, no access to `core`, `talent`,
  `ops` or `docs`, and no grant on `launch_tokens` or `sessions`.
- **Everything it writes goes through `SECURITY DEFINER` functions** owned by the migration owner, each with a pinned
  `search_path`, executable only by `learn_app` (EXECUTE is revoked from PUBLIC for every function in the schema):
  `open_screen`, `credit_time`, `complete_module`, `start_exam`, `save_answer`, `grade_attempt`, `attempt_review`,
  `accept_and_certify`, `verify_certificate`, `consume_launch_token`, `create_session`, `resolve_session`, `end_session`.
  Rules (module order, screens opened, minimum time, tries, wait after a fail, deadline, name match) live in these functions,
  not in the app, so a bug or a compromised app cannot skip them. Errors are raised as `learn:<code>`.
- **ELEVATE** uses its owner connection and goes through `src/modules/learn/` only. It creates assignments, grants retries,
  issues launch tokens and reads `learn.v_status` (status without scores) for team leads.
- The answer key is read only inside `grade_attempt` and `attempt_review`. After a **failed** attempt `attempt_review` returns
  only the missed module and topic (no right option, no reason); after a **passed** attempt it returns the full review.
- Training time is credited by `credit_time`: at most 35 seconds per call and nothing if the previous credit for that module
  was under 25 seconds ago, so a script cannot speed it up. A module needs every screen opened **and** the minimum seconds.

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

- **Retention:** results, attestations and certificates are kept **6 years** (HIPAA documentation period); the privacy
  notice states this as 5 years, then 1 year in a restricted HR-only archive (the archive stage is not built: nothing
  moves or hides them at year 5 yet). Per-question
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
