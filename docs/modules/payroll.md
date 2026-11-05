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
