# Client invoices

Spec: `docs/superpowers/specs/2026-11-12-payroll-timesheet-invoices.md`. Code: `apps/elevate/src/modules/invoices/`. Menu: Admin > Invoices (`/invoices`, `/invoices/rates`, `/invoices/[id]`, PDF at `/api/invoices/[id]`).

## What it does

The executives bill each **client** for a pay run: the client payroll hours of every person on that client, times the client's **hourly billing rate in US dollars**. One invoice line per person (name, alias, hours, rate, amount). They download the PDF and **send it themselves**: ELEVATE sends no email. Out of scope: tax, payment tracking, email.

## Rules

- **Who:** `invoices.view`, `invoices.create`, `invoices.manage_rates` for Super Admin, HR Admin and Executive (scope all). Nobody else, whatever their payroll level (a Preparer without one of those roles is refused).
- **Data source:** only `clientHoursForRun` (`payroll/client-hours.ts`): the run's period and status, each live line's person, alias, client and `client_hours` item. The module never reads or decrypts a pay figure, rate or amount, and imports nothing else from payroll (`boundaries.test.ts` scans for it). The run list for the dialog is one SQL read of period and status.
- **Which runs:** any run that is not cancelled (draft, in review, approved, paid). An invoice from a draft run stores `run_status = 'draft'` and says DRAFT on the page and PDF.
- **Lines:** a person with 0 hours is left off; a person with no client is not invoiced (listed as "no client" in the dialog); a client with no hours or no billing rate cannot be invoiced (plain message). Suggested (unconfirmed) hours are included, and the invoice shows "N lines use suggested hours that are not confirmed yet."
- **Money:** integer cents and hundredths of an hour (bigint), never floats. Line amount = round half up(hours x rate); invoice total = sum of the line amounts, so lines always add up. Dollars print `1,234.56` with a `USD` label, hours with 2 decimals (`calc.ts`).
- **Rates:** append-only and dated. A change is a new row; the newest row starting on or before the invoice day applies (a later-created row for the same start date wins). Rate is typed in dollars, above 0 and at most 999.99.
- **Numbers:** `INV-<year>-<4 digits>`, the counter per year, taken under an advisory lock (`invoices.number`) so two at once never share a number. A second invoice for the same run and client is a revision: same number plus `-R2`, `-R3`.
- **Snapshot:** the invoice keeps its own copy (client name, period, rate, lines, totals, unconfirmed count) in `payload_enc`; later changes to hours or rates never change it. Invoices are never deleted.
- **Audit:** `invoice.create`, `invoice.rate.add`, and `sensitive.view` (page and PDF) carry ids and counts only, never a rate, hours, name or amount.

## Tables (migration 0131, schema `ops`, RLS on, no policies)

- `ops.client_bill_rates`: id, client_id, effective_from, `rate_enc` (cents, context `client_bill_rate:<id>`), created_by, created_at.
- `ops.invoices`: id, number (unique), year, seq, revision, run_id (FK to `payroll.pay_runs`, added by hand in the migration), client_id, run_status, issued_on, `payload_enc` (context `invoice:<id>`), created_by, created_at; unique (run_id, client_id, revision).
- Both are append-only by trigger (`ops.reject_invoice_change`: update, delete, truncate).

## Files

`schema.ts`, `calc.ts` (pure arithmetic), `service.ts` (server-only helpers that take the acting user), `actions.ts` (`previewInvoiceRun`, `createInvoice`, `addBillRate`), `queries.ts`, `validators.ts`, `permissions.ts`, `invoice-text.ts` (shared by page and PDF), `invoice-pdf.tsx`, `components/`.

## Tests

- Unit: `calc.test.ts`, `invoice-pdf.test.ts`, `boundaries.test.ts`.
- Authz: `tests/authz/invoices-actions.test.ts` (every action and query, all six roles, payroll levels) and the rows in `tests/authz/matrix.test.ts`.
- Integration (`tests/integration/invoices-schema.test.ts`, `invoices-flow.test.ts`): RLS, append-only, rate lookup, snapshot, numbering under concurrency, refusals, draft status, no-client people, a user with no payroll level, the six roles.

## Test runs (2026-11-12)

An invoice from a **test run** is allowed: its number is `TEST-<year>-<counter>` (its own series, so real `INV-` numbers never skip because of practice), `ops.invoices.is_test` is true, and the page and the PDF carry a red TEST note. A run that is archived cannot be invoiced and is left out of the "new invoice" run list. Revisions work the same (`TEST-2031-0001-R2`).

## Round 3 (2026-11-12, migration 0134)

- **A rate for each person.** `ops.client_bill_rates.employee_id` (null is the client's standard rate). A line uses the person's own rate in force on the invoice day, else the client's standard rate in force (`calc.ts` `rateForPerson`); a person's rate that starts later does not apply yet. The snapshot stores the rate **per line** (an older snapshot without it reads each line at the header rate); the header holds the standard rate (or the first line's when there is none) and the page and PDF say "Varies by person" when the rates differ. A person with neither a rate of their own nor a standard rate blocks the invoice, named (the preview says so before). The preview reads only the rates of the clients on the run.
- **What happens to an invoice afterwards** (`ops.invoice_events`, append-only: archived, restored, voided, superseded; an invoice's state is its newest event; the reason is encrypted and never in an audit row). A **test** invoice can be **archived** (and restored); a **real** invoice can only be **voided** with a reason (kept, stamped VOID, never reused); void and replaced are final. A **corrected version** is simply the next revision: making an invoice for a run and client that already has one gives `-R2`, `-R3` AND marks the previous live one replaced (so there are never two live versions; a voided one stays voided). Archived, void and replaced invoices leave the default list (a link shows them) and carry a banner on the page and a stamp on the PDF. `invoices.manage` (HR Admin, Executive, Super Admin) for archive, restore and void; `invoices.create` for a corrected version.
