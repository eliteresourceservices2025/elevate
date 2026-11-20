# ELEVATE Activity Tracker (replace Jibble)

## Context
ELEVATE's clock is the one ledger of hours, but proof of work (activity, screenshots) still depends on Jibble. Goal: an ELEVATE-owned tracker that records **activity** (what matters most) plus **blurred screenshots**, so Jibble can be switched off. Modeled on ActivityWatch, but fixed for what it lacks: central server, auth, tamper resistance, privacy, HIPAA safety.

Decided with owner: Windows + macOS; purposes = client proof of work, team-lead coaching, replace Jibble hours/flags, VAs see their own data; **app name only** (no window titles, no URLs); **blur on the VA's machine**; tracker is **evidence + flags only** (hours stay from `time.clock_events`); records **only while clocked in**; **1 random screenshot per 10 min**, viewed by team lead + HR, VA sees own, 30-day retention, client reports show active % only, never images.

## What we borrow from ActivityWatch (and what we change)
| ActivityWatch | ELEVATE |
|---|---|
| Local server on localhost:5600, one SQLite, no auth, single user | Agent buffers locally (encrypted SQLite queue) and uploads batches to ELEVATE over HTTPS with a per-device token; server is the only store |
| Watchers = separate processes | One signed Tauri app with in-process watchers: active app, input idle, screenshot |
| Events = timestamp + duration + data; **heartbeats merged by `pulsetime`** | Same: tiny merged segments, not per-second rows |
| AFK = no input for 3 min; active time = window events intersected with not-afk | Same rule, idle timeout configurable per team (default 3 min); computed server-side |
| Regex categories applied at query time | Same, but ELEVATE-managed (HR/leads edit app -> category -> client work/non-work); applied on read so changes are retroactive |
| Titles/URLs stored in plaintext; no screenshots | App name only; screenshot blurred before leaving the device |
| No tamper resistance, "estimate" | Signed builds, device registration, heartbeat-gap and "tracker offline" flags; we claim evidence, not proof |
| Peer-to-peer sync | Not needed |

