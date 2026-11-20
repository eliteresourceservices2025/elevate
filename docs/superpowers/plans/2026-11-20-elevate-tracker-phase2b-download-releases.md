# ELEVATE Tracker, Phase 2b (download page, releases, updates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let everyone download the "ELEVATE Tracker App" from a page that shows the version, size, checksum and what changed, let HR publish releases with plain-English notes, and give the app an update feed that can also stop out-of-date versions from uploading.

**Architecture:** Two new `time` tables (releases with frozen notes, and their per-platform builds) and a private bucket `tracker-builds`. A CLI registers builds from CI (HR never handles binaries); HR writes notes and publishes in a settings page. People download through a signed-in route that redirects to a 60-second storage link and audits it. The app gets an update manifest and a download redirect on `/api/tracker/*`, authenticated by its device token. The Devices page learns which computers are behind.

**Tech Stack:** Next.js 16 route handlers and Server Components, Drizzle + hand-written trigger SQL, Zod, Vitest (unit, authz, integration), `DocumentStorage`.

**Spec:** `docs/superpowers/specs/2026-11-19-elevate-tracker-design.md`, section "Download page and releases". Earlier phases: `docs/superpowers/plans/2026-11-19-elevate-tracker-phase1-server.md`, `...phase2a-pages.md`.

All paths are relative to `apps/elevate/` unless they start with `docs/`.

## Global Constraints

- Product name in all copy: **ELEVATE Tracker App**. Never "overtime", "PTO" or "employee" in tracker copy.
- A published release is frozen by a database trigger: version, notes, `min_required` and its builds can never change. The only later change is withdrawing it (status `withdrawn`, never deleted). Notes are structured lists rendered as React text, never HTML.
- Installers and update files live in the private bucket `tracker-builds`. Nothing ever hands out a storage address except a **60-second signed link** made after a check: installers after a signed-in check (guests refused), update files after a device-token check.
- Versions are `MAJOR.MINOR.PATCH` numbers compared numerically (1.10.0 is newer than 1.9.0). A new release must be higher than every release ever created (withdrawn ones too).
- A release that adds new data collection cannot be published without naming a **published monitoring policy version** (`adds_collection` + `policy_version_id`).
- The update feed never offers an older or equal version, never offers a withdrawn release, and answers 204 when there is nothing newer for that platform.
- Audit rows carry ids, version and platform only (no file names or paths): `tracker.release_created`, `tracker.release_published`, `tracker.release_withdrawn`, `tracker.download`.
- Platforms: `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`. Build kinds: `installer` (what people download) and `update` (what the updater downloads; carries the `.sig` signature text).
- UI conventions as in Phase 2a (PageHeader/PageContainer, `TabNav`, `EmptyState`, status tokens, no `loading.tsx` on a route that can call `notFound()`).

## Review Focus

- A withdrawn release is still listed in the admin but is never offered as an update or download; the previous published release becomes current again.
- Version order: `1.10.0` vs `1.9.0`, equal versions, a device that reports a malformed version (`0.0.0-sim`, empty): no crash, and never offered a downgrade.
- A signed-out visitor, a client guest and a revoked device each get refused on the download and update routes, with no storage address in any answer.
- A platform with no installer: the download page offers the other platform or says it is not available yet, never a dead link; a person on a phone gets a clear "use a work computer" note.
- Publishing: no builds, a version not higher than an earlier one, `adds_collection` without a policy version, and publishing twice are each refused with a plain reason.
- A device below the required version is refused uploads with a clear answer the app can show, while the Phase 1 simulator (which sends no version) keeps working.

---

### Task 1: Version, notes and platform logic (pure)

**Files:**
- Create: `src/modules/activity/releases-logic.ts`
- Test: `src/modules/activity/releases-logic.test.ts`

