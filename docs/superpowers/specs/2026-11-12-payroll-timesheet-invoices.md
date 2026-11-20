# Payroll round 2: overtime, checks, draft updates, Jibble timesheet import, client invoices

Requested 2026-11-12 by the payroll team (HR and executives) after testing. Decisions below were made with the owner the same day.

## Decisions

| Topic | Decision |
|---|---|
| Overtime | Each person's OT = their own hourly rate (monthly rate / (2 x divisor) / hours per day) x a percent. **Defaults when the setting is blank:** regular OT 125%, rest day 130%, rest day past 8 hours 169%; holiday pay stays 100%. A blank setting means "standard", not "missing", so OT pays immediately. Amounts can be typed as hours or minutes (`1.5 h`, `90 m`, `1:30`). |
| Checks | Everything becomes a **note** except a line that cannot be read. Missing OT rate, negative pay, part cutoff over a full one, unassigned suggestion, own line unchecked and out-of-date lines no longer block sending. The Approver still decides; approval keeps its own-line rule for the Approver's own line and the separation of duties. |
| Draft run people | A draft run can be **updated from the Rates tab** (adds people whose pay line is now in force, moves a line to a newer version of its rate, drops lines no longer in force) and a Preparer can **remove a person** from a draft. A removed line is kept with `excluded = true` (items are append-only) and is ignored everywhere. |
| Jibble | **Manual file import, suggestions only.** HR uploads the Jibble "Custom Timesheets" export on a draft run. Only totals per person are read (payroll hours, OT by kind, PTO hours). They are written as **suggested** items the Preparer confirms or edits. Nothing goes into ELEVATE's own time records; no clock times, screenshots or location are kept. Rows are one encrypted payload, wiped on apply, on discard and after 14 days. This amends rule 10 in `CLAUDE.md`. |
| Jibble fills | Client payroll hours (reference and invoice); OT (Daily + Double + Weekly OT to "OT regular day", Rest day OT to "OT rest day"); Public holiday OT to holiday pay; PTO hours to PTO days (hours / hours per day). |
| Jibble matching | Jibble member -> pay line (person + client). Matched by remembered member code, then by name; unmatched members are chosen by the Preparer and remembered by code. A person with two clients has two Jibble members (for example `BP-1` and `BPT-1`). |
| Invoice | Per client and run: total **client payroll hours** x the client's **hourly billing rate in dollars** (set once, dated, changeable). One line per person with their hours. PDF the executives download and send themselves. Executives, Super Admin and **HR Admin** can create and see invoices. Any run with client hours, draft included (a draft invoice says Draft). Invoices carry hours and dollars, never a person's pay: they read only the `client_hours` items, never a run line's pay figures. |

## Design notes

- **Duration entry.** Minute-type items accept `90`, `90m`, `1.5h`, `1h30m`, `1:30`. A bare whole number stays minutes. The Amounts window has a unit choice (hours or minutes, hours for OT and holiday pay).
- **Defaults.** `DEFAULT_OT_BP` in `calculate.ts`; `snapshotOf` uses it when a column is null. Settings show the default as a placeholder.
- **Draft sync.** `syncRunPeople` (action `payroll.prepare`): lock, resolve lines for the period, insert missing run lines, repoint a run line to the newer version of its pay line (recompute, clears its check), exclude lines no longer in force. `excludeRunLine` removes one person with a reason. Migration 0129 adds `pay_run_lines.excluded`.
- **Invoices (migration 0130).** `payroll.client_bill_rates` (append-only, dated, rate encrypted) and `payroll.invoices` (a snapshot at creation: encrypted payload with lines, rate, hours, total; numbered `INV-YYYY-NNNN`). New permission actions `invoices.view`, `invoices.create`, `invoices.manage_rates` for hr_admin, executive and super_admin. New menu item and pages `/invoices`, `/invoices/rates`, `/invoices/[id]`, PDF at `/api/invoices/[id]`.
- **Import (migration 0131).** `payroll.timesheet_imports` (encrypted payload, per run) and `payroll.jibble_matches` (member code -> pay line). Our own small zip reader (central directory, `node:zlib`) because Jibble writes streamed zips that `read-excel-file` cannot open.
- **Out of scope.** Sending invoices by email, tax, payment tracking on invoices, reading Jibble by API.