## Architecture
- **New app** `apps/tracker/` (Tauri 2 + Rust core, tiny web UI), installers for Windows and macOS. Visible tray icon, always shows state (tracking / clocked out), "What was captured" view.
- **Device auth (new):** admin-approved device enrollment -> one-time code -> long-lived device token (hashed in DB, revocable, bound to employee). Routes under `src/app/api/tracker/*` (outside session auth, like `api/cron/backstop` pattern in `lib/route-access.ts`), rate-limited via `lib/rate-limit.ts`, Zod-validated.
- **Clock coupling:** agent polls clock state; records only between `clock_in` and `clock_out` (breaks pause it). It never creates clock events.
- **Screenshot path:** capture -> downscale -> heavy blur/pixelate on device -> upload via signed upload (three-step pattern of `requestUpload`/`finalizeUpload`) into new private bucket `activity-shots` through `DocumentStorage` (add to `BUCKETS`). Server re-checks bytes/size; random capture time chosen per 10-min window.
- **Data (new `time` tables, RLS on, no public policies):** `tracker_devices`, `activity_segments` (employee, device, start, end, app, state active/idle; append-only), `activity_minutes` (rollup rebuilt from segments, like `attendance_days`), `activity_shots` (path, taken_at, purged_at), `activity_categories` (rules). Segments hold no free text beyond the app name, so no field encryption is needed there; resolution notes use `fieldCrypto`.
- **Flags into existing hours review:** extend `attendance/jobs.ts` nightly build + `flag-severity.ts`/`flag-labels.ts` with e.g. `tracker_offline`, `low_activity`, `no_shots` (replaces Jibble's `no_screenshots`). Non-blocking by default; HR can promote.
- **Jobs (Inngest, keep >= 30 min cadence):** nightly activity rollup, `purgeShots` (30 days, keep row with `purged_at`, mirroring `purgeSelfies`). Register in `src/inngest/functions.ts` AND `health/registry.ts`, wrapped in `track()`.
- **Authz/audit:** new permissions `activity.view_own` (employee), `activity.view_team` (team scope via `timeChainUserIds`, so attendance leads count), `activity.view_all` (HR, Super Admin), `activity.manage` (categories, devices). Matrix rows in `tests/authz/matrix.test.ts`; every screenshot view audited (`activity.shot_view`, ids only); VA is notified of lead views of their screenshots (counts only).
- **Policy gate:** the whole feature stays off until a monitoring policy is published (`monitoringPolicyPublished()`), same as location/selfie/Jibble mirror. Workers are 1099 contractors: counsel review of screenshot monitoring before enabling for real teams. Privacy notice update needed.
- **Never:** window titles, URLs, keystrokes, clipboard, screenshots of non-clocked time, client patient data; no raw screenshots ever stored server-side.

## Function and design (UI)
- `/attendance` -> "My day" card: horizontal **day timeline strip** (active / idle / break / offline segments, ActivityWatch-style), top apps by active minutes, today's blurred shots (VA can see all of them).
- `/team-attendance` -> per-VA row gets a thin activity strip + active % and tracker status; click opens day detail with timeline and shot gallery (extends `hours-day-detail.tsx`).
- `/hours-review` -> new flags next to existing ones.
- **Client proof report:** per client per period: clocked hours, active %, top app categories; no images; feeds Invoices narrative only as read-only totals.
- New `/settings/tracker`: devices (approve/revoke), categories, idle timeout, capture rate, downloads. Follows `PageHeader`/`PageContainer`/`TabNav` conventions and status tokens.
- Replace Jibble last: `docs/modules/jibble.md` stays for people still on the Jibble clock until each team is moved; no import/mirror removal in v1.

## Monitoring side: leads, HR, Super Admin, executives (new page group `/activity`)
Decided: screenshots open freely to HR/Super Admin/leads with every view audited; command center = live floor, exceptions inbox, fleet health, trends and reports; alerts in-app plus digest email; executives aggregate only; clients get a PDF, no login.

**Who sees what** (permissions in `activity/permissions.ts`, matrix rows by hand):
| Role | Timeline + app totals | Screenshots | Floor / inbox / fleet | Reports | Settings |
|---|---|---|---|---|---|
| Employee | own | own (all) | - | own | - |
| Team Lead | team chain (`timeChainUserIds`) | team | team floor + team inbox | team | - |
| HR Admin | all | all, audited | all | all + client PDF | thresholds, categories, devices |
| Super Admin | all | all, audited | all | all | all + audit review |
| Executive | aggregates only (groups under 5 hidden) | never | floor counts | aggregates, client PDF | - |
| Recruiter | - | - | - | - | - |
A screenshot view needs a picked reason (short list: quality check, dispute, coaching, client request), writes `writeAudit()` `activity.shot_view` (ids and reason code only) inside the same transaction.

**1. Live floor (`/activity`, default tab).** Grid of VA cards grouped by team or client: avatar, state dot (active / idle / on break / tracker offline / clocked out), minutes in current state, today's active %, a mini 8-hour strip. Filters: team, client, state, "needs attention". Refresh by TanStack Query every 60 s (live-refresh grid is the allowed exception); counts bar on top (Active 84, Idle 9, Offline 3, Clocked out 29). Heartbeat staleness drives "tracker offline" (no segment for 5 min while clocked in).

**2. Exceptions inbox (`/activity/exceptions`).** Queue of flagged days, newest first: tracker offline over the grace period, idle block over threshold, low-activity block, shots missing, unknown app, device changed. Each row: person, day, flag, severity chip (status tokens), a one-click side drawer with timeline + that block's blurred shots. Resolve with a note (OK, coaching given, tech issue, escalate to HR); resolutions append-only. Feeds `/hours-review` flags (non-blocking unless HR promotes).

**3. Person day view (drawer and page `/activity/people/[id]`).** Date picker; full-width timeline strip (active / idle / break / offline, hover = app and minutes); stacked bar by category; top apps; shot filmstrip with a lightbox; compare to schedule and clock events side by side; "Add note" to the day. VA sees the same page for themselves with a "Who viewed this" panel.

**4. Fleet health (`/activity/devices`).** Table: person, OS, app version, last seen, permissions OK, upload queue size, last error. Actions: approve enrollment, revoke, force re-enroll, mark expected-offline. Banner for outdated or unsigned versions; macOS "Screen Recording not granted" listed as its own filter.

**5. Trends and reports (`/activity/reports`).** Active % by team, client and week; vs schedule; distribution rather than ranking (no leaderboard of people, to avoid gaming and morale harm); aggregate tables only, groups under 5 hidden on the server like Analytics. **Client proof PDF**: per client and period, clocked hours, active %, top categories, no names beyond the VA's display name and no images; generated by HR/Executive, ELEVATE sends nothing (same stance as invoices). Per-person detail export is HR only and audited.

**6. Alerts.** In-app bell via `notify()`: tracker offline over 15 min while clocked in (to the lead first, using `timeNoticeUserIds`), device revoked, outdated build. Daily digest through `ops.email_queue`: counts and a link only. No names, apps or images in email or notifications.

**7. Settings (`/settings/tracker`).** Per team or client: idle timeout, offline grace, low-activity %, screenshot interval, categories (app -> work / non-work / unknown, with parent groups like ActivityWatch). Every change is history-kept (before/after) and applies from the next day, so past days are not rewritten silently.

**8. Guardrails on the monitors.** Nobody views their own report as a monitor; audit rows carry ids, reason code and counts. Weekly VA transparency summary: "your activity was viewed N times (lead N, HR N)" with a "Question for HR" link; Super Admin audit view of view counts per viewer, outliers highlighted, HR Admin cannot see their own row. No screenshot download button (view-only, signed 60-second image URL, no right-click save intent: cannot be fully prevented).

**Navigation:** new sidebar entry "Activity" at `/activity` with `TabNav` for Live, Exceptions, Devices, Reports; "My day" stays on `/attendance` and links in. Pages use `PageHeader`/`PageContainer width="full"`; empty states via `EmptyState`.

## Download page and releases: "ELEVATE Tracker App" (product name)
Decided: page at `/tracker/download` for all signed-in staff (own menu item "ELEVATE Tracker App"); HR/Super Admin publish releases in ELEVATE; the app auto-updates; a "What's new" dialog shows the notes after an update. No public download, no bell or email per release.

**Page `/tracker/download`** (`PageHeader` "ELEVATE Tracker App", `PageContainer width="wide"`):
- Hero card: detects the visitor's OS and offers the matching installer (Windows `.msi`/`.exe`, macOS `.dmg`), with the other as a secondary link; shows version, release date, size and SHA-256 so IT can verify.
- "Install in 3 steps" with the permissions each OS needs (macOS Screen Recording and Accessibility, with a short picture guide from the Help Center) and a link to the Help guide; plain statement of what it records and never records (links to the monitoring policy).
- "Your status" strip: this person's enrolled devices, version, last seen, with an enrollment code button (`Add this computer`).
- **Release notes list**: newest first, each with version, date, and three groups **Added / Improved / Fixed** (sentence-case bullets, plain English), plus a badge for "Required update" when it raises the minimum version. Older versions collapse; filter by All / Required.
- System requirements (Windows 10 21H2+, macOS 12+) and a "Need help?" link to Contact support.

**Releases admin (`/settings/tracker` > Releases tab, `tracker.manage_releases`: HR Admin and Super Admin):**
- Table `time.tracker_releases` (version semver, platform builds with storage path + SHA-256 + size, notes `added[] / improved[] / fixed[]`, `min_required` flag, status draft/published/withdrawn, published_by/at). Published rows are frozen by trigger like policy versions; a bad build is withdrawn (never deleted) and the previous one becomes current.
- Flow: CI builds and signs installers, then uploads to the private bucket `tracker-builds` via the existing three-step upload (HR never handles binaries); HR writes the notes, previews the public card, publishes. Publishing is audited (ids, version only).
- Notes are Markdown-free structured lists (rendered as React text, never HTML), consistent with the app's no-raw-HTML rule.
- A change that adds new data collection cannot be published without linking a published monitoring-policy version (blocks silent scope creep).

**Delivery and auto-update:** installers via 60-second signed downloads through our own route `/api/tracker/download/[platform]` (audited `tracker.download`, counts only, session-authenticated); the agent updates via Tauri's updater pointing at `/api/tracker/update?platform&version` (device-token auth, returns a signed update manifest, signature verified by a public key baked into the app). Installs at the next clock-out or restart, never mid-shift. Versions below `min_required` get upload refused with a clear "Update required" response and an in-app banner; Fleet health (`/activity/devices`) shows who is behind.

**"What's new" dialog:** after an update, the agent shows the release's Added / Improved / Fixed once (fetched from `/api/tracker/releases/[version]`), with a "See all releases" link to the download page. The app also has Help > Release notes.

**Permissions/tests:** `tracker.download` (all staff but guests), `tracker.manage_releases` (HR Admin, Super Admin); matrix rows + per-role authz tests; guest users refused (Messages-only rule).

## Approaches considered
1. **Tauri desktop agent (recommended):** ~10 MB, low RAM (VAs run heavy browser/EMR stacks), Rust gives reliable OS APIs (Windows foreground window/last-input, macOS accessibility/screen-recording), same stack ActivityWatch is moving to (aw-tauri).
2. Electron: faster for JS-only team, but ~150 MB and heavier on VA laptops.
3. Browser extension/PWA only: cannot see other apps or screenshot outside the tab; fails the purpose.

## Phasing (separate projects, in order)
1. Server side: schema, device enrollment + token auth, ingest API, rollups, flags, permissions/tests, a **simulator script** instead of a real agent.
2. UI: My day, `/activity` (Live, Exceptions, Devices, Reports), shot viewer, categories, `/tracker/download` + Releases admin.
3. Windows agent (watchers, idle, blur, upload, installer + signing).
4. macOS agent (permissions onboarding for Screen Recording/Accessibility, notarization).
5. Pilot with one team under a published policy, compare to Jibble for 2-4 weeks, then move teams and retire Jibble.

## Open items for later (not blocking design)
Code-signing certificates (Windows EV/macOS Developer ID), auto-update channel, tamper heuristics (e.g., synthetic-input detection), offline buffer limit, MDM/silent install for IT, cost of storage at ~125 VAs x ~48 shots/day (blurred ~30-60 KB each, roughly 0.2 GB/day).

## Verification (when built)
`pnpm lint && pnpm typecheck && pnpm test` (authz for all 6 roles + guest, validators, purge job); `pnpm test:integration` for append-only triggers, rollup SQL, token hashing; ingest API tests with the simulator; Playwright happy path (approve device -> upload -> VA/lead views); `pnpm build` and check the built app; manual run of the Windows agent on a real machine, confirming blur happens before upload (inspect the network payload) and nothing records while clocked out.