**Interfaces:**
- Produces:
  - `type Platform = "windows-x86_64" | "darwin-aarch64" | "darwin-x86_64"`; `PLATFORMS: readonly Platform[]`
  - `parseVersion(v: string): [number, number, number] | null` (strict `^\d+\.\d+\.\d+$`, each part under 1,000,000)
  - `compareVersions(a: string, b: string): number` (negative, 0, positive; an unparsable version sorts lowest)
  - `isNewer(candidate: string, current: string): boolean`
  - `type ReleaseNotes = { added: string[]; improved: string[]; fixed: string[] }`; `normalizeNotes(input: { added: string; improved: string; fixed: string }): { ok: true; notes: ReleaseNotes } | { ok: false; error: string }` (each box is lines; trims, drops blanks, at most 12 lines per group, each at most 200 characters, at least one line overall)
  - `detectPlatform(userAgent: string | null): "windows" | "mac" | "other"` (`other` for phones, tablets, Linux and unknown)
  - `platformsFor(os: "windows" | "mac"): Platform[]` (`windows` -> `["windows-x86_64"]`, `mac` -> `["darwin-aarch64", "darwin-x86_64"]`)
  - `formatBytes(n: number): string` ("8.4 MB")
  - `pickUpdate(input: { platform: Platform; currentVersion: string | null; published: { version: string; platforms: Platform[]; status: "published" | "withdrawn" }[] }): string | null` (the highest published, non-withdrawn version that has the platform and is newer than `currentVersion`; null otherwise)

- [ ] **Step 1: Write failing tests** covering: `compareVersions("1.10.0","1.9.0") > 0`; equal returns 0; `parseVersion` rejects `"1.2"`, `"1.2.3-beta"`, `"01.2.3"`-style leading junk is fine only if numeric (decide: accept `"01.2.3"` as 1.2.3? No: reject), empty and `"0.0.0-sim"`; `compareVersions("junk","1.0.0") < 0`; `normalizeNotes` trims, drops blank lines, refuses 13 lines in a group and a 201-character line and an all-empty form; `detectPlatform` for a Windows Chrome UA, a macOS Safari UA, an iPhone UA (`other`), an Android UA (`other`), a Linux UA (`other`), `null` (`other`); `platformsFor("mac")` has both Macs; `formatBytes(8_800_000)` is `"8.4 MB"`, `formatBytes(900)` is `"900 B"`; `pickUpdate` returns null when current equals the newest, skips a withdrawn newest and offers the next one down only if it is newer than current, returns null when the platform has no build, and treats a null or unparsable current version as "older than everything".
- [ ] **Step 2: Run** `pnpm vitest run src/modules/activity/releases-logic.test.ts`; confirm FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above (no database or React imports).
- [ ] **Step 4: Run** the same command; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): release version and notes logic`.

---

### Task 2: Releases tables, frozen by trigger, and the builds bucket

**Files:**
- Modify: `src/modules/activity/schema.ts` (add `trackerReleases`, `trackerReleaseBuilds`)
- Create: `drizzle/0167_tracker_releases.sql` (via `pnpm db:generate --name tracker_releases`, then append trigger SQL by hand in the style of `drizzle/0165_activity_tracker.sql`)
- Modify: `src/modules/documents/storage.ts` (`BUCKETS.trackerBuilds = "tracker-builds"`), `scripts/setup-storage.mts` (bucket `tracker-builds`, private, 150 MB, types `application/octet-stream`, `application/x-msi`, `application/x-msdownload`, `application/x-apple-diskimage`, `application/gzip`)
- Test: `tests/integration/activity-releases-schema.test.ts`

**Interfaces:**
- `trackerReleases` (schema `time`, RLS): `id uuid pk`, `version text unique` (check `~ '^\d+\.\d+\.\d+$'`), `status text` (`draft|published|withdrawn`, default `draft`), `notesAdded text[]`, `notesImproved text[]`, `notesFixed text[]`, `minRequired boolean default false`, `addsCollection boolean default false`, `policyVersionId uuid null` (references `docs.policy_versions`), `createdBy uuid`, `createdAt`, `publishedBy uuid null`, `publishedAt null`, `withdrawnAt null`.
- `trackerReleaseBuilds` (RLS): `id`, `releaseId` (references releases), `platform text` (check in the three platforms), `kind text` (`installer|update`), `storagePath text unique`, `fileName text`, `sizeBytes bigint`, `sha256 text`, `signature text null` (updater signature text; required for `update` builds by a check constraint), `createdAt`; unique `(releaseId, platform, kind)`.
- Triggers: on `tracker_releases`, an UPDATE is allowed only while `OLD.status = 'draft'` (any change), or when `OLD.status = 'published'` and the only change is `status -> 'withdrawn'` plus `withdrawn_at` being set; DELETE is refused unless `OLD.status = 'draft'`. On `tracker_release_builds`, INSERT/UPDATE/DELETE are refused when the parent release is not `draft`.

- [ ] **Step 1: Write the failing integration test**: a draft can be edited and deleted; after setting status to `published`, changing `notes_fixed`, `version`, or `min_required` raises, and deleting raises; withdrawing a published release works and sets `withdrawn_at`; a withdrawn release cannot be changed again or re-published; a build can be added to a draft but not to a published release, and a published release's builds cannot be deleted; duplicate `(release, platform, kind)` raises; `kind = 'update'` without a signature raises; a version like `1.2` raises; RLS is on for both tables (`pg_class.relrowsecurity`). Use the `dbMessage` helper pattern from `tests/integration/activity-schema.test.ts` to read the database's own message.
- [ ] **Step 2: Run** `pnpm vitest run --config vitest.integration.config.mts activity-releases-schema`; confirm FAIL.
- [ ] **Step 3: Implement** schema, generate the migration, append the trigger SQL, add the bucket constant and setup entry.
- [ ] **Step 4: Run** the integration test and `pnpm typecheck`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): tracker releases tables and builds bucket`.

