# ELEVATE Tracker, Phase 1 (server side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build everything the ELEVATE Tracker desktop app will talk to: device enrollment and tokens, an ingest API for activity segments and blurred screenshots, rollups, flags, purge, permissions, read queries, and a simulator that stands in for the real app.

**Architecture:** New module `src/modules/activity/` (apps/elevate). Pure logic (merge, clip to working time, active minutes, categories, offline detection) is separate from database code. The tracker authenticates with a per-device bearer token (hashed at rest) on `/api/tracker/*` routes, which sit outside the session gate like `api/cron/backstop`. Activity never creates clock events and never changes hours; it adds evidence and flags only.

**Tech Stack:** Next.js 16 route handlers, Drizzle + hand-written trigger SQL, Zod, Vitest (unit, authz, integration), Inngest, `DocumentStorage`, Upstash limits.

**Spec:** `docs/superpowers/specs/2026-11-19-elevate-tracker-design.md` (this plan covers its Phasing step 1 only; UI, the agents and releases are later plans).

All paths below are relative to `apps/elevate/` unless they start with `docs/`.

## Global Constraints

- App name only: no window titles, URLs, keystrokes or clipboard are accepted, stored or logged.
- Record only while clocked in: segments outside a working interval (before clock-in, on a break, after clock-out) are dropped by the server.
- Evidence and flags only: nothing in this plan writes `time.clock_events` or edits hours. `attendance_days` stays rebuilt from events; activity flags enter through that rebuild.
- One screenshot per employee per 10-minute window; blurred JPEG or PNG, at most 300 KB; 30-day retention (file deleted, row kept with `purged_at`).
- The whole feature is off until a monitoring policy is published (`monitoringPolicyPublished()`), and flags apply only to people with an active device.
- Device tokens: 32 random bytes, base64url, only the SHA-256 hash stored; enrollment codes are 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, single use, valid 15 minutes.
- New tables: schema `time`, `.enableRLS()`, no public policies; `activity_segments` is append-only by trigger.
- Scheduled jobs: nothing more often than every 30 minutes; each job goes in `src/inngest/functions.ts` AND `src/modules/health/registry.ts`, wrapped in `trackJob`.
- Audit rows carry ids, reason codes and counts only. Error responses never include stack traces.
- Dates stored as `timestamptz` UTC; the day of a segment is computed in the person's own zone with `src/lib/time.ts`.

## Review Focus

- Retried upload of the same batch (network drop) must not double-count: overlapping or duplicate segments from one device are ignored, not rejected as a whole.
- Device clock wrong (segment in the future, or days old): rejected per segment with a reason count, never stored.
- A segment that straddles clock-out or a break is clipped to the working part, not dropped or kept whole.
- Enrollment code used twice, expired, or typed in lowercase/with spaces; a revoked token still being used mid-shift.
- Screenshot burst (agent bug sends 50 in a minute) or a 5 MB "screenshot": refused by window and size limits.

---

### Task 1: Pure activity logic

**Files:**
- Create: `src/modules/activity/logic.ts`
- Test: `src/modules/activity/logic.test.ts`

**Interfaces:**
- Produces:
  - `type RawSegment = { start: number; end: number; app: string; state: "active" | "idle" }` (ms since epoch)
  - `type Interval = { start: number; end: number }`
  - `sanitizeApp(input: string): string | null` (trim, remove control characters, collapse spaces, max 80 chars, `null` when empty)
  - `validateSegment(s: RawSegment, nowMs: number): "ok" | "future" | "too_old" | "inverted" | "too_long"` (future: end > now + 2 min; too_old: start < now - 36 h; too_long: duration > 30 min)
  - `clipToIntervals(s: RawSegment, working: readonly Interval[]): RawSegment[]` (pieces inside working intervals; zero-length pieces dropped)
  - `dropOverlaps(incoming: RawSegment[], existing: readonly Interval[]): { kept: RawSegment[]; dropped: number }` (a piece overlapping an existing interval is trimmed to its uncovered parts)
  - `activeMinutes(segments: readonly RawSegment[]): { activeMs: number; idleMs: number }`
  - `activePercent(activeMs: number, workedMs: number): number` (0-100 integer, 0 when `workedMs` is 0, capped at 100)
  - `categorize(app: string, rules: readonly { pattern: string; category: "work" | "non_work"; rank: number }[]): "work" | "non_work" | "unknown"` (case-insensitive regex; highest rank wins; invalid regex ignored)
  - `isTrackerOffline(lastSegmentEndMs: number | null, nowMs: number, graceMs: number): boolean`
  - `shotWindow(atMs: number): number` (`Math.floor(atMs / 600_000)`)

