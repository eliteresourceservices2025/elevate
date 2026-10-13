# 06 Testing and review

Rule of the project: every feature ships with tests, and mocks never replace a real database for anything about evidence,
roles or append-only behavior.

## Test layers

| Layer | Where | What it proves |
| --- | --- | --- |
| Unit | `apps/learn/src/**/*.test.ts` | Exam selection (stratified, unseen first), grading rules, pass mark, time credit and caps, deadline handling, content schema validation, certificate reference format, token and session hashing, date and renewal rules |
| Authz | `apps/elevate/tests/authz/learn-*.test.ts` | Every new ELEVATE action and query for all six roles, with and without the Privacy Officer flag (matrix rows for each new permission) |
| Integration (real Postgres) | `apps/elevate/tests/integration/learn.test.ts` | Roles and grants (`learn_app` cannot read other schemas or the key), append-only and frozen-version triggers, `grade_attempt`, handoff single use and expiry, concurrent attempts, assignment resolution, certificate sync idempotence, purge job, status view hides scores |
| App-level (Learn handlers) | `apps/learn/tests/**` | Request handlers run against the real database through `learn_app`, like Safe Voice's tests |
| End-to-end | `apps/elevate/tests/e2e/learn.spec.ts` and `apps/learn/tests/e2e` | New hire to certificate in the browser; fail and retry; lead sees status only; HR retry grant; verify page; incident form |
| Security | Both | Answer key never appears in any response; no HTML in rendered content; CSP; cookie flags; Origin check; rate limits; log scan for names and answers |
| Accessibility | e2e | axe on every learner page, keyboard path through a module and an exam |
| Content lint | `apps/learn/src/content/content.test.ts` (runs for every course in the registry) | Every question has a rationale, topic and module tag; no duplicates; bank coverage per module; reading level; forbidden patterns (real-looking identifiers, URLs, phone numbers) |
| Load | one-off script | 100 learners starting and submitting an exam within a minute; handoff burst at the Manila shift change |

## Specific cases that must exist

- A person cannot start the exam before finishing the modules; cannot start a second attempt while one is open; cannot get
  more than 3 tries without a grant; wait time after a failure is enforced by the server.
- A submitted attempt is final; answers cannot be changed afterwards by anyone.
- A published version cannot be edited; editing creates a new draft; old attempts still reference their version.
- The same launch token used twice fails; an expired token fails; a deactivated account's session stops working.
- A team lead requests a subordinate's results and receives only status; a lead outside the chain receives nothing.
- A person with no people record (HR, Super Admin without one) can still take the course.
- Certificate sync is idempotent and a renewal never lowers an existing end date.
- Retention job removes answers older than 12 months and leaves scores, attestations and certificates.
- A certificate check with a wrong name or wrong reference gives the same answer and timing.

## Code review

Every change goes through the repo's `/code-review` before merge, plus this project checklist:

1. Does each new action call `requireUser()` first and `authorize()` with a matrix row and an authz test?
2. Does each query in Learn filter by the session user and run under the `learn_app` role?
3. Any place the browser can send a time, a score, a user id or a version id that the server trusts? (It must not.)
4. Any new field that could hold patient data? Warning copy present?
5. Any response that could include the answer key, a score for a lead, or another person's data?
6. Any new dependency? (Needs the owner's OK.)
7. Logs and errors carry no names, answers, tokens or content.
8. Audit rows written inside the same transaction, without answers.

## Security review gates (before each release)

- Threat list in `03-data-and-security.md` re-walked against the diff.
- `/security-review` run on the release branch.
- A manual abuse session: try to read the key, replay a token, skip a module, tamper with a timer, enumerate certificates,
  read someone else's attempt, inject script into a content block.
- Dependency and secrets scan; the `.env.example` has names only.

## Product and content review

- **Content review:** the Privacy Officer and counsel read every lesson and the full bank against the checklist in
  `03-data-and-security.md` ("Content safety rules"); the studio records who approved which version and when.
- **Usability review:** five VAs and two leads complete the course on their usual devices while observed; measure completion,
  time, confusion points and exam fairness (question miss rates).
- **Question review:** any question missed by more than 70% or less than 5% of pilot takers is reviewed before release.
- **Accessibility review:** keyboard and screen-reader pass by a person, not only a tool.

## Launch gates

A release does not go live until: all automated suites pass; content approved and recorded; counsel confirmed retention and
attestation wording; Privacy Officer designated; migrations applied to production **before** the code deploys; DNS and
environment checked; runbook updated; rollback understood; pilot completed (release 1).

## Definition of done (every task)

- [ ] Authorization on every action with authz tests for all six roles
- [ ] Zod validation on the server for every input
- [ ] Migration with RLS and grants, applied locally and tested
- [ ] Audit entries where required, no answers inside
- [ ] Lint, typecheck, unit, authz and integration tests pass
- [ ] Accessibility check on new screens
- [ ] No secrets, patient data or answers in logs, client bundles or Sentry
- [ ] Docs and `CLAUDE.md` updated