---

### Task 3: Release service, actions, queries and permissions

**Files:**
- Modify: `src/modules/activity/permissions.ts` (add `tracker.download`, `tracker.manage_releases`), `tests/authz/matrix.test.ts` (rows)
- Create: `src/modules/activity/releases-service.ts` (server-only), `src/modules/activity/release-actions.ts` ("use server"), `src/modules/activity/release-queries.ts`
- Modify: `src/modules/activity/validators.ts` (`createReleaseSchema`, `releaseIdSchema`)
- Test: `tests/authz/activity-actions.test.ts` (rows), `tests/integration/activity-releases.test.ts`

**Interfaces:**
- Permissions (column order super_admin hr_admin team_lead recruiter executive employee): `tracker.download: O O O O O O`; `tracker.manage_releases: A A - - - -`.
- `createReleaseSchema`: `{ version: string, added: string, improved: string, fixed: string, minRequired: boolean, addsCollection: boolean, policyVersionId: uuid | null }`.
- Service (server-only, no signed-in person): `registerBuild(input: { version: string; platform: Platform; kind: "installer" | "update"; storagePath: string; fileName: string; sizeBytes: number; sha256: string; signature: string | null }): Promise<{ ok: true } | { ok: false; error: string }>` (the release must exist and be a draft; used by the CLI in Task 4); `getPublishedReleases(): Promise<PublishedRelease[]>`; `type PublishedRelease = { id: string; version: string; publishedAt: string; status: "published" | "withdrawn"; minRequired: boolean; notes: ReleaseNotes; builds: { platform: Platform; kind: "installer" | "update"; sizeBytes: number; sha256: string; signature: string | null; storagePath: string; fileName: string }[] }`.
- Actions (each `requireUser()` then `authorize(actor, "tracker.manage_releases")`): `createRelease(input: unknown): Promise<ActionResult<{ id: string }>>` (normalizes notes with `normalizeNotes`, version must be `isNewer` than the highest existing version, status `draft`, audit `tracker.release_created` with id and version); `publishRelease(input: unknown): Promise<ActionResult>` (refuses unless the release is a draft, has at least one `installer` build, every platform that has an installer also has an `update` build, `adds_collection` implies a `policy_version_id` that is a published `monitoring` policy version, and the version is still higher than every other release; sets status, `published_by/at`; audit `tracker.release_published`); `withdrawRelease(input: unknown): Promise<ActionResult>` (only a published release; audit `tracker.release_withdrawn`); `deleteDraftRelease(input: unknown): Promise<ActionResult>` (draft only; its build files are queued for removal through `queueStorageDeletion` from `src/modules/announcements/content-files.ts` or removed directly with `DocumentStorage.remove`).
- Query `listReleasesAdmin(): Promise<{ id; version; status; createdAt; publishedAt; minRequired; addsCollection; notes; platforms: Platform[] }[]>` (`tracker.manage_releases`).

