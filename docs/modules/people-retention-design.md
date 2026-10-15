# People records retention: design

Status: built and off by default (see "People records retention" in `docs/modules/people-admin.md`). The open decisions
below are still counsel's. The design follows the privacy notice: **people records are kept for five years after the
engagement ends, then one more year in a restricted HR-only archive, then deleted or anonymized.**
The periods are HR's request and are for counsel to confirm (`docs/policies/COUNSEL-NOTES.md`).

## Clock and stages

| Stage | Starts | What changes |
|---|---|---|
| Active record | Engagement | Normal access by role. |
| Retained | `employees.end_date` (the separation date, set by offboarding) | No change. Full record kept for 5 years. |
| Restricted archive | End date + 5 years | Only HR Admin and Super Admin can open the record. Managers, leads, the person's own sign-in and search no longer see it. Nothing is erased. |
| Anonymized | End date + 6 years | Personal fields are replaced; counts, history shape and audit entries stay. |

- The clock starts from `end_date`, not `archived_at` (archiving can happen later or by mistake). A person with no end date
  is never touched, and a person who comes back (a new engagement) resets the clock.
- Dates are computed in the company zone (`America/Phoenix`) like other jobs.

## Off by default, owner-controlled

- A settings row (like recruiting's `getRetentionSettings`) holds `enabled`, `archive_after_months` (default 60) and
  `anonymize_after_months` (default 72). The job does nothing until HR switches it on, after counsel approves.
- A **legal hold** flag per person (HR sets it with a reason, audited) skips both stages. Needed for disputes, tax or
  a data-rights request that counsel is still deciding.
- A **dry run** page lists counts only (how many people would move to archive or be anonymized this month) before the
  switch is turned on. No names in the list, same rule as dashboard widgets.

## What anonymizing does

Follows the recruiting job (`runRecruitingRetention`): one transaction per person, a session flag that lets the guarded
update through, then a single audit entry (counts and ids only, never values).

- `core.employees`: legal and preferred names, birth date, civil status, personal email, mobile and address replaced with a
  fixed placeholder; `work_email` replaced with a unique `removed-<id>@invalid`; employee number kept so reports still add up.
- `core.employee_sensitive`: row deleted (ciphertexts are the most sensitive data).
- Documents: files deleted from storage through `DocumentStorage`, document rows marked removed.
- Emergency contacts, certificates, goals text and review free text: erased.
- Kept: the append-only ledgers and clock events (as numbers tied to the placeholder person), audit log, signing event
  hash chains. These tables have triggers that block updates, so the job must not rewrite them; they hold ids, not names.
- Time records follow their own 3-year period (`privacy-notice.md`, "Time records and approved hours"). The notice must say
  that the person's identity is removed at year 6 while hours totals can outlive it. Counsel to confirm that split.

## Where it plugs in

- `src/modules/people/retention.ts` (plain, tested function) called by a thin Inngest wrapper in `src/inngest/functions.ts`,
  wrapped in `track()`, and added to `health/registry.ts` in the same change.
- Schedule: **daily**, once (about 30 runs a month; well inside the job budget in CLAUDE.md).
- Migration: settings table and `legal_hold` columns, RLS on, no public policies; a database trigger that refuses changes to
  anonymized rows unless the session flag is set (same pattern as `talent.retention`).
- Permissions: `people.retention_manage` (HR Admin, Super Admin only) and `people.view_archived` (same). Matrix rows in
  `tests/authz/matrix.test.ts`, per-role authz tests, Zod validation on the settings form.
- Restricted archive is enforced in queries (a `retention_stage` check in the people list, search and profile queries),
  never only in the UI. The person's own access to their data-rights page stays.
- Audit: `retention.archive`, `retention.anonymize`, `retention.hold`, `retention.settings_change`.
- Integration tests (real Postgres): stage boundaries by date, legal hold, reset on re-engagement, nothing touched while
  disabled, ledgers and audit untouched, files deleted, double run is a no-op.

## Open decisions (owner / counsel)

1. Is "archive" an access restriction only (design above), or should the data also move to separate storage?
2. Anonymize or hard delete at year 6? Anonymizing keeps counts consistent; counsel may want deletion.
3. Which clock for people with several engagements: last end date (design) or each period separately?
4. Data Privacy Act "no longer than necessary": is the sixth year justified for 1099 contractors? Tax and payment records
   keep the period the law requires regardless.
5. Does the privacy notice need to name the HR-only archive for people to accept it (it already does) and describe how a
   person can ask for earlier deletion (data-rights request, decided by counsel)?
