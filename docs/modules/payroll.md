# Payroll

Design: `docs/superpowers/specs/2026-11-04-payroll-design.md`. Plan: `docs/superpowers/plans/`. Real names and pay figures never enter the repo, tests or a development database.

## Rules

- **No role grants payroll**, not even Super Admin. Access is `core.users.payroll_access` (`preparer`, `approver`, `viewer` or empty), chosen only by a Super Admin (`settings.set_payroll_access`), read fresh on every request. Permission rules mark this with `payrollLevels`; the matrix rows show "no access" for every role.
- Levels: Preparer (prepare, rates, mark paid, export), Approver (approve), Viewer (read). All three read runs, rates, settings and history. `payroll.view_own` is every role, own payslips only.
- Separation of duties on the server: the approver is never someone who prepared or changed that run; nobody creates or changes their own rate or amounts; a person with a line on the run is approved only after a different Preparer confirmed that line. No bypass.
- Pay amounts live in the payroll tables, always encrypted (`src/lib/crypto.ts`, context bound to the row). Money is `bigint` centavos, never floats; amounts cross JSON as strings.
- Only the payroll module computes pay. It never computes tax or government contributions and never sends money (Remitly stays manual). The hours export computes nothing.
- An approved run never changes; a mistake becomes an adjustment on the next run.
- The change history (`pay_change_log`) is append-only by trigger and written in the same transaction as the change. Audit rows, notifications, email, logs and Sentry carry ids and counts, never an amount or reason.
- Copy says "extra hours", never "overtime", and never "PTO". Every label comes from `src/modules/payroll/constants.ts`.
- Real pay data must not enter ELEVATE until the privacy notice (with the payroll wording) is published.
- The old `payRate` field is read-only reference until the parallel run ends, then removed from profiles.

## Draft runs and the worksheet

- `createPayRun` refuses any period that overlaps an existing run (advisory lock, inside the transaction). One run line per resolved pay line; settings are reread on create and on every change to a draft.
- Every changing action (`runs.ts`) locks the run with `select ... for update` (`lockDraftRun`) and refuses a non-draft run, so the freeze triggers cannot race a submit. Each also writes an audit row (ids and counts) and a change-log row in the same transaction.
- Items are append-only; the newest row per line and type wins. Values are stored in the smallest unit (minutes, day or hour hundredths, centavos) and validated in `items.ts` (positive whole numbers, `parseMoney`, never negative; a reduction is a loan or other deduction). A peso or dollar allowance item replaces the line allowance for that run. Client hours (an item) and FTE (on the line) never reach `calculateLine`.
- A reason is required for a loan, an other deduction, and overriding a suggestion. Saving an item recomputes that person only (all lines when the settings changed) and clears the confirmation of any line whose figures changed.
- `getWorksheet` writes one `sensitive.view` audit row per call and at most one `run_viewed` change-log row per person, run and day. An unreadable line is listed, blocks review and withholds all totals; logs carry the line id and error class only.
- Checks (`checks.ts`, pure) block on: missing dollar rate, missing multiplier, negative net, unassigned suggestion, own line unconfirmed by someone else, unreadable line. They warn on: unapproved days, no payout details (stored masks only, never decrypted), new or leaving, rate change mid period, pending suggestions, net moved more than the threshold from the last run.