- [ ] **Step 1: Write failing tests**: matrix rows; authz rows for the four actions and `listReleasesAdmin` (allowed super_admin and hr_admin only, others refused before the database); integration: `createRelease` rejects `1.0.0` when `1.2.0` exists and rejects an all-empty notes form; `publishRelease` is refused with no builds, with an installer but no update build for its platform, with `addsCollection` and no policy version, and with a policy version that is a draft; a valid publish succeeds once and a second publish is refused; after publishing `1.3.0` then withdrawing it, `getPublishedReleases()` marks it `withdrawn` and `pickUpdate` (Task 1) over its output offers `1.2.0` again; audit rows hold id and version only (assert no file name or path appears in `metadata`); `deleteDraftRelease` refuses a published one.
- [ ] **Step 2: Run** the authz and integration tests; confirm FAIL.
- [ ] **Step 3: Implement** to the signatures; `server-actions-guard.test.ts` must still pass.
- [ ] **Step 4: Run** `pnpm vitest run tests/authz` and the integration test, `pnpm typecheck`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): release actions, queries and permissions`.

---

### Task 4: Build registration script for CI

**Files:**
- Create: `scripts/tracker-build.mts`; Modify: `package.json` (`"tracker:build": "tsx scripts/tracker-build.mts"`)
- Create: `src/modules/activity/build-file.ts` (pure helpers)
- Test: `src/modules/activity/build-file.test.ts`

**Interfaces:**
- `build-file.ts`: `parseBuildArgs(argv: string[]): { ok: true; args: { version: string; platform: Platform; kind: "installer" | "update"; file: string; sig?: string } } | { ok: false; error: string }` (flags `--version --platform --kind --file --sig`; `--sig` is required for `update`); `buildStoragePath(version: string, platform: Platform, kind: string, fileName: string): string` (`releases/<version>/<platform>/<kind>/<safe file name>`; the file name keeps letters, digits, dot, dash and underscore only); `checkBuildFile(input: { fileName: string; platform: Platform; kind: "installer" | "update"; sizeBytes: number; head: Uint8Array }): { ok: true } | { ok: false; error: string }` (size 100 KB to 150 MB; a Windows installer must be `.exe` with the `MZ` header or `.msi` with the OLE header `D0 CF 11 E0`; a macOS installer must be `.dmg`; an `update` build must be `.exe`, `.msi` or `.gz`/`.tar.gz` (gzip header `1F 8B`); extension and header must agree).
- `scripts/tracker-build.mts`: reads the file, runs `checkBuildFile`, computes SHA-256, uploads to `tracker-builds` with the Supabase service role (same client setup as `scripts/setup-storage.mts`), then calls `registerBuild`; refuses to run unless the release exists as a draft; prints the SHA-256 and size. Never prints keys. Refuses non-local databases unless `ELEVATE_ENV` is `staging` or `production` (same guard idea as `src/lib/seed/guard.ts`).

- [ ] **Step 1: Write failing tests** for `parseBuildArgs` (missing flag, bad platform, `update` without `--sig`), `buildStoragePath` (a file name with `../` and spaces becomes safe, no slash survives), and `checkBuildFile` (an `.exe` with a PDF header is refused; an `.msi` with the OLE header passes; a 10-byte file is refused; a `.dmg` for a Windows platform is refused; a `.gz` update passes only with the gzip header).
- [ ] **Step 2: Run** `pnpm vitest run src/modules/activity/build-file.test.ts`; confirm FAIL.
- [ ] **Step 3: Implement** the helpers and the script.
- [ ] **Step 4: Run** the test and `pnpm typecheck`; try the script's usage error path (`pnpm tracker:build` with no flags prints the usage and exits 1); confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): tracker build registration script`.

---

### Task 5: Update feed, build download, release notes and the version floor (device API)

**Files:**
- Create: `src/app/api/tracker/update/route.ts` (GET), `src/app/api/tracker/update/download/[platform]/route.ts` (GET), `src/app/api/tracker/releases/[version]/route.ts` (GET)
- Modify: `src/modules/activity/route-helpers.ts` (`deviceRoute`: the version floor), `src/modules/activity/validators.ts` (`platformSchema`, `versionParamSchema`)
- Test: `src/app/api/tracker/update-routes.test.ts`, `tests/integration/activity-update.test.ts`

