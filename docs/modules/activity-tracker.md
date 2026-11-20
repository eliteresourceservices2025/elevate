# ELEVATE Tracker (activity and blurred screenshots)

Design: `docs/superpowers/specs/2026-11-19-elevate-tracker-design.md`. Phase 1 plan (this server side): `docs/superpowers/plans/2026-11-19-elevate-tracker-phase1-server.md`. Code: `apps/elevate/src/modules/activity/`.

Status: **server side (Phase 1) and the monitoring pages (Phase 2a)**. The desktop app (Tauri, Windows and macOS), the download page and releases admin (Phase 2b), and the exceptions inbox, reports, client PDF and digests (Phase 2c) are later. Until the app exists, `pnpm tracker:sim` stands in for it. Plans: `docs/superpowers/plans/2026-11-19-elevate-tracker-phase2a-pages.md`.

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

## Pages (Phase 2a)

| Address | Who | What |
|---|---|---|
| `/attendance` (My time tab) | everyone | "My day" card: enrol a computer with a one-time code, timeline, totals, top apps, screenshots, "who looked at my screenshots" |
| `/activity` | lead (team), HR, Super Admin | Live floor: counts by state, filters, "needs attention", refreshes every minute (menu item "Activity"; a plain 404 for anyone else) |
| `/activity/people/[id]?date=` | same, within reach | One person's day. A person outside the viewer's reach is a plain 404. Opening someone else's screenshot needs a reason, which is audited |
| `/activity/devices` | HR, Super Admin | Every computer, "Needs attention" filter, Sign out |
| `/settings/tracker` | HR, Super Admin | Idle / offline / low-activity thresholds and work-app rules |

The day is in the person's own zone; times are shown in the viewer's. `timeline.ts` is the pure layout behind `TimelineStrip`. Help guides: `content/help/attendance/your-tracker-day.md`, `read-the-activity-pages.md`.

Checked: unit, render and real-database tests for the above, and a live run on 2026-11-20 against the local stack (local Supabase, `pnpm dev`, `pnpm tracker:sim` as the app, fake seed accounts): enrolling with a code, the app's clock-state / segments / screenshot calls, then as the Team Lead (Live floor, person day, a screenshot opened with a reason and audited, 404 for an employee on `/activity`), the employee (My day card, enrollment code with countdown, "Who looked" panel showing the lead's view), and HR (Devices, Settings validation and a save with before/after audit). Looked at in the dark theme at desktop-narrow width and in the light theme at phone width. Not checked: dark theme at phone width, macOS/Windows app (does not exist), long-running refresh, more than a handful of people on the floor.

Found and fixed during that run: hour labels overlapped on a phone, apps with 0 minutes were listed, and a storage outage made the screenshot routes answer a bare 500 (now JSON 503). Setup notes learnt: `pnpm storage:setup` must run on each environment before screenshots work; `pnpm dev:mfa reset` could not find accounts in a database with 1,400+ users.

## Releases, the download page and updates (Phase 2b)

Product name: **ELEVATE Tracker App**. Plan: `docs/superpowers/plans/2026-11-20-elevate-tracker-phase2b-download-releases.md`.

