# Schedule and client import from an attendance sheet

> Notes for `src/modules/schedule-import/`. Read before changing it. All three phases are built: preview, apply (ending old assignments), and remembered matches, saved layouts and the review list.

## What it is
Settings > Import schedules and clients (`/settings/import-schedules`, `/[id]`; permission `scheduleimport.manage`: HR and Super Admin only). HR uploads the attendance sheet the team already keeps (CSV or XLSX, 2 MB) and sees what ELEVATE would change: client assignment, schedule, time zone and hours per week for each person. **It never reads worked hours**: ELEVATE is the only source of hours (CLAUDE.md rule 9), and the sheet's own "Total Hours" column is ignored because HR's formulas produce negative and impossible totals.

## Phase 1 (built): upload, read, match, preview. Read-only
- **Layouts** (`reader.ts`, pure): *day blocks* (a date line, a header line with Name and Client, then a row per person, repeated per day: HR's current sheet; the header row may start with a weekday word, even misspelled) and a plain *table* (HR says which column is the name, client, schedule, date and clock-in). A day counts when the person has a clock-in time; "Training" rows and rows with no clock-in are skipped.
- **Schedule text** (`parse.ts`): "8:00 am - 5:00 pm AZ", "to", zones AZ/ET/CT/MT/PT, day patterns (T-F read as Tue to Fri, with a note to confirm). Anything else is sent to a person with the reason.
- **Matching** (`plan.ts`, pure): names compared without accents, punctuation or middle initials; client names compared apart from case and punctuation. Zero or several matches, a person on two clients, an unreadable schedule, or an unknown client go to **Needs a person** with the reason: nothing is guessed. A schedule that changed during the sheet uses the latest text and is flagged.
- **Hours per week** is estimated from the schedule ((shift length minus the break) x working days) and shown as an estimate. **The unpaid break is assumed** from the shift length (8 h or more: 60; 6 to 8 h: 30; else 0) and HR confirms it.
- **Preview** compares with live open assignments and schedules: Would change, Already matches, Needs a person, and people on a client that is on the sheet but not on it ("may have left": never ended automatically). Dates more than 7 days back are labelled backdated.
- **Privacy:** the observations are one encrypted payload (`ops.schedule_import_batches`, context `schedule_import:<id>`, RLS on), wiped when discarded and after 14 days by the daily import purge. Audit entries hold counts only (`scheduleimport.stage`, `scheduleimport.discard`). The upload screen warns against client or patient information.
- Tests: `schedule-import.test.ts` (pure), `tests/authz/schedule-import-actions.test.ts`, `tests/integration/schedule-import-preview.test.ts`.

## Phase 2 (built): apply
- **What HR does** on the preview: tick the rows to apply (rows with no note start ticked; rows with a note start unticked), adjust the assumed break and the estimated hours per row, tick the people to end (with a last day), and confirm backdated changes. `applyScheduleImport` (`scheduleimport.manage`, rate limit `upload`) then calls `applyBatch` (`apply.ts`).
- **Refused when stale:** the preview carries a digest of everything shown (rows, current records, impact counts, people not on the sheet). If ELEVATE changed since, the apply is refused and the preview must be reloaded.
- **What it writes**, per person in its own savepoint under the clock lock: a new assignment (start = the first day on the sheet; hours = the estimate or HR's value) with employment history; for a client change the old open assignment ends the day before and history records it; for the same client only the hours are filled or corrected; a schedule is added and the previous one closed the day before; an in-app notice tells the person their schedule was set. Audit entries (`assignment.create`, `assignment.end`, `assignment.update`, `schedule.assign`, `scheduleimport.apply`) carry ids and counts, never names.
- **A row that no longer fits is skipped, not forced** (the person left, the client is inactive, a later-dated schedule or an overlapping assignment exists, the old assignment started on or after the new date) and listed with the reason; the rest go ahead. A skipped row is rolled back whole.
- **Ending**: only assignments HR ticked in "On a client but not on the sheet", on the chosen last day (not in the future, not before the start). Nothing is ended automatically.
- **Backdated** (more than 7 days back): allowed for HR and Super Admin only after the screen shows the counts of attendance days, approved hours records, leave and extra-hours requests that already exist from that date and HR ticks an acknowledgment. Clock events are never touched.
- **Rebuild:** after the response (`after()`), `rebuildAfterApply` recomputes attendance days for the people changed from their clock events (never the sheet) for up to the last 35 days; older dates need the maintenance command in runbook 5b7b. Days already approved that now differ show "changed after approval" and must be approved again; exports already made are not rewritten.
- Migration 0068 adds `applied_at`, `applied_by`, `result` and the status `applied`. The payload is wiped when applied. Tests: `tests/integration/schedule-import-apply.test.ts`, `tests/authz/schedule-import-actions.test.ts`.

## Phase 3 (built): remembered matches, saved layouts, review list
- **Resolve on screen:** in "Needs a person", a row that failed on a person or a client (`Decision.kind` `person` or `client`) has a list of active people or clients to choose from and "Match and remember" (`rememberScheduleImportMatch`). The match is stored in `ops.schedule_import_aliases` (migration 0069, RLS on) keyed by the **normalized spelling** (name words sorted; client name without case or punctuation), one row per spelling, pointing at exactly one person or client (check constraint). The plan prefers a remembered match to guessing from the name and ignores one whose target is no longer active. Rows that are `other` (a schedule that cannot be read, a person on two clients) cannot be resolved by choosing: fix the sheet or the records.
- **Closest match:** where no person or client matched, the closest active record is pre-selected in the dropdown when one is clearly nearest (`closest()` in `parse.ts`: same letters ignoring case and punctuation, one name containing the other such as In-House and Inhouse Medical, or the share of shared letter pairs; nothing is suggested when two are about equally close). A person still confirms it.
- **Forget:** "Remembered matches" on the uploads page lists them with a Forget button (`forgetScheduleImportMatch`). Audit: `scheduleimport.alias_save` / `alias_remove` with the kind only.
- **Saved layouts:** for a plain table, the column choices are stored in `ops.schedule_import_layouts` by a hash of the normalized header row; the next upload of the same header finds them and says so.
- **Review list:** "Download the lists to review (CSV)" exports "Needs a person" and "On a client but not on the sheet" (cells protected against spreadsheet formulas).
- Tests: `schedule-import-aliases.test.ts` (real database), the plan tests, the per-role authz tests, and `tests/e2e/schedule-import.spec.ts` (Playwright: upload, preview, apply, and an ordinary employee gets 404).

## Decisions made with the owner
HR and Super Admin only; it must also be able to **end old ones**; the sheet layout may vary; hours per week come from the attendance sheet and go into the client assignment's existing field; menu placement under Settings; backdating allowed with the impact shown first; ending is proposed only for people on clients that appear on the sheet.

## Not built
Several clients for one person on the same sheet cannot be resolved on screen yet (it needs a choice of which is current), and the in-app version does not read pay or hours.

## Related, outside the app
`apps/elevate/scripts/schedule-import-*.ts` and `rebuild-historical-october.mts` are the guarded command-line importer used for the October 2026 backfill (runbook 5b7a and 5b7b). They share the same reading and matching ideas; the in-app version replaces them for future sheets.