**Interfaces:**
- `GET /api/tracker/update?platform=<Platform>&version=<current>` (device token): 204 when `pickUpdate` returns null; otherwise `200 { version, notes: string, pub_date: string, url: string, signature: string }` where `notes` is the three groups as plain text (`Added: ...`, `Improved: ...`, `Fixed: ...` joined by line breaks), `url` is our own `/api/tracker/update/download/<platform>?version=<version>` on the request's origin, and `signature` is the `update` build's stored signature. Bad `platform` or `version` format: 400 `{ error: "invalid" }`.
- `GET /api/tracker/update/download/[platform]?version=` (device token): 302 to a 60-second signed link for that release's `update` build; 404 JSON when the release is withdrawn, missing or has no such build.
- `GET /api/tracker/releases/[version]` (device token): `200 { version, publishedAt, notes: ReleaseNotes, minRequired }` for a published (not withdrawn) release; 404 otherwise. This feeds the app's "What's new" box.
- Version floor in `deviceRoute`: when the request carries an `X-Tracker-Version` header that parses as a version and is lower than the highest published, non-withdrawn release with `minRequired`, answer `426 { error: "update_required", minVersion }` instead of running the route (the `update` and `releases` routes are exempt so the app can still update). No header, or an unparsable one: not enforced (the simulator sends none).

- [ ] **Step 1: Write failing tests**: route tests with the release queries mocked: 401 without a token on all three; 204 when current equals newest; 200 body shape when behind (assert `url` is on our origin and contains no storage host, and `signature` is passed through); 400 for `platform=linux`; the download route 302s for a valid release and 404s for a withdrawn one; the version floor returns 426 for `X-Tracker-Version: 1.0.0` when `2.0.0` is required, passes for `2.0.0`, passes with no header, passes with `junk`, and the `update` route is exempt; integration: with real releases (published `1.2.0`, published withdrawn `1.3.0`, required `1.1.0`), a device on `1.0.0` is offered `1.2.0` and gets 426 on `segments`; a revoked device is refused (401) on all three.
- [ ] **Step 2: Run** `pnpm vitest run src/app/api/tracker` and the integration test; confirm FAIL.
- [ ] **Step 3: Implement** the routes and the floor (read the highest required version through a small query with a 60-second in-memory cache keyed by process, cleared when a release is published or withdrawn, so each upload does not hit the database for it).
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm lint`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): update feed, release notes route and version floor`.

---

### Task 6: Download page, installer route and menu item

**Files:**
- Create: `src/app/(app)/tracker/download/page.tsx`, `src/app/api/tracker/download/[platform]/route.ts`
- Create: `src/modules/activity/components/download-hero.tsx`, `release-list.tsx`
- Modify: `src/lib/nav.ts` (item "ELEVATE Tracker App"), `src/lib/nav-access.test.ts`, `src/modules/activity/release-queries.ts` (`getDownloadPage`)
- Test: `src/modules/activity/components/download-hero.test.ts`, `src/modules/activity/components/release-list.test.ts`, `tests/integration/activity-download.test.ts`

