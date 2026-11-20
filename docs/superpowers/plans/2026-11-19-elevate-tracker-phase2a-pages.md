# ELEVATE Tracker, Phase 2a (monitoring pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give people the screens for what Phase 1 records: a "My day" view for every person, the Live floor and person day view for leads/HR, a Devices list for HR, and a Settings page for categories and thresholds. Everything is usable today with `pnpm tracker:sim`.

**Architecture:** Server Components read through the Phase 1 queries (`getMyDay`, `getPersonDay`, `listFloor`, `listDevices`, `viewShot`), plus a few small new queries/actions. One pure layout function drives a shared `TimelineStrip`. Live refresh uses the existing `AutoRefresh` (router.refresh), not a new data layer. Pages follow the app conventions (`PageHeader`, `PageContainer`, `TabNav`, `EmptyState`, status tokens).

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 + shadcn, Zod, Vitest (unit, authz, integration), the Browser pane for visual checks.

**Spec:** `docs/superpowers/specs/2026-11-19-elevate-tracker-design.md` (sections "Function and design (UI)" and "Monitoring side"). Phase 1: `docs/superpowers/plans/2026-11-19-elevate-tracker-phase1-server.md`.

**Split of the remaining spec work** (each its own plan, in this order): **2b** `/tracker/download`, releases table and admin, auto-update routes (best built with the Windows app); **2c** Exceptions inbox, Reports and client PDF, daily digest email, weekly "who viewed" email summary, aggregate reports with the under-5 rule.

All paths are relative to `apps/elevate/` unless they start with `docs/`.

## Global Constraints

