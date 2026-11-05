# Payroll

Design: `docs/superpowers/specs/2026-11-04-payroll-design.md`. Plan: `docs/superpowers/plans/`. Real names and pay figures never enter the repo, tests or a development database. Code: `apps/elevate/src/modules/payroll/`. Every label comes from `constants.ts`.

## Rules (read first)

- **No role grants payroll**, not even Super Admin. Access is `core.users.payroll_access` (`preparer`, `approver`, `viewer` or empty), chosen only by a Super Admin (`settings.set_payroll_access`, Settings > Payroll access), read fresh on every request (a removal or an archived account takes effect on the next call). Permission rules mark this with `payrollLevels`; the matrix rows show "no access" for every role. A Super Admin can choose people without seeing any figure.
- **Levels:** Preparer (`payroll.prepare`, `manage_rates`, `mark_paid`, `export`), Approver (`payroll.approve`), Viewer (nothing but reading). All three read runs, rates, settings and the change history (`payroll.view`, `payroll.view_history`). `payroll.view_own` is every role, own payslips only. A person has one level at a time. The Settings page warns when a level has fewer than two people.
- **Only the payroll module computes pay.** It never computes tax or government contributions and never sends money (Remitly stays manual). The hours export computes nothing.
- **Money** is `bigint` centavos (dollars in cents), never floats; amounts cross JSON as strings. Pay amounts live in the payroll tables, always encrypted (`src/lib/crypto.ts`, context bound to the row). Audit rows, notifications, email, logs and Sentry carry ids and counts, never an amount, a reference or a reason.
- Copy says "extra hours", never "overtime", and never "PTO". Workers are 1099 contractors: letters and copy avoid "employee" wording (counsel to confirm, see Privacy and 1099).
- Real pay data must not enter ELEVATE until the privacy notice (with the Pay wording) is published.
- The old `payRate` field in `core.employee_sensitive` is read-only reference until the parallel run ends, then removed from profiles in a separate small change. HR Admins and Super Admins who are not chosen for payroll can still see it until then.

## Data model (schema `payroll`, RLS on, no public policies)

| Table | What it holds | Rules |
|---|---|---|
| `pay_settings` | Cutoff divisor, five extra-time rates (basis points, null until set), change-warning threshold, each with an effective date | Append-only; the newest version dated on or before a date applies |
| `pay_lines` | One version of a person's line: client, alias, hours per day, FTE, payment method, last day, effective date; `amounts_enc` = monthly rate, peso allowance, dollar allowance (context `pay_line:<id>`) | Append-only; a raise or end is a new version sharing the `line_key`; the author (`created_by`) is kept |
| `pay_runs` | Period, status, dollar rate (`usd_rate_e4`), settings snapshot, creator, submitter | One live run per period (unique index; cancelled runs are left out) |
| `pay_run_lines` | Frozen copy of a line for a run: one encrypted payload with the rate, inputs and results (`pay_run_line:<id>`), flags, who confirmed it | Frozen by trigger once the run leaves draft |
| `pay_run_items` | Each entered, suggested, confirmed or dismissed amount: type, state, encrypted value and reason (`pay_run_item:<id>`), who | Append-only; the newest row per line and type wins |
| `pay_approvals` | Approvals and send-backs: run hash (`pay_approval:<id>`) and note (`pay_approval_note:<id>`), both encrypted | Append-only |
| `pay_payments` | One row per person and run: Remitly reference (encrypted, `pay_payment:<id>`), paid date, who marked it | Append-only; a correction is a newer row |
| `pay_change_log` | The change history: actor, action name, run, person, line key in the clear; old and new values and reason in one encrypted detail (`pay_change:<id>`) | Append-only by trigger, written in the same transaction as the change |

A person is on payroll when a `pay_lines` row is in force in the period; there is no flag. Runs are never hard-deleted and no retention job exists (counsel sets the period). Encrypted values: line amounts, run-line payloads, item values and reasons, approval hashes and notes, payment references, change details. Not encrypted: ids, dates, status, alias, hours per day, FTE, the dollar rate and the settings (these hold no personal amount).

## Calculation (`calculate.ts`, pure)

```
cutoff = monthly / 2        daily = monthly / (2 x divisor)        hourly = daily / hours per day
base   = cutoff, or days x daily + hours x hourly for a partial cutoff
gross  = base - absences - late/undertime + extra hours (4 rates) + holiday pay + peso allowance
net    = gross + dollar allowance x run's dollar rate + adjustment - loan - other deductions
```

Rates stay unrounded; each result is one exact fraction rounded once, half up, to the centavo (`divRoundHalfUp`). Totals add rounded line results. Issues come back as codes: `missing_multiplier:<key>` (minutes entered, rate not set), `missing_usd_rate` (a dollar allowance, no run rate), `negative_net`. Settings are snapshotted on the run, so a later change never alters an approved run.