**Interfaces:**
- Nav item in group "Time and attendance", no `access` rule (everyone signed in; guests never reach it): `{ href: "/tracker/download", label: "ELEVATE Tracker App", icon: Download, description: "Download the app, add your computer and see what changed in each version." }`.
- `getDownloadPage(): Promise<{ policy: boolean; current: PublishedRelease | null; releases: PublishedRelease[]; devices: DeviceRow[] }>` (`tracker.download`, own; `releases` excludes withdrawn and drafts, newest first; `devices` are the person's own active computers).
- `GET /api/tracker/download/[platform]` (platform in `windows-x86_64 | darwin-aarch64 | darwin-x86_64`): `requireUser()` (so a signed-out visitor goes to sign-in and a guest to Messages), `authorize(user, "tracker.download", { ownerUserId: user.id })`, 404 when the current release has no installer for that platform, otherwise audit `tracker.download` (platform and version only, written before the redirect) and 302 to a 60-second signed link with the file name from storage. Rate limit with the existing `download` policy.
- Page (`PageHeader` "ELEVATE Tracker App", `PageContainer width="wide"`, 404-free): `DownloadHero` (OS from `detectPlatform(headers().get("user-agent"))`: Windows shows one primary "Download for Windows"; Mac shows "Download for Apple silicon" and "Download for Intel Mac"; `other` shows a note "The app runs on a Windows or Mac work computer. Open this page there." with all links secondary; each button shows version, date, size and a "Check the file" disclosure with the SHA-256), a steps list (download, install and allow Screen Recording and Accessibility on a Mac, "Add this computer" with the existing `EnrollDialog`, then clock in), a "Your computers" list from `devices` with app version and last seen, system requirements (Windows 10 21H2 or newer; macOS 12 or newer), and `ReleaseList` (newest first; version, date, "Required update" chip, and Added / Improved / Fixed lists; the newest open, older ones in `<details>`; `?filter=required` link toggles required only). With no published release: `EmptyState` "The app is not ready to download yet". With the policy unpublished: an `Alert` "Recording starts only after the monitoring policy is published."

- [ ] **Step 1: Write failing tests**: nav test (every role sees the item; a guest user is not part of `hiddenNavFor`, covered by `requireUser`); render tests: `DownloadHero` for `windows` shows one "Download for Windows" link to `/api/tracker/download/windows-x86_64` and no Mac link as primary, for `mac` shows both Mac links, for `other` shows the work-computer note, size shown as "8.4 MB", and no storage host in the markup; a platform with no installer renders "Not available yet" instead of a link; `ReleaseList` escapes a note containing `<b>`, shows the "Required update" chip only for required releases, and renders Added/Improved/Fixed headings only for non-empty groups; integration: `getDownloadPage` hides a withdrawn and a draft release and the installer route (called through its handler with a mocked signed-in user) audits one row with platform and version only and returns 302 with a Location that is a 60-second link, returns 404 for a platform with no installer, and a signed-out request is not served.
- [ ] **Step 2: Run** the tests; confirm FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm vitest run src/ui-conventions.test.ts src/lib`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): tracker download page and installer route`.

---

### Task 7: Releases admin page

**Files:**
- Create: `src/app/(app)/settings/tracker/releases/page.tsx`, `src/modules/activity/components/release-forms.tsx` ("use client")
- Modify: `src/app/(app)/settings/tracker/page.tsx` (a "Releases" link in the header actions), `src/modules/activity/release-queries.ts` (`getReleaseAdminView`)
- Test: `src/modules/activity/components/release-forms.test.ts`

**Interfaces:**
- `getReleaseAdminView(): Promise<{ releases: AdminRelease[]; policyVersions: { id: string; label: string }[] }>` (`tracker.manage_releases`; `AdminRelease` = admin row plus its builds `{ platform; kind; sizeBytes; sha256 }[]` and who published; `policyVersions` = published monitoring policy versions, labelled "Version N, published <date>").
- Page `/settings/tracker/releases` (404 for roles without `tracker.manage_releases`; breadcrumbs Settings > ELEVATE Tracker > Releases): a table (version, status chip draft / published / withdrawn, platforms with a build, "Required" chip, published date) with row actions **Publish** (drafts, with a confirm that says it cannot be edited afterwards), **Withdraw** (published, with a confirm that says people stop being offered it), **Delete draft**; a header `FormDialog` "New release" with the version field, three textareas ("Added", "Improved", "Fixed", one line per item, hint "Plain English, one change per line"), "Required update" and "Adds new data collection" checkboxes, and, when the second is checked, a select of published monitoring policy versions (required). A short panel explains how builds get here ("Builds are added by the release script: `pnpm tracker:build`; see docs/modules/activity-tracker.md") and shows each draft's builds with sizes.
- `release-forms.tsx`: `NewReleaseForm`, `PublishButton`, `WithdrawButton`, `DeleteDraftButton`, using `useRun`, `useAsk` and the Task 3 actions.

- [ ] **Step 1: Write failing tests**: `release-forms.test.ts` renders `NewReleaseForm` and asserts three labelled textareas, the two checkboxes, that the policy select is absent until "Adds new data collection" is checked (use the form's initial prop to render both states), and the version hint; a render of the page's table component with a published and a withdrawn row shows Withdraw only on the published one and Publish only on drafts; escapes a version-like string with markup.
- [ ] **Step 2: Run** the test; confirm FAIL.
- [ ] **Step 3: Implement** the page, query and forms.
- [ ] **Step 4: Run** the test, `pnpm typecheck`, `pnpm lint`, `pnpm vitest run src/ui-conventions.test.ts`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): tracker releases admin page`.

---

### Task 8: Devices "Behind" chip, guides, notes and the live check

**Files:**
- Modify: `src/modules/activity/queries.ts` (`listAllDevices`: add `behind` and include it in the `attention` filter), `src/modules/activity/components/devices-table.tsx` ("Behind" chip with the newest version), `tests/integration/activity-fleet.test.ts`, `src/modules/activity/components/devices-table.test.ts`
- Modify: `content/help/attendance/your-tracker-day.md` (replace "open the app" with the real download steps), create `content/help/attendance/publish-a-tracker-release.md` (audience `super_admin, hr_admin`), `docs/modules/activity-tracker.md`, `CLAUDE.md` (one line), `docs/RUNBOOK.md` (releases paragraph)
- Test: `pnpm vitest run src/modules/help`

**Interfaces:**
- `FleetRow` gains `behind: boolean` and the page passes `latestVersion: string | null` to `DevicesTable`. `behind` is true when the device's `app_version` is a valid version lower than the highest published, non-withdrawn release version. In SQL: `app_version ~ '^\d+\.\d+\.\d+$' and string_to_array(app_version, '.')::int[] < string_to_array(<latest>, '.')::int[]`.

- [ ] **Step 1: Write failing tests**: integration: with a published `1.2.0`, a device on `1.0.0` is `behind` and appears under `attention`, a device on `1.2.0` and a device reporting `0.0.0-sim` do not, and with no published release nothing is behind; render test: a behind row shows a "Behind (newest 1.2.0)" chip.
- [ ] **Step 2: Run** the tests; confirm FAIL.
- [ ] **Step 3: Implement** the change and write the two guides with the real button names from Tasks 6 and 7 ("Download for Windows", "Add this computer", "New release", "Publish", "Withdraw", "Required update").
- [ ] **Step 4: Run** `pnpm vitest run src/modules/help` and the fleet tests; confirm PASS.
- [ ] **Step 5: Live check** (needs migration `0167` applied to the local dev database and `pnpm storage:setup`; ask before touching the shared dev database): register a fake build with `pnpm tracker:build` using a small file that passes `checkBuildFile` (generate it in the scratchpad; it is not a real installer), publish a release as HR, then look at `/tracker/download` as an employee at desktop and phone width, light and dark, click the download link and confirm the 302 and the audit row, call `/api/tracker/update` with the simulator's token for an older version, withdraw the release and confirm the page and the feed stop offering it; undo what can be undone and record what was seen and not seen in the module notes.
- [ ] **Step 6: Full gate**: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm vitest run --config vitest.integration.config.mts` (whole suite), `pnpm build` (it may still stop at Next's own version-advisory check; confirm the new routes appear in the route list). Commit `docs(activity): releases guides and notes`.

---

## Self-review

- **Spec coverage (design doc, "Download page and releases"):** page for all signed-in staff with OS detection, version, date, size, SHA-256, install steps with the Mac permissions, your computers, requirements and release notes with "Required update" (Task 6); Releases admin with draft/published/withdrawn, structured notes, policy link for new collection, frozen after publish (Tasks 2, 3, 7); builds without HR handling binaries (Task 4); signed 60-second delivery, audited (Tasks 5, 6); auto-update feed and below-minimum refusal (Task 5); Fleet health shows who is behind (Task 8). **Not in this plan, by design:** the Tauri updater's client side, the in-app "What's new" dialog UI, "install at next clock-out" and the macOS notarization (all in the app, Phases 3 and 4; the server routes they need exist after Task 5); a Help > Release notes entry inside the app.
- **Honest limits:** the server cannot prove a build is the real signed app: it checks the extension, header bytes and size, and stores the SHA-256; the real protection is code signing (checked by the OS) and the updater signature (checked by the app against its baked-in public key). The Tauri update manifest shape (`version`, `notes`, `pub_date`, `url`, `signature`) follows the Tauri v2 dynamic-update format and must be re-checked against the Tauri version chosen in Phase 3. The version floor trusts a header the app sends; it is an operations control, not a security boundary.
- **Types:** `Platform`, `ReleaseNotes`, `PublishedRelease`, `AdminRelease`, `FleetRow.behind` are each defined once (Tasks 1, 3, 7, 8) and used by name.
- **Decision to confirm:** published releases are frozen with no editing (typos need withdraw and re-release), as for policies. A "fix notes" escape hatch would need an audited append-only note correction; left out to stay small.
