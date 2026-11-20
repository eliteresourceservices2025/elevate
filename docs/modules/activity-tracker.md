# ELEVATE Tracker (activity and blurred screenshots)

Design: `docs/superpowers/specs/2026-11-19-elevate-tracker-design.md`. Phase 1 plan (this server side): `docs/superpowers/plans/2026-11-19-elevate-tracker-phase1-server.md`. Code: `apps/elevate/src/modules/activity/`.

Status: **server side only (Phase 1)**. The desktop app (Tauri, Windows and macOS), the pages (`/activity`, My day, `/tracker/download`, Releases), the client PDF and the digest email are later phases. Until the app exists, `pnpm tracker:sim` stands in for it.

## Hard rules

- **Evidence and flags only.** Nothing here writes `time.clock_events` or changes hours. Hours still come from the clock (rule 9 in CLAUDE.md). Tracker flags enter the day through the nightly attendance rebuild and never block approval.
- **App name only.** No window titles, URLs, keystrokes or clipboard are accepted, stored or logged: the request schema has no field for them, and unknown fields are dropped.
- **Only while clocked in.** `ingestSegments` cuts every segment to the working time (clocked-in sessions minus breaks); time before clock-in, on a break or after clock-out is dropped. Screenshots are refused outside working time too.
- **Off until a monitoring policy is published** (`monitoringPolicyPublished()`): no code can be created or redeemed, nothing is ingested, no flags are set.
- **Screenshots are blurred on the person's computer.** The server cannot prove a picture was blurred; it checks the real type (JPEG or PNG by its bytes), at most 300 KB, one per person per 10-minute window, taken in the last 30 minutes while working. Files live in the private bucket `activity-shots` (run `pnpm storage:setup`), are deleted after 30 days (row kept, `purged_at`), and are opened only through `viewShot` (60-second link).
- **Segments are append-only** (database trigger). Retries are safe: overlapping time from any of the person's computers is trimmed, so nothing counts twice.
- **Device tokens** are 32 random bytes; only the SHA-256 hash is stored, and it can never change. Enrollment codes are 8 characters, hashed, single use, valid 15 minutes. A device is active as soon as the code is redeemed; HR or the person can revoke it (`revokeDevice`).
- **Every screenshot view is audited** (`activity.shot_view`: shot id, person id, reason code only). Own screenshots need no reason (audited as `own`); a lead, HR and Super Admin must pick a reason; the Executive and Recruiter never see someone else's.

## Who sees what

| Permission | super_admin | hr_admin | team_lead | recruiter | executive | employee |
|---|---|---|---|---|---|---|
| `tracker.enroll`, `activity.view_own` (own) | O | O | O | O | O | O |
| `tracker.revoke_device` | A | A | O | O | O | O |
| `activity.view` (timeline, floor) | A | A | T | - | - | O |
| `activity.view_shots` | A | A | T | - | - | O |
| `activity.view_summary` (aggregates, not built yet) | A | A | T | - | A | - |
| `activity.manage` (categories, everyone's devices) | A | A | - | - | - | - |

Team scope uses the time chain (`timeChainUserIds`), so an attendance lead counts. The floor (`listFloor`) is for leads and HR only.

## Pieces

| File | Job |
|---|---|
| `logic.ts` | Pure rules: sanitize, validate, clip to working time, de-duplicate, active percent, categories, day summary, day flags |
| `ingest.ts` | `clockStateFor`, `ingestSegments`, `requestShot`, `finalizeShot` (used by the routes) |
| `device-auth.ts`, `device-token.ts` | Redeem a code, authenticate a bearer token; pure secret helpers |
| `src/app/api/tracker/*` | `enroll`, `clock-state`, `segments`, `shots/request`, `shots/finalize` (outside the sign-in gate; each checks the device token, a rate limit and a Zod body itself) |
| `actions.ts`, `shot-actions.ts` | `createEnrollmentCode`, `revokeDevice`, `saveCategory`, `viewShot` |
| `queries.ts`, `access.ts` | `getMyDay`, `getPersonDay`, `listFloor`, `listCategories`, `listDevices`; scope checks that run before the database |
| `jobs.ts`, `flags.ts` | Daily totals, screenshot purge, offline alerts; day flags |

## Flags and jobs

Flags (added to `time.attendance_days.flags` by the nightly rebuild, all "review", never blocking): `tracker_offline` (30+ working minutes with nothing recorded), `low_activity` (under the setting's percent of recorded time, after an hour recorded; default 30), `no_shots` (an hour or more of work, no screenshot). A person with no tracker, or while no policy is published, is never flagged.

Jobs (in `src/inngest/functions.ts` and `health/registry.ts`): `tracker-rollup` (daily 03:00 Phoenix, yesterday and today), `tracker-shot-purge` (daily 03:10), `tracker-offline-alerts` (every 30 minutes; tells the lead once per clock-in when nothing was reported for the grace plus 10 minutes; the notice names the person, never an app).

## Trying it locally

1. `supabase start`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm storage:setup`; publish a monitoring policy (Settings > Policies).
2. Sign in as a seed account, clock in, and create a code with `createEnrollmentCode` (no page yet: call it from a test or a temporary route).
3. `pnpm tracker:sim --code <CODE> --minutes 10`. Check `time.activity_segments` rows exist only inside the clocked-in span, and `time.activity_shots` has a row with `finalized_at`.

The automated checks that cover the same ground without a running server: `pnpm test:integration` (`activity-schema`, `activity-device`, `activity-ingest`, `activity-jobs`, `activity-access`) and the route tests in `src/app/api/tracker/routes.test.ts`.

## Not built yet

Tracker app (Windows, then macOS), My day / `/activity` pages / `/tracker/download` and the Releases admin, client proof PDF, daily digest email, weekly "who viewed" summary for the person, thresholds screen (`activity_settings` has defaults only), per-team settings, aggregate reports with the under-5 rule.