- **Data:** `time.tracker_releases` (version, three note lists, `min_required`, `adds_collection` + `policy_version_id`, status draft / published / withdrawn) and `time.tracker_release_builds` (per platform and kind: `installer` or `update` with its signature, size, SHA-256). A **published release is frozen by a trigger**: only withdrawing is possible; a draft's builds cannot change once it is published. Files live in the private bucket `tracker-builds` (run `pnpm storage:setup`).
- **Builds come from CI, not from HR:** `pnpm tracker:build --version 1.2.0 --platform windows-x86_64 --kind installer --file <path>` (and `--kind update --sig <file.sig>`). It checks the extension, first bytes and size, uploads with the service role, records the SHA-256, and refuses a remote database unless `ELEVATE_ENV` is staging or production. These checks are sanity checks: the real protection is code signing (checked by the operating system) and the updater signature (checked by the app against the public key inside it).
- **Pages:** `/tracker/download` (everyone signed in; OS-aware buttons, "Check the file" SHA-256, install steps, your computers, notes with a "Required update" chip) and `/settings/tracker/releases` (HR, Super Admin: New release, Publish, Withdraw, Delete draft). Installers go through `/api/tracker/download/[platform]`: signed-in check, audit (`tracker.download`: platform and version only), then a redirect to a 60-second link.
- **Rules at publish:** at least one installer; every platform with an installer also has an update build; the version is higher than every released one (withdrawn ones count: a version is never reused); a release that adds data collection names a **published monitoring policy version**.
- **For the app (device token):** `GET /api/tracker/update?platform=&version=` (204 when nothing is newer; otherwise Tauri's dynamic update shape `version, notes, pub_date, url, signature`; the url is our own download route), `GET /api/tracker/update/download/[platform]?version=` (302 to a 60-second link; withdrawn is a 404), `GET /api/tracker/releases/[version]` (notes for "What's new"). The feed never offers an older or equal version or a withdrawn release.
- **Version floor:** when the app sends `X-Tracker-Version` below the highest published, non-withdrawn "Required update", every route except the three above answers `426 { error: "update_required", minVersion }`. No header (the simulator) or an unreadable one is not enforced: it is an operations control, not a security boundary. The floor is cached for a minute.
- **Devices page** shows "Behind (newest x.y.z)" for a computer on an older readable version, and "Needs attention" includes them.
- **Checked live (2026-11-20, local stack, fake files):** created a draft as HR, a publish with no builds refused with a plain reason, `pnpm tracker:build` refused a tiny text file named .exe and an unknown release, registered an installer and an update file, published; the freeze trigger refused a direct edit; as an employee, `/tracker/download` (desktop and phone width, light theme) showed the button, version, date, size, matching SHA-256, install steps, "Your computers" and the notes; the installer route redirected and wrote one audit row (platform and version); a Mac route with no build was a 404; the device feed offered the new version to an older one and answered 204 to a current one; after withdrawing, the page said "not ready" and the feed, update download, notes and installer routes all stopped. **Not checked:** dark theme at phone width, the Publish/Withdraw buttons for Withdraw (done by SQL in the check, the action is covered by tests), a real signed installer or updater run, and Mac.
- Found in that check and fixed: the update download and installer routes answered a bare 500 when storage was waking up (now JSON 503; the installer's audit row is written only after the link exists), the feed's notes now read as a heading and one "- " line per change, and `pnpm tracker:build` no longer says "has storage:setup been run?" when a file already exists.
- **Not built (needs the real app):** the updater's client side, "What's new" box, install at next clock-out, macOS notarization. The Tauri manifest shape must be re-checked against the Tauri version chosen then.

## Clock buttons in the app (Phase 3, Task 0)

`POST /api/tracker/clock` (device token, **exempt from the version floor** so an old app can still clock out): body `{ action: "clock_in" | "break_start" | "break_end" | "clock_out" | "switch_client", clientId?, projectId?, breakMinutes?: 15 | 30 | 60 }`, nothing else is read (no time, address or location). It calls the web clock's `performClock` through `activity/device-clock.ts`, so the rules are identical (server clock, request IP, leave, client assignment, Jibble-clock refusal, audit). Events keep `source = 'web'`; the audit row carries `via: "tracker_app"`. Answers `200 { state, at, outsideAllowedRange }`, `409 { error: "refused", message }` for a plain-language refusal, `403 { error: "no_person" }`. `clock-state` also returns `workingSince`, `onBreak`, `clients` and `clockBlockedReason` (`"jibble"`, or `"selfie"` when the team needs a selfie, which the app cannot take). Tests: `src/app/api/tracker/clock-route.test.ts`, `tests/integration/activity-clock.test.ts`.

## Client projects (owner decision 2026-11-20)

HR Admin and Super Admin add **projects** under a client (Clients page, `people.manage_clients`: `createClientProject`, `renameClientProject`, `archiveClientProject`; audit rows carry ids only). Table `core.client_projects` (name unique per client among active ones; archived, never deleted); `time.clock_events.project_id` (optional, only on `clock_in` and `switch_client`, only with a client; a trigger checks the project is that client's, and a project can never move to another client). People stay assigned to **clients**: anyone assigned to a client can pick any of its active projects. Picking a project alone names its client.

- A person with two or more clients (or a client that has projects) picks on the clock: the web clock header menu and the app's clock-in and "switch" use the same rules (`performClock`: `projectId`; refused with plain reasons: project not available, not that client's, not assigned, already on it). A client with no project is still a valid choice.
- `clock-state` gives the app `clients: [{ id, name, projects: [{ id, name }] }]` and `current: { clientId, clientName, projectId, projectName, since }`. `POST /api/tracker/clock` takes `projectId` and the `switch_client` action.
- **At what time and day:** `loadWorkLog` (`attendance/work-log.ts`, pure part `workLog` in `clock.ts`) lists each stretch with client, project and exact times, breaks left out. "Who the time was for" on My day and the person day page shows it in the viewer's zone. It is evidence of who the time was for, never a pay figure; hours review and the export are unchanged (client minutes per day still come from `segmentMs`).
- **Admin side:** hours review day detail lists "Where the time went" (client · project, exact times in the person's zone, breaks left out; only when a project was chosen; `ReviewDay.work`, cut into the person's own days by `splitByDay`), and Team attendance "Working now" has a "Working on" column (client · project and since when; `loadCurrentWork`). The client split, approval, the hours export and invoices stay client-level and unchanged.
- Not built: per-project totals in hours review and invoices, assigning people to a single project, a per-project rate.

## Flags and jobs

Flags (added to `time.attendance_days.flags` by the nightly rebuild, all "review", never blocking): `tracker_offline` (30+ working minutes with nothing recorded), `low_activity` (under the setting's percent of recorded time, after an hour recorded; default 30), `no_shots` (an hour or more of work, no screenshot). A person with no tracker, or while no policy is published, is never flagged.

Jobs (in `src/inngest/functions.ts` and `health/registry.ts`): `tracker-rollup` (daily 03:00 Phoenix, yesterday and today), `tracker-shot-purge` (daily 03:10), `tracker-offline-alerts` (every 30 minutes; tells the lead once per clock-in when nothing was reported for the grace plus 10 minutes; the notice names the person, never an app).

## Trying it locally

1. `supabase start`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm storage:setup`; publish a monitoring policy (Settings > Policies).
2. Sign in as a seed account, clock in, and create a code with `createEnrollmentCode` (no page yet: call it from a test or a temporary route).
3. `pnpm tracker:sim --code <CODE> --minutes 10`. Check `time.activity_segments` rows exist only inside the clocked-in span, and `time.activity_shots` has a row with `finalized_at`.

The automated checks that cover the same ground without a running server: `pnpm test:integration` (`activity-schema`, `activity-device`, `activity-ingest`, `activity-jobs`, `activity-access`) and the route tests in `src/app/api/tracker/routes.test.ts`.

## Not built yet

Tracker app (Windows, then macOS), `/tracker/download` and the Releases admin (2b), Exceptions inbox, Reports and client PDF, daily digest email, weekly "who viewed" email, day notes, schedule comparison, per-team settings, aggregate reports with the under-5 rule (2c).