- [ ] **Step 1: Write failing tests** covering: `sanitizeApp("  Chrome\u0007  ")` is `"Chrome"`, 200-char name is cut to 80, whitespace-only is `null`; `validateSegment` returns each reason at its boundary; `clipToIntervals` with a segment 10:00-10:30 and working 10:10-10:20 returns one 10:10-10:20 piece, and a segment fully on break returns `[]`; `dropOverlaps` with an existing 10:00-10:10 and incoming 10:05-10:20 keeps 10:10-10:20 and counts 0 dropped whole segments, an exact duplicate is dropped (dropped = 1); `activePercent(0, 0)` is 0 and `activePercent(2h, 1h)` is 100; `categorize` picks the higher rank and ignores `"("` as a pattern; `isTrackerOffline(null, now, g)` is true.
- [ ] **Step 2: Run** `pnpm vitest run src/modules/activity/logic.test.ts` and confirm FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above in `logic.ts` (no imports from db or Next).
- [ ] **Step 4: Run** the same command and confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): pure tracker logic`.

---

### Task 2: Schema, migration, triggers

**Files:**
- Create: `src/modules/activity/schema.ts`
- Create: `drizzle/0165_activity_tracker.sql` (via `pnpm db:generate`, then append trigger SQL by hand following the style of `drizzle/0162_chat_access_requests.sql`)
- Modify: `drizzle.config.ts` only if schemas are listed there (check; add `src/modules/activity/schema.ts` alongside `src/modules/attendance/schema.ts`)
- Test: `tests/integration/activity-schema.test.ts` (follow an existing file in `tests/integration/`)

**Interfaces:**
- Produces (Drizzle tables, all in schema `time`): 
  - `trackerDevices`: `id uuid pk`, `employeeId`, `name text` (computer name chosen by person, max 60), `os text` (`windows|macos`), `appVersion text`, `tokenHash text unique`, `status text` (`active|revoked`), `createdAt`, `lastSeenAt`, `revokedAt`, `revokedBy`, `permissionsOk boolean default true`, `queueSize int default 0`.
  - `trackerEnrollmentCodes`: `id`, `employeeId`, `codeHash text unique`, `expiresAt`, `usedAt`.
  - `activitySegments`: `id`, `employeeId`, `deviceId`, `startedAt`, `endedAt`, `app text`, `state text` (`active|idle`), `receivedAt default now()`; index on `(employeeId, startedAt)`; check `endedAt > startedAt`.
  - `activityMinutes`: `employeeId`, `date`, `activeMinutes int`, `idleMinutes int`, `workMinutes int`, `nonWorkMinutes int`, `topApps jsonb` (array of `{app, minutes}` max 10); primary key `(employeeId, date)`.
  - `activityShots`: `id`, `employeeId`, `deviceId`, `windowIndex bigint`, `storagePath text unique`, `takenAt`, `finalizedAt`, `purgedAt`; unique `(employeeId, windowIndex)`.
  - `activityCategories`: `id`, `pattern text`, `category text` (`work|non_work`), `rank int`, `createdBy`, `archivedAt`.
  - `activitySettings`: single logical row per scope key (`scope text pk`, `idleTimeoutSeconds int default 180`, `offlineGraceMinutes int default 5`, `lowActivityPercent int default 30`).
- Trigger SQL: `time.activity_segments` rejects UPDATE and DELETE (copy the pattern used for `clock_events`); `tracker_devices.token_hash` cannot be updated once set.

- [ ] **Step 1: Write the failing integration test** asserting: inserting a segment works, updating or deleting it raises, `endedAt <= startedAt` raises, a second shot for the same `(employeeId, windowIndex)` raises unique violation, and every new table has RLS enabled (`select relrowsecurity from pg_class`).
- [ ] **Step 2: Run** `pnpm test:integration -- activity-schema` (needs `TEST_DB_ADMIN_URL`) and confirm FAIL.
- [ ] **Step 3: Implement** `schema.ts` with the tables above (`time.table(...)...enableRLS()`), run `pnpm db:generate`, append the trigger SQL to the generated migration, and apply with the integration setup.
- [ ] **Step 4: Run** the integration test and `pnpm typecheck`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): tracker tables, append-only segments`.

