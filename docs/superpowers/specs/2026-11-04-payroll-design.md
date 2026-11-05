# ELEVATE Payroll: design

**Status:** draft for owner review, 2026-11-04.

This file holds no real names or pay figures. Any example amount is invented.

## 1. Purpose

Executives want payroll inside ELEVATE in place of a hand-kept spreadsheet. That sheet tracks raises in free-text notes and can't catch mistakes such as an allowance added in the wrong currency, a daily rate that disagrees with the salary, or totals that don't match.

**Success means:**

- One chosen person prepares a cutoff in ELEVATE, and a different chosen person reviews and approves it.
- The results match the sheet's correct results to the centavo for 2 cutoffs in a row.
- Each person can see their own payslips.

**Out of scope:** tax and government contributions, sending money (Remitly stays manual), client invoicing, and loan balance tracking.

## 2. Decisions made with the owner

| Topic | Decision |
|---|---|
| Who has access | Specific people chosen by a Super Admin, as with Safe Voice handlers. No role grants payroll, not even Super Admin. Each chosen person is a Preparer, Approver or Viewer. Every payroll is prepared by one person and approved by another. |
| Change history | A permanent record of who changed what, when, the old and new amounts, and the reason. Only chosen people can read the amounts. |
| Source of numbers | ELEVATE suggests amounts from approved hours. A Preparer confirms them, or overrides them with a reason. |
| Extra-time rates | Dated settings. The real multipliers come from the sheet owner and are never guessed. |
| Bracketed names on the sheet | A client-facing alias of the same person, who may hold a second role. |
| Currency | Pesos. A Preparer records the dollar rate on each run. A dollar allowance converts at that rate and adds to net pay. |
| Payslips | Each person sees their own PDF in ELEVATE once payment is marked done. Notifications carry a link only. |
| FTE and client hours | Reference only, with totals by client. They never change pay. |
| Who is on payroll | Only people a Preparer sets up with a pay line, starting with the people on the current sheet. |

## 3. Standing rules this changes

These are updated with the first code change.

1. **"ELEVATE never computes pay"** appears in `docs/architecture-plan.md`, `CLAUDE.md`, `pay-periods.ts` and the module notes. New wording: the hours export computes nothing; only the payroll module computes pay, and it never computes tax.
2. **"Pay rates live only in `core.employee_sensitive`"** can't hold a person's several dated rates. New rule: pay amounts live in the payroll tables, always encrypted. The old `payRate` field is read-only reference during setup and is removed from profiles when the parallel run ends, because HR Admins and Super Admins who aren't chosen for payroll can still see it. Bank details and government IDs stay as they are.
3. **Permission matrix:** `docs/architecture-plan.md` section 3 and `tests/authz/matrix.test.ts` gain the payroll rows in section 8. `src/lib/authz.ts` learns the new payroll access check.
4. **Privacy notice:** it tells staff that only they and HR/admin roles see pay. The new wording says pay is visible to the person and to staff individually chosen to run payroll, and that HR and administrator roles can see the pay rate held on a person's record. That last part stays accurate while the old field exists and only overstates access once it is removed, so the notice is safe to publish once. The change goes into the unpublished draft before its one publish. Real pay data must not enter ELEVATE until that notice is published.
5. **1099 wording:** ELEVATE keeps "extra hours", never "overtime". All payroll labels live in one constants file so a change from counsel is one edit.

## 4. Data model

A new `payroll` schema. Every table enables RLS with no public policies. Each encrypted value uses `src/lib/crypto.ts` with a context that binds it to its row.

| Table | Purpose | Rules |
|---|---|---|
| `pay_settings` | Cutoff divisor, extra-time multipliers, change-warning threshold, each with an effective date | Append-only |
| `pay_lines` | One per person and role: client (optional), alias (optional), encrypted monthly rate, hours per day, FTE, client hours, payment method, effective dates | Append-only; a raise is a new dated row |
| `pay_runs` | Period, status, dollar rate, preparer | One run per period |
| `pay_run_lines` | Frozen copy of the line's rate, inputs and results as one encrypted payload (context `pay_run_line:<id>`) | Trigger blocks changes once the run is approved |
| `pay_run_items` | Each confirmed or overridden amount and adjustment: type, encrypted amount, reason, who, when | Append-only; newest per line and type wins |
| `pay_approvals` | Who approved which encrypted run hash, and when; also send-backs with a note | Append-only |
| `pay_payments` | Per person and run: Remitly reference, paid date, who marked it | One transfer covers all of a person's lines |
| `pay_change_log` | The change history (section 8): who, when, what, run and person affected, plus old values, new values and reason as one encrypted payload (context `pay_change:<id>`) | Append-only, enforced by trigger; written in the same transaction as the change |