- Every page starts with `PageHeader` inside `PageContainer`; never an `<h1>` or a `max-w-*` root wrapper in a page. Tabs that are addresses use `TabNav`; long forms open in a `FormDialog`; empty lists use `EmptyState`.
- Status colours are tokens only (`success`, `warning`, `info`, `destructive`, `muted`); no raw `red/amber/green-*` classes. Control heights use `h-(--control-h)` variables. A menu item opens its own page, highlighted on its own address (no redirects to tabs).
- Times shown to a viewer are in the viewer's own zone (`src/lib/time.ts`); a day is the person's own zone day (as Phase 1 `dayFor`).
- Only an app name is ever shown: no titles or URLs exist in the data. Screenshots are shown only through `viewShot` (60-second link); the page never embeds a storage URL, and a non-own view needs a reason from `SHOT_VIEW_REASONS`.
- A person outside the viewer's scope gets the standard not-found page (use `orNotFound`), never an empty page that confirms the person exists.
- Every long list is paged (`PagerLinks`/`usePaged`), max 200 floor rows as in Phase 1.
- New actions: `requireUser()` first, `authorize()`, Zod on the server, `writeAudit()` in the same transaction (ids/counts only), per-role authz test row. No new `loading.tsx` on a route that can call `notFound()`.
- Copy: plain, short, sentence case. The product is called "ELEVATE Tracker App". Never "overtime", "PTO" or "employee" in tracker copy (1099 contractors: "team member" or the person's name).

## Review Focus

- A lead edits the URL to a person outside their team (`/activity/people/<id>`) or an Executive opens `/activity`: not-found, no data, no hint the person exists.
- A day with no data, a future date, or a malformed `?date=`: friendly empty state or the nearest valid day, never NaN, a blank page or a crash.
- A lead in Phoenix looks at a Manila-zone person's day: the day boundary is the person's, the shown times are the viewer's, and the page says which zone the day is in.
- A signed screenshot link expires after 60 seconds: the viewer shows "Link expired, open it again", not a broken image.
- A floor with 0 people, 1 person, and 200 people (the cap): layout holds; counts bar adds up to the rows shown.

---

### Task 1: Timeline layout and strip component

**Files:**
- Create: `src/modules/activity/timeline.ts` (pure)
- Create: `src/modules/activity/components/timeline-strip.tsx`
- Test: `src/modules/activity/timeline.test.ts`, `src/modules/activity/components/timeline-strip.test.ts`

**Interfaces:**
- Produces in `timeline.ts`:
  - `type TimelineBlock = { leftPct: number; widthPct: number; kind: "active" | "idle" | "working"; label: string }` (`working` = clocked-in time with no recording, drawn as a faint underlay)
  - `layoutTimeline(input: { segments: { start: string; end: string; app: string; state: "active" | "idle" }[]; working: { start: string; end: string }[]; dayStart: number; dayEnd: number; formatTime: (ms: number) => string }): TimelineBlock[]` (clamps to the day, drops blocks under 0.15% wide only if adjacent to a block of the same kind, merges touching blocks of the same kind and app, label like `Chrome, 10:05 to 10:30, active`)
  - `hourTicks(dayStart: number, dayEnd: number, formatHour: (ms: number) => string): { leftPct: number; label: string }[]` (every 2 hours from the day start, at most 12)
- Produces `TimelineStrip({ blocks, ticks, ariaLabel })`: a 40 px high track; active = `bg-success`, idle = `bg-warning`, working = `bg-muted`; each block has a `title`; the whole strip has `role="img"` and an `aria-label` summary; ticks are small labels under it.

- [ ] **Step 1: Write failing tests** `timeline.test.ts`: a segment 10:00-10:30 in a 00:00-24:00 day gives `leftPct` 41.67 and `widthPct` 2.08 (2 decimals); a segment starting before the day start is clamped to 0%; two touching active segments of the same app merge into one block; two of different apps stay separate; `working` blocks sit under recordings (listed first); an empty input returns `[]`; `hourTicks` for a 24-hour day returns 12 ticks, the first at 0% labelled by `formatHour`. `timeline-strip.test.ts` (render with `renderToStaticMarkup`): contains `role="img"`, one `title` per block, and uses `bg-success` and `bg-warning` but no raw palette class.
- [ ] **Step 2: Run** `pnpm vitest run src/modules/activity/timeline.test.ts src/modules/activity/components` and confirm FAIL (modules missing).
- [ ] **Step 3: Implement** both files to the signatures above (no database imports in `timeline.ts`).
- [ ] **Step 4: Run** the same command and `pnpm typecheck`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): timeline layout and strip`.

---

### Task 2: Thresholds and categories (settings page)

**Files:**
- Modify: `src/modules/activity/validators.ts` (add `activitySettingsSchema`, `archiveCategorySchema`)
- Modify: `src/modules/activity/actions.ts` (add `saveActivitySettings`, `archiveCategory`)
- Modify: `src/modules/activity/queries.ts` (add `getActivitySettings`)
- Create: `src/app/(app)/settings/tracker/page.tsx`
- Create: `src/modules/activity/components/settings-forms.tsx` ("use client": `ThresholdsForm`, `CategoryForm`, `ArchiveCategoryButton`)
- Modify: `src/app/(app)/settings/page.tsx` (add a section card "ELEVATE Tracker" with `action: "activity.manage"`)
- Test: `tests/authz/activity-actions.test.ts` (add rows), `tests/integration/activity-settings.test.ts`, validators in `src/modules/activity/validators.test.ts`

**Interfaces:**
- `activitySettingsSchema`: `{ idleTimeoutSeconds: int 60-900, offlineGraceMinutes: int 2-60, lowActivityPercent: int 5-90 }`.
- `getActivitySettings(): Promise<{ idleTimeoutSeconds: number; offlineGraceMinutes: number; lowActivityPercent: number; updatedAt: string }>` (`activity.manage`; defaults when the row is missing).
- `saveActivitySettings(input: unknown): Promise<ActionResult>` (`activity.manage`; upserts `scope = 'default'`; audit `activity.settings_saved` with before/after numbers; `revalidatePath("/settings/tracker")`).
- `archiveCategory(input: unknown): Promise<ActionResult>` (`{ id: uuid }`; sets `archived_at`; audit `activity.category_archived` with the id).

- [ ] **Step 1: Write failing tests**: validators reject 59 and 901 idle seconds, accept 60 and 900, reject a non-integer; authz rows for `saveActivitySettings` and `archiveCategory` (allowed: super_admin, hr_admin; all other roles refused before the database); integration: `saveActivitySettings` changes `clockStateFor(...).settings.idleTimeoutSeconds` and writes one audit row whose `before` and `after` hold the numbers; `archiveCategory` makes `listCategories()` stop returning it and a later `rebuildActivityMinutes` stops counting that rule; a second save by a different person leaves the audit trail with both.
- [ ] **Step 2: Run** `pnpm vitest run src/modules/activity/validators.test.ts tests/authz/activity-actions.test.ts` and `pnpm vitest run --config vitest.integration.config.mts activity-settings`; confirm FAIL.
- [ ] **Step 3: Implement** the actions/query to the signatures above. The page (`PageHeader` "ELEVATE Tracker settings", `PageContainer width="wide"`): a "Thresholds" card (form with three labelled numeric fields and a one-line hint each, e.g. "Idle after N seconds without input"), a "Work and non-work apps" table of categories (pattern, category chip, rank, Archive button) and a header `FormDialog` "Add a rule" using `CategoryForm` (calls the existing `saveCategory`). Empty categories use `EmptyState`. The page 404s for roles without `activity.manage` (`scopeFor` check + `notFound()`).
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm vitest run src/ui-conventions.test.ts`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): tracker settings page`.

---

### Task 3: "My day" on the Attendance page, with screenshots and enrollment

**Files:**
- Modify: `src/modules/activity/queries.ts` (extend `ActivityDay` with `working: { start: string; end: string }[]` and `zone: string`; add `listMyShotViews`)
- Create: `src/modules/activity/components/my-day.tsx` (server), `shot-gallery.tsx` ("use client"), `enroll-dialog.tsx` ("use client")
- Modify: `src/modules/attendance/components/my-time.tsx` (render `MyDayCard` below the clock when the tracker is available)
- Modify: `src/app/(app)/attendance/page.tsx` (pass `?day=` through to the card)
- Test: `src/modules/activity/components/shot-gallery.test.ts`, `tests/integration/activity-access.test.ts` (extend)

**Interfaces:**
- `ActivityDay` gains `working` (clocked-in minus breaks, from `workingBetween`) and `zone` (the person's zone name).
- `listMyShotViews(): Promise<{ viewer: string; at: string; reason: string; count: number }[]>` (`activity.view_own`; audit rows `activity.shot_view` whose `metadata.employeeId` is the caller's employee, last 30 days, grouped by viewer and day, excluding the person's own views; viewer is the display name; at most 50 rows). Reads `ops.audit_log` read-only.
- `MyDayCard({ date })`: shows only if the policy is published; otherwise nothing. With no device: an `EmptyState` "Set up the ELEVATE Tracker App" and the `EnrollDialog` button "Add this computer". With a device: day navigation (previous/next day links via `?day=YYYY-MM-DD`, max today), `TimelineStrip` with ticks, minutes summary (Active, Idle, Work apps, Other apps), top apps list, `ShotGallery`, and a "Who looked at my activity" disclosure fed by `listMyShotViews`.
- `ShotGallery({ shots: {id; takenAt}[]; zone; needReason: boolean })`: a row of time buttons; clicking opens a dialog (reason `NativeSelect` first when `needReason`), calls `viewShot`, shows the image from the returned URL; after 55 seconds shows "Link expired, open it again" with a button.
- `EnrollDialog`: calls `createEnrollmentCode`, shows the 8-character code in a monospace block with "Valid for 15 minutes" and a countdown; copy button.

- [ ] **Step 1: Write failing tests**: `shot-gallery.test.ts` renders the gallery with 2 shots and asserts two buttons labelled with times in the zone prop, no `<img>` before a click, and no storage URL in the markup. Integration: `listMyShotViews` returns the lead's `coaching` view of the person's shot (name, reason, count 1) and does not include the person's own view; a second person calling it sees nothing about the first; `getMyDay` returns `working` covering the clocked-in span and `zone` set.
- [ ] **Step 2: Run** the component test and `pnpm vitest run --config vitest.integration.config.mts activity-access`; confirm FAIL.
- [ ] **Step 3: Implement** to the interfaces. A day with no segments shows `EmptyState` "Nothing recorded for this day"; a future `?day=` is clamped to today; a malformed one falls back to today.
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm lint`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): my day, screenshots and enrollment on attendance`.

---

### Task 4: Live floor page

**Files:**
- Create: `src/app/(app)/activity/page.tsx`, `src/app/(app)/activity/layout.tsx` (PageHeader is per page; the layout only holds nothing but may be omitted)
- Create: `src/modules/activity/components/floor-grid.tsx`, `floor-filters.tsx` ("use client")
- Modify: `src/lib/nav.ts` (add item), `src/lib/nav-access.test.ts` (rows)
- Modify: `src/modules/activity/queries.ts` (`listFloor` also returns `teamName` and `lastSeenMinutes`)
- Test: `src/modules/activity/components/floor-grid.test.ts`, `src/lib/nav-access.test.ts`, `tests/integration/activity-access.test.ts` (extend)

**Interfaces:**
- Nav item in group "Time and attendance": `{ href: "/activity", label: "Activity", icon: Activity (lucide), description: "Who is working right now and what the ELEVATE Tracker App recorded.", access: { action: "activity.view", scopes: ["all", "team"] } }`.
- `FloorRow` gains `teamName: string | null` and `lastSeenMinutes: number | null`.
- Page `/activity?state=&team=`: `PageHeader` "Activity"; `TabNav` (Live, Devices where `activity.manage`); counts bar (Active, Idle, On break, Offline, Clocked out, each a `StatusChip` count and a filter link); grid of person cards: name (link to `/activity/people/<id>`), state dot + label ("Active for 12 min"), today's active %, team; "Needs attention" toggle shows offline and idle over 15 minutes; `AutoRefresh seconds={60}`; page 404s when the viewer holds neither team nor all `activity.view` scope.
- State tones: active = success, idle = warning, break = info, offline = destructive, out = neutral.

- [ ] **Step 1: Write failing tests**: `floor-grid.test.ts` renders 5 rows of mixed states and asserts the counts bar numbers equal the number of rows per state and sum to 5; 0 rows renders the `EmptyState` text "Nobody has the ELEVATE Tracker App yet"; a name is escaped (a name with `<b>` shows as text); nav test: a Team Lead sees the item, an Employee, Recruiter and Executive do not (`hiddenNavFor`); integration: `listFloor` returns `teamName` for a person on a team and `lastSeenMinutes` near the last segment end.
- [ ] **Step 2: Run** the tests; confirm FAIL.
- [ ] **Step 3: Implement.** `?state=` accepts only the five state keys (anything else ignored); `?team=` must be a uuid the viewer can see (else ignored). Sort: offline first, then idle, active, break, out; ties by name.
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm vitest run src/ui-conventions.test.ts src/lib`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): live floor page`.

---

### Task 5: Person day page

**Files:**
- Create: `src/app/(app)/activity/people/[id]/page.tsx`
- Create: `src/modules/activity/components/person-day.tsx`, `day-picker.tsx`
- Modify: `src/modules/activity/queries.ts` (`getPersonDay` also returns `person: { name: string; team: string | null }`)
- Test: `src/modules/activity/components/day-picker.test.ts`, `tests/integration/activity-access.test.ts` (extend)

**Interfaces:**
- Page `/activity/people/[id]?date=`: `PageHeader` title = the person's name, breadcrumbs `Activity > <name>`, description "Day in <zone name>. Times shown in your time zone."; `DayPicker` (previous/next links and a date input); `PersonDay` = `TimelineStrip` (with `working` underlay), stacked bar of Work apps / Other apps / Not categorized / Idle, top-apps table (app, active minutes, category chip), `ShotGallery needReason={!own}`. Calls `getPersonDay` through `orNotFound`.
- `DayPicker({ basePath, date, today })`: pure links; `next` disabled on `today`; invalid or future `date` is replaced by `today` by the page before rendering.

- [ ] **Step 1: Write failing tests**: `day-picker.test.ts`: previous of `2026-03-01` is `2026-02-28`, next on today is a disabled element not a link; integration (`getPersonDay`): a stranger lead and an Executive get a thrown not-allowed error (already covered) AND the page-level helper `loadPersonDayOrNull` (new, in the page file or `queries.ts`) returns `null` for them so the page 404s; returns `person.name` for HR.
- [ ] **Step 2: Run** the tests; confirm FAIL.
- [ ] **Step 3: Implement.** The page never reveals a reason for the 404.
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm lint`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): person day page`.

---

### Task 6: Devices page

**Files:**
- Create: `src/app/(app)/activity/devices/page.tsx`
- Create: `src/modules/activity/components/devices-table.tsx` ("use client" row action only)
- Modify: `src/modules/activity/queries.ts` (add `listAllDevices`)
- Test: `tests/authz/activity-actions.test.ts` (rows), `tests/integration/activity-access.test.ts` (extend), `src/modules/activity/components/devices-table.test.ts`

**Interfaces:**
- `listAllDevices(input: unknown): Promise<{ rows: (DeviceRow & { person: string; behind: boolean })[]; total: number }>` (`activity.manage`; input `{ page, size, filter: "all" | "attention" }`; `attention` = permissions missing, or not seen for 24 hours, or status active with a queue over 100; `behind` is always `false` until releases exist in Phase 2b; paged with `parsePaging`/`paginate`).
- Page `/activity/devices`: `TabNav` as in Task 4; `Table stack` with person, computer, OS, app version, last seen (relative), permissions chip (OK / Missing), queue, status, row action "Sign out" using `useConfirm` and the existing `revokeDevice`; filter links All / Needs attention; `PagerLinks`; `EmptyState` when none.

- [ ] **Step 1: Write failing tests**: authz row for `listAllDevices` (allowed super_admin, hr_admin only); integration: with 3 devices (one with `permissions_ok = false`, one last seen 3 days ago, one healthy), `filter: "attention"` returns exactly the first two; paging 2 per page returns `total` 3; `revokeDevice` from the table's action flips status and the revoked device disappears from `attention`; render test: a person name containing `<script>` is escaped.
- [ ] **Step 2: Run** the tests; confirm FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm lint`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): devices page`.

---

### Task 7: Help guide, module notes, visual check

**Files:**
- Create: `content/help/attendance/` guide(s) for the tracker (read two existing guides in `content/help/attendance/` first for the front matter fields, `audience`, and button-name conventions; one guide for team members "Your ELEVATE Tracker App day", one for leads/HR "Reading the Activity pages")
- Modify: `docs/modules/activity-tracker.md` (what is built now, new routes, the `ActivityDay` shape), `CLAUDE.md` module note (one line: pages exist), `docs/modules/help-center.md` only if the audience list changes
- Test: the help center's existing content tests (`pnpm vitest run src/modules/help`) must pass with the new guides

- [ ] **Step 1: Write the guides** in plain English with the real button names from Tasks 2 to 6 ("Add this computer", "Sign out", "Needs attention", "Add a rule"); audiences: members = all signed-in staff; leads/HR = those who hold `activity.view` team or all.
- [ ] **Step 2: Run** `pnpm vitest run src/modules/help` and confirm PASS (a guide a role may not read is a 404, as for other guides).
- [ ] **Step 3: Visual check** with the Browser pane: `preview_start` `elevate-dev` (needs the local Supabase and `.env.local`), sign in as `seed.team_lead@example.com`, run `pnpm tracker:sim` for a seeded employee on a clocked-in session, then look at `/attendance` (My day), `/activity`, `/activity/people/<id>`, `/activity/devices` and `/settings/tracker` at desktop and mobile width, in light and dark. Record what was seen, including anything not checked, in the module notes. Fix layout issues found.
- [ ] **Step 4: Full gate:** `pnpm lint && pnpm typecheck && pnpm test` and `pnpm test:integration` (use `pnpm vitest run --config vitest.integration.config.mts`); `pnpm build` may still stop at Next's own version-advisory check, which is separate from this change; confirm the new pages appear in the route list.
- [ ] **Step 5: Commit** `docs(activity): tracker pages guide and notes`.

---

## Self-review

- **Spec coverage (this plan's slice):** My day with timeline, top apps, screenshots and the VA's "who viewed" panel (Task 3); Live floor with counts, filters, refresh (Task 4); person day with timeline, category bar, top apps, shot filmstrip and reason picker (Task 5); fleet health basics (Task 6); thresholds and categories (Task 2); navigation (Task 4). Deferred and listed above: `/tracker/download` and Releases (2b), Exceptions inbox, Reports, client PDF, digest and weekly emails, day notes (2c). "Compare to schedule" is not in 2a; the `working` underlay shows clocked time, and schedule comparison comes with Reports in 2c.
- **Types:** `ActivityDay` (extended in Task 3, consumed in Tasks 3 and 5), `FloorRow` (Task 4), `DeviceRow` (Task 6), `TimelineBlock` (Task 1, consumed in Tasks 3 and 5) are each defined once and used by name.
- **Honest limits:** server-rendered pages are covered by pure-layout tests, render-to-markup tests and the integration tests for queries; they are not covered by Playwright (e2e is not run in CI). Task 7 is the only place the pages are seen working, and it depends on the local Supabase stack and a seeded clocked-in session.