---

### Task 3: Device enrollment and token auth

**Files:**
- Create: `src/modules/activity/device-auth.ts` (server-only helpers, no "use server")
- Create: `src/modules/activity/actions.ts` ("use server": person-facing actions)
- Create: `src/modules/activity/validators.ts`
- Test: `src/modules/activity/device-auth.test.ts`, `tests/authz/activity-actions.test.ts` (extended in Task 6)

**Interfaces:**
- Consumes: Task 2 tables.
- Produces in `device-auth.ts`:
  - `hashSecret(value: string): string` (SHA-256 hex)
  - `newEnrollmentCode(): string` (8 chars, alphabet above) and `normalizeCode(input: string): string` (uppercase, strip spaces and dashes)
  - `newDeviceToken(): { token: string; hash: string }`
  - `redeemEnrollmentCode(input: { code: string; name: string; os: "windows" | "macos"; appVersion: string; now?: Date }): Promise<{ ok: true; token: string; deviceId: string } | { ok: false; reason: "invalid" | "expired" | "used" | "policy" }>` (single transaction; marks code used; refuses with `policy` when no monitoring policy is published)
  - `authenticateDevice(authorization: string | null): Promise<{ deviceId: string; employeeId: string } | null>` (parses `Bearer`, hashes, active devices only, updates `lastSeenAt` at most once a minute)