Access is one new column, `core.users.payroll_access`: `preparer`, `approver`, `viewer` or empty. It sits beside `is_safevoice_handler` and follows the same pattern.

A person is on payroll when they have a `pay_lines` row in effect during the period; no separate flag is needed. The run hash covers every line's decrypted figures and the dollar rate, so any change voids an earlier approval. It is computed when needed and stored only encrypted, because a plain hash of a small amount can be guessed by anyone with read access.

Amounts are encrypted, so totals are computed in the app. Runs are never hard-deleted, and no retention job runs until counsel sets a period. Audit rows hold ids and counts, never amounts.

## 5. Calculation

`src/modules/payroll/calculate.ts` is pure: no clock, database or settings lookup. Inputs are passed in.

```
cutoff salary = monthly rate / 2
daily rate    = cutoff salary / cutoff divisor
hourly rate   = daily rate / line's hours per day
base          = cutoff salary, or (days x daily + hours x hourly) for a partial cutoff
gross         = base - absences - late/undertime + extra-hours lines + holiday + peso allowance/fee
net           = gross + reimbursement/bonus/adjustment + (dollar allowance x run's dollar rate) - loan - other deductions
```

- Rates are kept unrounded and only results are rounded, half up to the centavo. The sheet's extra-time amounts reproduce only this way.
- Arithmetic uses integer centavos with exact fractions (`bigint`), never floats.
- Daily and hourly rates always derive from the salary, so they can't disagree with it.
- An approved run keeps the rates and settings it was computed with, even if they change later.
- Rounding happens per line, and totals add the rounded line results.

## 6. Workflow

Run status moves: `draft` → `in_review` → `approved` → `paid`. A send-back returns `in_review` to `draft`.

1. **Setup (Preparer):** create lines and dated rates.
2. **Create run (Preparer):** choose the period and ELEVATE builds the lines. Periods use `pay-periods.ts`. A rate change that starts mid-period is flagged, and the Preparer decides by entering a partial cutoff or an adjustment; it is never silently split.
3. **Suggestions:** ELEVATE reads approved hours through the attendance module's exported functions and suggests absences, lates and approved extra hours. Nothing is deducted until a Preparer confirms it, and an override needs a reason. Attendance is per person, so for someone with several lines the Preparer chooses the line.
4. **Checks before review:** unapproved days, no payout details on file (read from stored masks, no decrypt), missing dollar rate, a new hire or leaver in the period, unassigned suggestions on a multi-line person, and net pay changed from the last run by more than the threshold (10% by default). Checks warn, except a missing dollar rate and unassigned suggestions, which block sending for review.
5. **Approve:** the approver sees every line, the change from the last run, totals by client, and peso and dollar totals. They approve or send back with a note.
6. **Pay (Preparer):** download the Remitly list (person, alias, pesos, dollars; never account numbers), pay outside ELEVATE, and record the references. When every person on the run is marked paid, the run becomes `paid` and payslips are released.
7. **Corrections:** an approved run never changes. A mistake becomes an adjustment on the next run, linked to the original.

## 7. Screens

Per the Navigation rule, each menu item opens its own page.

- `/payroll`: list of runs.
- `/payroll/[runId]`: the worksheet, with frozen name and client columns, sheet-style columns grouped by section, totals by client, and a card list below tablet width.
- `/payroll/rates`, `/payroll/settings` and `/payroll/history`, linked with `TabNav`.
- Settings > Payroll access: a Super Admin's list of chosen people and their levels, shown without any pay figures.
- The Payroll menu item appears only for chosen people. `/my-pay` appears for everyone, with an empty state until they have a payslip.
- `/my-pay`: a person's own payslips, with the PDF served through an authenticated route using `@react-pdf/renderer` (as in `offers/offer-pdf.tsx`).
- Dashboard: an "awaiting your approval" count, never an amount.
- Notifications and email: counts and links only.
- Help articles using fake data only.

## 8. Access and change history

### Who can do what

No role grants payroll, including Super Admin, HR Admin and Executive. Access comes only from the person's level, whatever their job title.

| Action | Preparer | Approver | Viewer | Not chosen |
|---|---|---|---|---|
| `payroll.view` (runs, rates, settings) | yes | yes | yes | no |
| `payroll.view_history` | yes | yes | yes | no |
| `payroll.prepare` | yes | no | no | no |
| `payroll.manage_rates` | yes | no | no | no |
| `payroll.mark_paid` | yes | no | no | no |
| `payroll.export` | yes | no | no | no |
| `payroll.approve` | no | yes | no | no |

Two actions don't depend on the level:

- `payroll.view_own`: every role, own payslips only.
- `settings.set_payroll_access`: Super Admin only.

### Choosing people