## Draft runs and the worksheet

- `createPayRun` (`payroll.prepare`) refuses any period that overlaps a live run (advisory lock inside the transaction). It builds one run line per resolved pay line (`lines.ts`: the version in force on the period's first day is paid; a raise dated inside the period only raises `rate_change_mid_period`; a start or end inside the period is flagged). Settings are reread on create and on every change to a draft.
- Every changing action (`runs.ts`) locks the run with `select ... for update` (`lockDraftRun`) and refuses a non-draft run. Each also writes an audit row (ids and counts) and a change-log row in the same transaction.
- Items are append-only; the newest row per line and type wins. Values are stored in the smallest unit (minutes, day or hour hundredths, centavos) and validated in `items.ts` (positive whole numbers, `parseMoney`, never negative; a reduction is a loan or other deduction). A peso or dollar allowance item replaces the line allowance for that run. Client hours (an item) and FTE (on the line) never reach `calculateLine`.
- A reason is required for a loan, an other deduction, and overriding a suggestion. Saving an item recomputes that person only (all lines when settings changed) and clears the confirmation of any line whose figures changed. Reasons cannot be sidestepped: an override is judged against the newest suggestion in the whole item history for that line and type, also when removing; an allowance item below the line's own needs a reason.
- `getWorksheet` writes one `sensitive.view` audit row per call and at most one `run_viewed` change-log row per person, run and day. An unreadable line is listed, blocks review and withholds all totals; logs carry the line id and error class only.
- **Cancelling** (`cancelPayRun`, `payroll.prepare`, reason required, draft only, same run lock): status becomes `cancelled` (trigger-enforced, frozen, never deleted), the run is left out of the overlap test and of the unique period index, and is logged (`run_cancelled`, reason encrypted) and audited. This is also the fix for a wrong period or lines that changed after creation: cancel and recreate.

## Run lifecycle

`draft` -> `in_review` (`submitRun`) -> `approved` (`approveRun`) -> `paid` (every person marked paid). `sendBackRun` returns `in_review` to `draft`. Only a draft can be cancelled. Cancelled, approved and paid runs are frozen by trigger; the status trigger allows approved to paid only.

## Suggestions from approved hours

- `suggest.ts` (pure) and `suggestions.ts` read approved days through the attendance module's exports (`hours-service`), never its tables. Only days whose numbers equal their latest approval count; every other day only adds to `unapprovedDays` (a warning).
- Suggested: absent days (an `absent` flag without `on_leave`, one day each), late plus early-leave minutes, and approved extra minutes by kind: holiday (verified holiday on the person's calendar), regular (a scheduled day), and rest day (no schedule that day). Nothing changes pay until a Preparer confirms it (`confirmSuggestion`) or overrides it (reason required). A confirmed amount is never touched by a refresh; unchanged numbers add no rows; a suggestion that disappears from approved hours is dismissed with the reason "No longer in approved hours".
- A person with one line gets suggestions on it; a person with several get them **unassigned** and a Preparer chooses the line (blocking check `unassigned_suggestion`).
- **Open owner question (do not change without an answer):** on a rest day the approved extra minutes fill the lower rest-day rate first, up to 480 minutes, and only what is beyond goes to the "past 8 hours" rate. A partial approval of a long rest day therefore never reaches the higher rate. Tested in `suggest.test.ts`.

## Checks (`checks.ts`, pure; labels in `CHECK_LABELS`)

**Block** sending for review and approval: `missing_usd_rate`, `missing_multiplier`, `negative_net`, `unassigned_suggestion`, `own_line_unconfirmed`, `unreadable_line`, `lines_out_of_date` (the pay lines now in force differ from what a run built now would contain; fix: cancel and recreate).

**Warn** only: `unapproved_days`, `no_payout_details` (read from stored masks, never decrypted), `new_or_leaving`, `rate_change_mid_period`, `pending_suggestions`, `large_change` (net moved more than the threshold, 10% by default, never at exactly the threshold; compared with the latest approved or paid earlier run only).

`checkInputsOf(executor, data, submitterUserId)` works the checks out relative to the person sending the run: a Preparer sees "own line" about themselves while the run is a draft, and everyone sees it about the submitter once sent (an Approver never sees "your own line" about someone else's).

## Review, approval and separation of duties

- One loader (`readRun` in `runs.ts`) decrypts a run once for the worksheet, the checks and the hash. `submitRun` (`payroll.prepare`): run lock, `recomputeRun`, then the checks inside the same transaction; refused while anything blocks or the run has no lines.
- `sendBackRun` / `approveRun` (`payroll.approve`): run lock first (of two approvals at once, the second finds the run approved), then the level is read again with the account row locked, then `approvalRefusal` (`rules.ts`, pure). Refused for anyone in `touchedBy`, for an own line unconfirmed or confirmed by the approver, and while a check blocks. There is no bypass.
- **`touchedBy`** (one SQL definition, `touchersOf` in `approval.ts`, shared with the dashboard count) is everyone who is: the run's creator or submitter; an actor in the run's change history except views, send-backs and approvals; someone who entered an item; someone who confirmed a line; **or the author (`created_by`) of any pay-line version the run pays (rate authors)**. The level they hold now is never consulted. It does **not** include authors of settings changes (`pay_settings.created_by`): **open owner question**, whether someone who wrote the divisor or an extra-time rate should be barred from approving runs that use them. Deciding (send back, approve) does not count as changing the run.
- Practical consequence: if the only Approver also wrote the only rates, nobody can approve until another Approver exists or another Preparer writes new versions of those rates (which then forces cancel and recreate). Choose Approvers who do not write rates.
- Nobody creates or changes their own rate, enters, confirms or overrides an amount on their own line, or marks their own payment (`assertNotOwnEmployee`). A person with a line on the run is approved only after a different Preparer confirmed that line (`confirmRunLine`, "Mark as checked").
- The approval hash (`runHash`, SHA-256 over canonical JSON) covers every line's decrypted figures, items and confirmation, the dollar rate, the settings snapshot, the item history and the latest submission. The page gets it as `expectedHash` from the same repeatable-read snapshot as the figures; `pay_approvals.run_hash_enc` stores it only encrypted. A stale hash is refused with "This payroll changed. Reload and review it again." and writes nothing. A send-back needs a note (encrypted, shown on the draft, never in a notice).
- Notices carry a count and a link only: on submit to Approvers, on send-back and approval to Preparers. The dashboard shows Approvers a "waiting for your approval" count (`payrollRunsAwaitingApproval`, runs they did not touch), never an amount.

## Corrections

An approved run never changes. A mistake is fixed on a later run by an `adjustment` (underpaid) or an `other_deduction` (overpaid) naming the approved or paid earlier run (`correctsRunId`, kept in the item value and the change log). A reason is required, amounts stay positive, and the person must have had a line on that run. The worksheet marks a run that includes a correction.

## Payments and the Remitly list (`payments.ts`, `remitly.ts`)

- `exportRemitlyList` (`payroll.export`, rate-limited, audited, `list_exported`): only for an approved or paid run with a dollar rate set; refused if a line is unreadable or negative. CSV columns: Person, Alias, Pesos, Dollars (plain decimals, cells through `csvCell`). Never account numbers.
- One row per **person** (all of a person's lines summed). Dollars = total pesos / the run's rate, rounded half up from the total. **Two different people with the same name appear as two rows** (rows are ordered by name, then id) and can be told apart only by alias or order, so check the alias column.
- `markPaid` (`payroll.mark_paid`, Preparers) records the Remitly reference (encrypted), the paid date (not in the future, not before the period starts) and the marker. A second call for the same person is a correction: a new row, the newest shows. When every person has a payment the run becomes `paid` in the same transaction (`run_paid`) and each person with an account is told "Your payslip is ready" (fixed sentence and a link). A correction after that leaves the run paid.
- **References are visible to Preparers only** (`payroll.mark_paid`). Approvers and Viewers see who marked a person and when, not the reference. Decrypting references is one `sensitive.view` audit row (a count).
- Someone with a line on the run cannot mark their own payment; another Preparer does.

## Payslips (`payslip.ts`, `payslip-queries.ts`, `/my-pay`, `/api/payroll/payslips/[runId]`)

- A payslip exists only for a **paid** run and only for the signed-in person's **own** lines (scoped by their people record, never by level or role; not even a Super Admin reads another person's). Someone else's run, an unpaid run and a missing run all answer 404. A person with no linked account has no payslip page and gets no notice; payroll works for them.
- The PDF is built from Markdown through `renderOfferPdf` (`@react-pdf/renderer`, built-in Helvetica): **non-Latin characters in a name print as "?"** in the PDF. The payslip holds the person's own figures only: no other person, no staff reason, no history, no bank detail.
- The route is rate-limited (the 429 carries `Cache-Control: private, no-store` and nosniff like every other answer), never cached, audited (`sensitive.view`, run id only) and logged (`payslip_downloaded`). An unreadable line answers a plain 500 sentence, never a partial slip.

## Change history (`/payroll/history`, `history-queries.ts`, `history-format.ts`, `components/history-table.tsx`)

- `getPayrollHistory` needs `payroll.view_history` (level only; a Super Admin with no level gets a 404). Filters (run, person, changed by, dates in the company zone) live in the address (nuqs); a bad filter returns a message, not rows. Paged; only the page shown is decrypted.
- One `sensitive.view` audit row per page view with a count, written right after decrypting and **before** the name lookups, so a failing lookup still leaves the record; none when nothing was decrypted.
- A row that cannot be decrypted, or whose action this version does not know, shows "Can't be read" and logs only its id and the error class (`UnknownAction` for the second case).
- **Completeness test:** `tests/integration/payroll-history.test.ts` runs a full cycle and requires the set of logged actions to equal `CHANGE_ACTIONS`. Add a new action to `CHANGE_ACTIONS`, `CHANGE_ACTION_LABELS`, `describeChange`, AND a real flow in that test. Each run also links to its own history.

## Privacy and 1099

- The privacy notice (draft, unpublished) has a **Pay** point: pay is visible to the person and to staff individually chosen for payroll; HR and administrator roles can also see the pay rate held on the record (the old field); payroll figures are encrypted and every change is kept in a permanent history. The "Sensitive details" line points to it so they do not contradict. Publish once, before real data (`docs/PRODUCTION-CHECKLIST.md`). **Blocker: the privacy notice is currently over the 10,000-character policy limit** (`MARKDOWN_MAX_LENGTH`, enforced by `createPolicySchema` and the Markdown box) by about 200 characters, so it cannot be pasted into Settings > Policies as it is. Before publishing, the owner must either trim at least about 300 characters of counsel-approved wording or deliberately raise the policy limit (announcements module).
- 1099 contractors: no leave accrual or PTO; "extra hours" not "overtime". Counsel must confirm the wording and whether paying premiums and making deductions affects contractor status, and set the retention period for pay records.
- No patient data in any reason or note; the forms say so.

## Encryption keys

Frozen pay rows (approved runs) cannot be re-encrypted, so **every old `FIELD_ENCRYPTION_KEYS` entry must be kept for good**. Despite what CLAUDE.md says about a re-encrypt job for other fields, no re-encrypt job exists in the code. If a key is lost, "Can't be read" appears on lines, payslips and history, blocks approval, and withholds totals: stop and check the keys before changing any rate.

## Tests and test hygiene

- Unit: `calculate.test.ts`, `checks.test.ts`, `items.test.ts`, `lines.test.ts`, `money.test.ts`, `payslip.test.ts`, `remitly.test.ts`, `rules.test.ts`, `suggest.test.ts`; authz per role and level in `tests/authz/` (`payroll-actions`, `payroll-payslips`) and the hand-written rows in `tests/authz/matrix.test.ts`.
- Integration (`pnpm test:integration`, real Postgres): `tests/integration/payroll-*.test.ts` (access, lines, runs, suggestions, approval, payments, payslips, history, schema). Run the whole set twice in a row: a leftover from the first run must not break the second.
- **Per-file year ranges:** payroll tables are append-only and a run is unique per period, so each integration file uses its own years inside 2024 to 2030 (history uses the 17th to the 28th of 2030 months; the schema test uses the first days of 2030 months). Before taking a period, grep the other files.
- **`endPayrollLinesWhenDone(db)`** (`payroll-test-helpers.ts`): call once at the top of every payroll integration file. After the file it adds an END version, dated the line's first day, to every pay line the file created, so open-ended lines do not leak into runs built by later files.
- Seed: `pnpm db:seed` (local only) gives the fake HR Admin account the Preparer level, the Executive account the Approver level and the Recruiter account the Viewer level, plus five invented pay lines. The Super Admin seed account has no payroll level, so it sees no Payroll menu. It sets no pay settings; enter fake rates in Payroll > Settings to try a run.

## Parallel run (spec section 11, stage 7)

1. Publish the updated privacy notice. Choose at least 2 Preparers and 2 Approvers; Approvers must not be the people who write rates.
2. Enter the extra-time multipliers and the divisor in Payroll > Settings (from the sheet owner; never guessed). Add every person's pay line in Payroll > Rates, starting with the people on the current sheet.
3. For each cutoff, run ELEVATE beside the sheet: create the run, refresh suggestions, confirm or override, set the dollar rate, send for review, approve, download the Remitly list, pay as usual, record the references.
4. Compare ELEVATE with the sheet line by line, to the centavo. Explain every difference (a sheet error or an ELEVATE rule) before moving on.
5. Do at least 2 cutoffs in a row that match. Only then retire the sheet, and remove the old `payRate` field from profiles as a separate small change.

## Open questions (owner)

- Rest-day split of a partial approval (above).
- Whether settings authors should be in `touchedBy` (above).
- From the spec, section 12: the multipliers, whether the divisor is always 11, how late minutes are deducted, how the dollar allowance recurs.
