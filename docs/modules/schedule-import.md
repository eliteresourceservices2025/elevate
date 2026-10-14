# Schedule and client import from an attendance sheet

> Notes for `src/modules/schedule-import/`. Read before changing it. Phase 1 (preview only) is built; apply, ending old assignments and aliases are phases 2 and 3.

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

## Decisions made with the owner
HR and Super Admin only; it must also be able to **end old ones**; the sheet layout may vary; hours per week come from the attendance sheet and go into the client assignment's existing field; menu placement under Settings; backdating allowed with the impact shown first; ending is proposed only for people on clients that appear on the sheet.

## Phases to come
2. **Apply**: add and change assignments and schedules (closing the old one the day before), end the ticked ones, history and audit, the backdated impact review, and a bounded automatic attendance rebuild.
3. **Polish**: remembered aliases (confirmed name and client matches), saved column layouts, an export of the decision list, a Playwright test.

## Related, outside the app
`apps/elevate/scripts/schedule-import-*.ts` and `rebuild-historical-october.mts` are the guarded command-line importer used for the October 2026 backfill (runbook 5b7a and 5b7b). They share the same reading and matching ideas; the in-app version replaces them for future sheets.