- Only a Super Admin adds, changes or removes someone, including themselves. A person has one level at a time.
- Being able to choose people doesn't show pay figures. A Super Admin sees none unless they are chosen too.
- Each change is written to the audit log and the change history, and alerts the other Super Admins and everyone on the payroll list. The alert names the person and level, with no amounts.
- Access ends when an account is deactivated or archived. A level is checked on every request, so a removal takes effect immediately.
- A run needs at least one Preparer and a different Approver. The Settings page warns if a level has fewer than two people, because one person's absence would stop payroll.

### Separation of duties, enforced on the server

- The approver can't be anyone who prepared or changed that run, even if their level has since changed.
- Nobody creates or changes their own rate, or enters, confirms or overrides an amount on their own line.
- Someone with a line on the run can approve only if a different Preparer has confirmed that line. ELEVATE records who confirmed it.
- If nobody eligible exists, the action is refused. There is no bypass.

### Change history

`/payroll/history` can be filtered by run, person, who made the change, and date, and is paged with `PagerLinks`. Each run also links to its own history.

| Recorded | Shown |
|---|---|
| Rate and line changes | Old and new amounts, effective date, reason |
| Amounts entered, confirmed or overridden, and adjustments | Line, type, old and new amounts, reason |
| Settings and dollar rate changes | Old and new values |
| Run steps: created, sent for review, sent back, approved, paid | Who, when, note |
| Payment references | Who marked it, when |
| Exports and payslip downloads | Who, when, which run |
| Views of a run's figures | Who and which day, one row per person, run and day |
| Payroll access changes | Who changed whose level, old and new level |

- Rows can't be edited or deleted, even by Super Admins using the app. A database trigger enforces this.
- Old values, new values and reasons are encrypted. Only chosen people can read them, and reasons follow the no-patient-data rule.
- The general audit log keeps its rule: who, what and ids, never amounts. A Super Admin who isn't chosen can see that a change happened, but not the figures.
- Each decrypted view of a run, payslip or history page writes one `sensitive.view` audit entry carrying the id only. Exports are audited and rate-limited, and cells go through `csvCell`.

## 9. Error handling

- Every action returns `{ ok, data } | { ok, error }`. Multi-step changes roll back by throwing `ActionFailure`.
- Decryption failure on a run shows a clear error and blocks approval. It never shows a partial total.
- Approving a stale run (the hash changed since the page loaded) is refused and the page asks for a reload.

## 10. Testing

- **Calculator:** unit tests with invented figures for every formula, part-time divisors, multi-line people, partial cutoffs, the dollar allowance and rounding.
- **Authz:** every action for all 6 roles, each with no level and with each of the 3 levels, including a Super Admin with no level being refused. Also hand-written matrix rows, self-approval refusals, and removal taking effect on the next request.
- **Integration (real Postgres):** encryption contexts, freeze trigger, append-only tables including `pay_change_log`, approval voided by a changed hash, a history row written for every kind of change and rolled back with a failed one, and audit rows free of amounts.
- **E2E:** one happy path from choosing people to prepare to approve to paid to payslip to reading the history, as different fake users.
- **Before each commit:** lint, typecheck, unit and integration tests, code review, `pnpm build`, and a check of the built app.

The real sheet never enters the repo, tests or a development database.

## 11. Delivery stages

1. Rule and doc updates, `docs/modules/payroll.md`, and the privacy notice draft.
2. Access, history and lines: chosen people, the change history, schema, encryption, rates and settings pages, authz.
3. Calculator and draft runs: the worksheet, manual entry, checks.
4. Suggestions from approved hours.
5. Approval and payment: freeze trigger, separation of duties, Remitly list.
6. Payslips: PDF, `/my-pay`, notifications.
7. Parallel run: after the privacy notice is published, run ELEVATE beside the sheet in production for at least 2 cutoffs, and explain any difference line by line before retiring the sheet.

## 12. Open items

**From the sheet owner, before stage 3 is finished.** Settings make the first two changeable without a rebuild.

1. The extra-time multipliers (regular, holiday, rest day, rest day past 8 hours), and whether holiday pay is a premium.
2. Whether the divisor is always 11, including for a new hire's partial cutoff.
3. Whether Gross and Basic ever differ. They are identical on every sheet line that has both; if there's no real difference, ELEVATE shows one.
4. How late and undertime amounts are deducted: minute by minute, or rounded.
5. Whether the dollar allowance adds to net pay for everyone, and whether it is per cutoff or per month. The sheet is inconsistent. This design assumes it adds to net pay, and that each line's amount repeats every cutoff unless changed.
6. Whether the possible errors found in the current draft are real.

**For counsel, before go-live.**

1. 1099 wording, and whether paying premiums and making deductions affects contractor status.
2. The retention period for pay records.