- Produces in `actions.ts` (each starts with `requireUser()`, then `authorize(user, ..., resource)`):
  - `createEnrollmentCode(): Promise<ActionResult<{ code: string; expiresAt: string }>>` (own; permission `tracker.enroll`; invalidates the person's earlier unused codes; audit `tracker.code_created`)
  - `revokeDevice(input: { deviceId: string }): Promise<ActionResult<null>>` (the person for their own device, HR/Super Admin for anyone; permission `tracker.revoke_device`; audit `tracker.device_revoked`)

- [ ] **Step 1: Write failing unit tests** (DB mocked or fake executor): `normalizeCode(" abcd-2345 ")` is `"ABCD2345"`; `newDeviceToken().hash` equals `hashSecret(token)` and the token is 43 chars; `authenticateDevice(null)`, `"Basic x"` and `"Bearer"` all return `null`.
- [ ] **Step 2: Write failing integration cases** in `tests/integration/activity-device.test.ts`: redeem works once and a second redeem returns `used`; an expired code returns `expired`; no published monitoring policy returns `policy`; a revoked device's token authenticates to `null`.
- [ ] **Step 3: Run** both and confirm FAIL.
- [ ] **Step 4: Implement** per the signatures; use `crypto.randomBytes` and `timingSafeEqual` is unnecessary because lookup is by hash; reuse `monitoringPolicyPublished` from `src/modules/attendance/service.ts`.
- [ ] **Step 5: Run** the tests and `pnpm typecheck`; confirm PASS.
- [ ] **Step 6: Commit** `feat(activity): device enrollment and tokens`.

---

### Task 4: Ingest API routes

**Files:**
- Create: `src/app/api/tracker/enroll/route.ts` (POST)
- Create: `src/app/api/tracker/clock-state/route.ts` (GET)
- Create: `src/app/api/tracker/segments/route.ts` (POST)
- Create: `src/app/api/tracker/shots/request/route.ts` (POST) and `src/app/api/tracker/shots/finalize/route.ts` (POST)
- Create: `src/modules/activity/ingest.ts` (server-only service used by the routes)
- Modify: `src/lib/rate-limit.ts` (add policies `trackerEnroll: { requests: 10, window: "1 h" }`, `trackerIngest: { requests: 120, window: "10 m" }`; decide fail-open vs closed like `clock`/`presence` in `FAIL_OPEN`: ingest fails open)
- Modify: `src/modules/documents/storage.ts` (add `tracker: "activity-shots"` to `BUCKETS`) and `scripts` that create buckets (`pnpm storage:setup`, find it via `grep -rn "call-recordings" scripts src`)
- Test: `src/modules/activity/ingest.test.ts`, `src/app/api/tracker/routes.test.ts`

**Interfaces:**
- Consumes: Task 1 logic, Task 3 `authenticateDevice` and `redeemEnrollmentCode`.
- Produces in `ingest.ts`:
  - `clockStateFor(employeeId: string, now?: Date): Promise<{ state: "out" | "working" | "break"; since: string | null; settings: { idleTimeoutSeconds: number; shotIntervalMinutes: 10 }; policy: boolean }>` (uses `loadEventsBetween` from `src/modules/attendance/service.ts` over the last 36 h and `replayClock` from `src/modules/attendance/clock.ts`)
  - `ingestSegments(auth: { deviceId: string; employeeId: string }, body: SegmentsBody, now?: Date): Promise<{ accepted: number; clipped: number; duplicate: number; rejected: Record<string, number> }>` (validate each with `validateSegment`; sanitize app; clip to working-minus-break intervals derived from replayed sessions; `dropOverlaps` against the device's stored intervals in range; insert; one transaction; refuse whole request when no policy published)
  - `requestShot(auth, body: { takenAt: string }, now?: Date): Promise<{ ok: true; shotId: string; path: string; token: string } | { ok: false; reason: "not_working" | "window_used" | "policy" | "too_old" }>` (path `shots/<employeeId>/<yyyymmdd UTC>/<shotId>.jpg`; creates a pending row; uses `createSignedUpload(BUCKETS.tracker, path)`)
  - `finalizeShot(auth, body: { shotId: string }): Promise<{ ok: boolean; reason?: "missing" | "too_large" | "bad_type" }>` (reads bytes, `sniffFileKind` must be `jpg` or `png`, at most 300 KB; on failure removes the file and the pending row; sets `finalizedAt`)
- Body schemas in `validators.ts`: `segmentsBodySchema` (`segments` array 1-200 items of `{ start: ISO string, end: ISO string, app: string max 120, state: "active"|"idle" }`, plus optional `appVersion`, `permissionsOk: boolean`, `queueSize: int`); `enrollBodySchema`; `shotRequestSchema`; `shotFinalizeSchema`.
- Route behavior: each route authenticates with `authenticateDevice(request.headers.get("authorization"))` (401 with `{ error: "unauthorized" }` otherwise; `enroll` excepted), rate-limits per device id, parses with Zod (400 `{ error: "invalid" }`), returns JSON only, sets `export const dynamic = "force-dynamic"`, and also writes `appVersion`, `permissionsOk`, `queueSize` to the device row on segment posts.

- [ ] **Step 1: Write failing unit tests** for `ingestSegments` with a fake executor/mocked loaders: a retry of the same batch returns `duplicate` equal to batch size and inserts nothing the second time; a segment 10:00-10:30 with a break 10:10-10:20 yields two inserted pieces; a future-dated segment lands in `rejected.future`; with no policy, nothing is inserted. Tests for `requestShot`: second request in the same 10-minute window returns `window_used`; while on break returns `not_working`. Tests for `finalizeShot`: 400 KB body returns `too_large` and removes the file (use `FakeStorage` from `src/modules/documents/storage.ts`); a PDF header returns `bad_type`.
- [ ] **Step 2: Write failing route tests**: missing or malformed `Authorization` gives 401 on every route except `enroll`; invalid JSON gives 400; a valid enroll code gives 200 with a token that works on `clock-state`.
- [ ] **Step 3: Run** `pnpm vitest run src/modules/activity src/app/api/tracker` and confirm FAIL.
- [ ] **Step 4: Implement** `ingest.ts`, validators and the five routes. Never log bodies or tokens; log only counts through the existing error path.
- [ ] **Step 5: Run** the tests, `pnpm typecheck`, `pnpm lint`; confirm PASS.
- [ ] **Step 6: Commit** `feat(activity): tracker ingest API`.

---

### Task 5: Rollup, flags, purge and jobs

**Files:**
- Create: `src/modules/activity/jobs.ts` (server-only)
- Create: `src/modules/activity/flags.ts` (imports db and schema only, never the attendance module, to avoid an import cycle)
- Modify: `src/modules/attendance/jobs.ts` (the nightly rebuild near line 195 where `no_screenshots` is set: call `activityFlagsFor` and merge the result into the day's `flags`)
- Modify: `src/modules/attendance/flag-labels.ts`, `src/modules/attendance/flag-severity.ts` (+ `flag-severity.test.ts`)
- Modify: `src/inngest/functions.ts`, `src/modules/health/registry.ts`
- Test: `src/modules/activity/jobs.test.ts`, `tests/integration/activity-rollup.test.ts`

**Interfaces:**
- Produces:
  - `rebuildActivityMinutes(date: string, employeeId?: string): Promise<{ people: number }>` (day in each person's zone; sums `activity_segments` into `activity_minutes`, categorizing apps with active `activity_categories`; top 10 apps by active minutes; idempotent upsert)
  - `activityFlagsFor(employeeId: string, date: string, ctx: { workedMinutes: number; policy: boolean }): Promise<string[]>` returning any of `"tracker_offline"` (worked at least 30 min with no active device heartbeat/segments for 30+ min of that time), `"low_activity"` (active percent below `lowActivityPercent` over at least 60 worked minutes), `"no_shots"` (worked at least 60 minutes and zero finalized shots); returns `[]` when no active device or no policy
  - `purgeShots(now?: Date): Promise<{ purged: number }>` (30 days; mirror `purgeSelfies` in `src/modules/attendance/jobs.ts:389`, bucket `BUCKETS.tracker`)
  - `runTrackerOfflineAlerts(now?: Date): Promise<{ noticed: number }>` (clocked-in people with an active device whose last segment ended more than `offlineGraceMinutes` + 10 minutes ago: `notify()` the lead via `timeNoticeUserIds`, once per person per day, text with no names of apps)
- Inngest: `tracker-rollup` daily 03:00 `TZ=${DEFAULT_TIMEZONE}` (rebuild yesterday and today), `tracker-shot-purge` daily 03:10, `tracker-offline-alerts` every 30 minutes (`*/30 * * * *`). Registry entries: `"tracker-rollup"` DAILY, `"tracker-shot-purge"` DAILY, `"tracker-offline-alerts"` 30.
- Labels: `tracker_offline` "Tracker offline", `low_activity` "Low activity", `no_shots` "No screenshots" (same wording Jibble's flag uses, check `FLAG_HELP`); severity: all three non-blocking (not in `BLOCKING_FLAGS` or `HARD_STOP_FLAGS`).

- [ ] **Step 1: Write failing tests**: integration rollup for a person with 60 active + 30 idle minutes of `Chrome` and a `non_work` rule for `Spotify` (assert minutes by category); a unit/integration test that `activityFlagsFor` returns `[]` for a person with no active device even with zero segments; `purgeShots` removes the file via `FakeStorage` and sets `purged_at`; `flag-severity.test.ts` asserts the three flags are non-blocking; health test (existing, enforces registry parity) still passes.
- [ ] **Step 2: Run** `pnpm vitest run src/modules/activity src/modules/attendance/flag-severity.test.ts` and `pnpm test:integration -- activity-rollup`; confirm FAIL.
- [ ] **Step 3: Implement** jobs and flags, wire the attendance rebuild, Inngest functions (thin wrappers with `trackJob`), and registry.
- [ ] **Step 4: Run** the same tests plus `pnpm test` fully; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): rollups, flags, purge, jobs`.

---

### Task 6: Permissions, read queries, screenshot viewing

**Files:**
- Create: `src/modules/activity/permissions.ts`
- Modify: `src/lib/authz.ts` (spread `activityPermissions` next to `...attendancePermissions`, line ~50)
- Modify: `tests/authz/matrix.test.ts` (hand-written rows)
- Create: `src/modules/activity/queries.ts` ("server-only", each starts with `requireUser()` then `authorize`)
- Create: `src/modules/activity/shot-actions.ts` ("use server")
- Test: `tests/authz/activity-actions.test.ts` (style of `tests/authz/settings-actions.test.ts`)

**Interfaces:**
- Permissions (columns in matrix order: super_admin hr_admin team_lead recruiter executive employee):
  - `tracker.enroll`: `O O O O O O`; `tracker.revoke_device`: `A A - - - O`
  - `activity.view`: `A A T - - O` (own timeline and totals; team uses `timeChainUserIds`)
  - `activity.view_summary`: `A A T - A -` (aggregates only)
  - `activity.view_shots`: `A A T - - O` (executive never)
  - `activity.manage`: `A A - - - -` (categories, settings, devices)
- Produces:
  - `getMyDay(input: { date: string }): Promise<ActivityDay>` and `getPersonDay(input: { employeeId: string; date: string }): Promise<ActivityDay>` where `ActivityDay = { date: string; segments: { start: string; end: string; app: string; state: "active" | "idle" }[]; minutes: { active: number; idle: number; work: number; nonWork: number }; topApps: { app: string; minutes: number }[]; shots: { id: string; takenAt: string }[]; trackerOnline: boolean }`
  - `listFloor(input: { teamId?: string }): Promise<{ employeeId: string; name: string; state: "active" | "idle" | "break" | "offline" | "out"; minutesInState: number; activePercentToday: number }[]>` (team scope via `timeChainUserIds`; at most 200 rows)
  - `viewShot(input: { shotId: string; reason: "quality_check" | "dispute" | "coaching" | "client_request" }): Promise<ActionResult<{ url: string }>>` (60-second signed URL; own shots need no reason; others require reason; `writeAudit` `activity.shot_view` with shot id, employee id and reason code inside the same transaction)
  - `listCategories(): Promise<...>` / `saveCategory(input: { pattern: string; category: "work" | "non_work"; rank: number }): Promise<ActionResult<{ id: string }>>` (`activity.manage`; pattern must compile as a RegExp and be at most 80 chars; audit `activity.category_saved`)
  - `listDevices(input: { employeeId?: string }): Promise<{ id: string; name: string; os: string; appVersion: string; lastSeenAt: string | null; status: string; permissionsOk: boolean; queueSize: number }[]>`
- Guest users are refused everywhere (`requireUser()` default behavior; do not pass `allowGuest`).

- [ ] **Step 1: Write failing tests**: add matrix rows first (suite fails for missing rows until the permissions exist); `activity-actions.test.ts` runs `getMyDay`, `getPersonDay`, `viewShot`, `saveCategory`, `revokeDevice`, `createEnrollmentCode` as all six roles with the throwing-db mock, asserting forbidden roles get "You do not have access to do that." before touching the database; assert the Executive is refused `viewShot` and Recruiter is refused everything.
- [ ] **Step 2: Run** `pnpm vitest run tests/authz` and confirm FAIL.
- [ ] **Step 3: Implement** permissions, queries and actions; `server-actions-guard.test.ts` must still pass (every exported function in a "use server" file calls `requireUser()` first, helpers live in server-only files).
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): permissions, queries, shot viewing`.

---

### Task 7: Simulator, module notes, end-to-end check

**Files:**
- Create: `scripts/tracker-sim.mts` (run with the same runner as other scripts, e.g. `pnpm tsx scripts/tracker-sim.mts`; check an existing `.mts` header such as `scripts/dev-mfa.mts` for the pattern)
- Create: `docs/modules/activity-tracker.md`
- Modify: `CLAUDE.md` (add a "Module notes" entry for the tracker pointing to the new doc, with its hard rules; add the `/api/tracker/*` exception to the list of routes outside the session gate)
- Modify: `docs/RUNBOOK.md` (one paragraph: jobs, bucket `activity-shots`, how to revoke a device)

**Interfaces:**
- Consumes: the HTTP API from Task 4 (the simulator uses `fetch`, never imports module code).
- Produces: a CLI `tracker-sim --base http://localhost:3000 --code ABCD2345 --minutes 30` that enrolls, polls `clock-state`, and while `working` posts a segment batch each 30 seconds (alternating `Chrome`, `Excel`, `Teams`; one idle stretch) and uploads one tiny blurred-style JPEG fixture per 10-minute window through `shots/request` and `shots/finalize` (signed upload via the storage token the API returns; check how `finalizeUpload` clients do it in `src/modules/documents/actions.ts`).

- [ ] **Step 1: Write the simulator** per the interface; fixture JPEG generated in code (small valid header + padding) so no binary file is committed.
- [ ] **Step 2: Manual end-to-end** (document the exact steps in the module doc): `supabase start`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm storage:setup`, publish a monitoring policy in the local app, sign in as `seed.employee@example.com`, clock in, generate an enrollment code (temporary dev route or run `createEnrollmentCode` through a test harness), run the simulator, then check `time.activity_segments` rows exist only inside the clocked-in span and a shot row has `finalized_at` set.
- [ ] **Step 3: Write the module doc and CLAUDE.md entry** (hard rules from Global Constraints, link to the design spec, flags and jobs table).
- [ ] **Step 4: Run the full gate**: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`; confirm all pass and that `pnpm build` output includes the five `/api/tracker/*` routes.
- [ ] **Step 5: Commit** `feat(activity): simulator and module notes`.

---

## Self-review

- **Spec coverage (Phase 1):** device auth and enrollment (Task 3), ingest and clock coupling (Task 4), schema/append-only (Task 2), flags into hours review and purge/jobs/registry (Task 5), permissions/audit/shot views/categories (Task 6), simulator and docs (Task 7). Deferred on purpose and listed for later plans: all UI pages (`/activity`, My day, `/tracker/download`), releases table and updater routes, daily digest email, client PDF, VA transparency summary, Super Admin view audit, device approval queue (Phase 1 activates a device on redeem; HR can revoke), the Tauri agents.
- **Decision to confirm:** device activation on code redeem instead of a separate HR approval step (the design spec says "admin-approved"); this keeps Phase 1 small, and an approval status can be added to `tracker_devices.status` later without a data migration.
- **Types:** `RawSegment`, `Interval`, `ActivityDay`, `authenticateDevice` result shape and `BUCKETS.tracker` are defined once and reused by name in Tasks 3-6.
- **Honest limit:** the server cannot prove a screenshot was blurred; the check is size/type/window only, and blur is verified on the agent side in Phases 3-4 (inspect the upload payload).
