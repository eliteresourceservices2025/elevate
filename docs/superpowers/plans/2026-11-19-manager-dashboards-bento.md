# Manager dashboards as bento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the team lead, HR, executive, recruiter and admin dashboard views the same compact bento grid as the VA view, with a Me strip, a "Needs your decision" tile, a combined Celebrations tile and a per-person Edit layout.

**Architecture:** Each view is an array of tile definitions (`id`, `label`, `span`, optional `rows`, `render`) fed to one generic `BentoView`. Tiles are small async server components, each in its own `guarded()` + `Suspense`, each backed by a query that calls `requireUser()` and `authorize()`. Edit layout stores hidden and ordered tile ids per person and `BentoView` filters and sorts the array.

**Tech Stack:** Next.js 16 App Router (read `apps/elevate/AGENTS.md` and `node_modules/next/dist/docs/` first), React 19, Drizzle + drizzle-kit, Zod, Vitest, Playwright (Chrome via a temporary config: Playwright's browser is not installed).

**Spec:** `docs/superpowers/specs/2026-11-19-manager-dashboards-bento-design.md`. Builds on the uncommitted VA bento: `apps/elevate/src/modules/dashboard/components/{bento,my-work-bento,my-work-tiles,people-tiles}.tsx`, `dashboard/{my-queries,people-strip-queries}.ts`.

## Global Constraints

- All paths are relative to `apps/elevate/` unless they start with `docs/`.
- Every query and action starts with `const user = await requireUser()` then `await authorize(...)`; hiding a tile is never the only guard. `tests/authz/matrix.test.ts` gets a row for every new permission; a per-role authz test for every new action.
- Tiles show counts and wording only: no name or reason where the existing widget rule forbids it; Safe Voice never on the dashboard; no pay, ratings or per-person training scores.
- Executive and workforce numbers: groups under 5 hidden on the server (reuse `analyticsForHome()` / `MIN_GROUP` behaviour; never a new path around it).
- Birthdays are month and day only, honour `core.birthday_preferences`, and the year is never selected.
- Hours come from the ELEVATE clock only, never Jibble.
- No scheduled job more often than every 30 minutes; none is needed.
- New table: `ENABLE ROW LEVEL SECURITY` via drizzle `.enableRLS()`, migration generated with `pnpm db:generate`, audit entry written inside the same transaction with `writeAudit({ ..., after: { ids only } }, tx)`.
- UI: status colours are tokens (`success`, `warning`, `info`, `destructive`), gold is fills and borders only, control heights `h-(--control-h*)`, copy plain and sentence case, no `loading.tsx`.
- Lists in tiles show a few rows then "+ N more". Tile keys include the row index (two people can share a short name).
- Run `pnpm lint && pnpm typecheck && pnpm test` before every commit; run `pnpm build` at the end of Tasks 7 and 9. Do not push. Branch off first: the checkout is on `codex/recruiting-terminal-statuses`, which is unrelated; create `feat/dashboard-bento` and ask the owner before committing the earlier uncommitted VA bento work.

## Review Focus

- A Super Admin holds several views at once; a tile whose `authorize()` throws `ForbiddenError` must render nothing (via `orFallback`), never an error panel or a crash.
- A person with no people record (`core.employees` row): the Me strip and "My team" render nothing, not a crash or "0 h".
- Empty company or empty team (zero people, zero applicants, zero scheduled hours): no `NaN%`, no divide by zero, each tile shows a short note.
- A saved layout naming a tile id that no longer exists, or one the person may no longer see, is ignored; a corrupt layout falls back to the default order.
- Executive and HR numbers for a team of 1 to 4 people never reveal the count; a manager with no team sees "Your team shows here once you have people", not a blank tile.

---

### Task 1: Generic `BentoView` and tile definitions

**Files:**
- Create: `src/modules/dashboard/bento-tiles.ts` (types), `src/modules/dashboard/components/bento-view.tsx`
- Modify: `src/modules/dashboard/components/my-work-bento.tsx` (becomes a tile array rendered by `BentoView`)
- Test: `src/modules/dashboard/bento-tiles.test.ts`

**Interfaces:**
- Produces: `type TileDef = { id: string; label: string; span: 1 | 2 | 3 | 4 | 6; rows?: 2; render: () => ReactNode }`; `function arrangeTiles(tiles: readonly TileDef[], layout: { hidden: string[]; order: string[] } | null): TileDef[]` (pure, in `bento-tiles.ts`); `function BentoView({ tiles, layout }: { tiles: readonly TileDef[]; layout?: { hidden: string[]; order: string[] } | null })` (server component; wraps each tile in the existing `Cell` with `Suspense`, `grid-flow-dense`, six columns from `lg`, spans via lookup of full class strings so Tailwind sees them).
- Consumes: existing `Cell` logic in `my-work-bento.tsx`.

- [ ] **Step 1: Write failing tests** in `bento-tiles.test.ts`: `arrangeTiles` with `null` layout returns the input order; hidden ids are removed; `order` moves listed ids to the front in that order and keeps the rest in default order; unknown ids in `hidden` and `order` are ignored; duplicate ids in `order` appear once.
- [ ] **Step 2: Run** `pnpm vitest run src/modules/dashboard/bento-tiles.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `arrangeTiles` and `TileDef` in `bento-tiles.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Implement `BentoView`** and rewrite `MyWorkBento` as `export const MY_WORK_TILES: TileDef[]` plus `MyWorkBento = () => <BentoView tiles={MY_WORK_TILES} />`, keeping the exact grid placement from the VA design (birthdays `rows: 2`, scrolls inside itself).
- [ ] **Step 6:** `pnpm typecheck && pnpm vitest run`. Expected: all green; the dashboard e2e `tests/e2e/dashboard-bento.spec.ts` still passes (run with a temporary Chrome config).
- [ ] **Step 7: Commit** `feat(dashboard): generic bento view and tile definitions`.

### Task 2: Shared tiles: Me strip, Decisions, Celebrations

**Files:**
- Create: `src/modules/dashboard/components/me-strip.tsx`, `src/modules/dashboard/components/decisions-tile.tsx`, `src/modules/dashboard/components/celebrations-tile.tsx`
- Test: `src/modules/dashboard/components/shared-tiles.test.tsx` (pure parts) and `tests/e2e/dashboard-managers.spec.ts` (created here, extended per view)

**Interfaces:**
- Consumes: `getMyHours()`, `getMyScheduleTile()` from `my-queries.ts`; `getApprovalQueue(): Promise<QueueItem[]>` from `feed-queries.ts` (items already carry kind, age, link: read `approvals.ts` for `QueueItem`); `getBirthdaysTile()`, `getAnniversariesTile()`, `getNewJoinersTile()` from `people-strip-queries.ts`.
- Produces: `MeStrip()` (renders null without a people record; shows clock state, `x of y h this week`, today's shift, and the Edit layout trigger slot `actions?: ReactNode`); `DecisionsTile()` (top 4 items, count badge, `border-primary` emphasis, "Approvals" link to the approvals page, empty note "Nothing waiting for you."); `CelebrationsTile({ rows }: { rows?: 2 })` (one tile with up to 2 birthdays, 1 anniversary, 1 new joiner; today's birthday gold; honours opt-out through the existing query).

- [ ] **Step 1: Write failing tests** for a pure helper `celebrationRows(birthdays, anniversaries, joiners): { kind: "Bday" | "Anniv" | "New"; name: string; meta: string; today: boolean }[]` in `celebrations.ts` (people module): limit 2/1/1, today's birthday first, no year in any output.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `celebrationRows` in `src/modules/people/celebrations.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Implement** the three components with the interfaces above, each wrapped in `guarded()`; Decisions uses `orFallback` so a role without approval rights shows nothing.
- [ ] **Step 6:** `pnpm lint && pnpm typecheck && pnpm vitest run`. Expected: green.
- [ ] **Step 7: Commit** `feat(dashboard): me strip, decisions and celebrations tiles`.

### Task 3: Team lead view

**Files:**
- Create: `src/modules/dashboard/manager-queries.ts`, `src/modules/dashboard/components/team-lead-tiles.tsx`, `src/modules/dashboard/components/team-lead-bento.tsx`
- Test: `src/modules/dashboard/manager-queries.test.ts` (pure helpers), extend `tests/e2e/dashboard-managers.spec.ts`

**Interfaces:**
- Produces in `manager-queries.ts` (all `requireUser()` + `authorize()`): `getTeamHoursTile(): Promise<{ rows: { name: string; workedMinutes: number; scheduledMinutes: number }[]; daysWaiting: number } | null>` (from `getTeamReview()`, current week; null when not a lead); `getClockedInTile(): Promise<{ working: number; total: number; onBreak: number; longOpen: number } | null>` (from `listWorkingNow()` and `timeDownlineEmployeeIds`); `getTeamFlagsTile(): Promise<{ label: string; count: number }[]>` (aggregates `listFlags()` by flag, labels from `attendance/flag-labels.ts`); `getReviewsGoalsTile(): Promise<{ selfReviews: number; goalsToUpdate: number }>` (from `listReviews()` and `listGoals()`, team scope as those return it).
- Produces: `TEAM_LEAD_TILES: TileDef[]` with the spec order and spans: Decisions 4, Team hours 2, Clocked in now 2, Team flags 2, Celebrations 2 (rows 2), Who is out 2, Reviews and goals due 2; `TeamLeadBento()` = Me strip + `BentoView`.
- Pure helper `percentOf(worked: number, scheduled: number): number` in `manager-queries.ts`: 0 when `scheduled <= 0`, capped at 100.

- [ ] **Step 1: Write failing tests** for `percentOf` (scheduled 0 gives 0, 95 of 100 gives 95, over-scheduled caps at 100) and for `flagCounts(rows)` (groups and sorts by count then label).
- [ ] **Step 2: Run** `pnpm vitest run src/modules/dashboard/manager-queries.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** helpers and the four queries; **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Implement** tiles using `Tile`, `TileList`, `TileRow`, `RowMeta`; each tile `guarded()`; show 3 people in Team hours with a thin bar (role="progressbar").
- [ ] **Step 6: Extend the e2e** (lead account with two reports): the lead sees regions "Needs your decision", "Team hours", "Clocked in now", "Team flags", "Celebrations", "Who is out", "Reviews and goals due"; a plain employee does not see them.
- [ ] **Step 7:** `pnpm lint && pnpm typecheck && pnpm vitest run`. Expected: green. **Step 8: Commit** `feat(dashboard): team lead bento view`.

### Task 4: HR view

**Files:**
- Modify: `src/modules/dashboard/manager-queries.ts`, `src/modules/dashboard/feed-queries.ts` (export `documentCounts` and `orgOnboardingCounts` unchanged)
- Create: `src/modules/dashboard/components/hr-tiles.tsx`, `src/modules/dashboard/components/hr-bento.tsx`
- Test: extend `manager-queries.test.ts` and `tests/e2e/dashboard-managers.spec.ts`

**Interfaces:**
- Produces: `getHrKpiTiles(): Promise<{ id: string; label: string; value: number | null; hint?: string; href: string }[]>` returning exactly six in order: active, onboarding, offboarding, change requests (`countPendingChangeRequests`), docs expiring (`documentCounts().soon`), training overdue (sum of `getTrainingCounts()` overdue); reuses `getKpis("hr")` values for active and onboarding. `HR_TILES: TileDef[]`: six KPI tiles (span 1) · Decisions 4 · Risks 2 (wrap `getRisks("hr")`) · Onboarding and offboarding 3 (wrap `getTracker()`) · Workforce by team 3 (wrap `getWorkforce()` teams breakdown, bars) · Needs attention 2 (wrap `getAttention("hr")`, top 3) · Who is out 2 · Celebrations 2.
- Consumes: `getRisks`, `getTracker`, `getWorkforce`, `getAttention` as they exist; do not change their rules.

- [ ] **Step 1: Write failing test** for `kpiOrder(ids)` guard: `getHrKpiTiles` pure shaper `shapeHrKpis(inputs)` returns six tiles in the fixed order and `value: null` (shown as a dash) for a source that threw `ForbiddenError`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** `shapeHrKpis` and `getHrKpiTiles`. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Implement** tiles and `HrBento`; KPI tiles are links to their pages (`/people`, `/onboarding`, `/people/requests`, `/documents`, `/training`).
- [ ] **Step 6: Extend the e2e** (HR account via `createHrAccount`): six KPI regions and the other tiles present; an HR view never shows a name in Needs attention.
- [ ] **Step 7:** lint, typecheck, tests green. **Step 8: Commit** `feat(dashboard): HR bento view`.

### Task 5: Executive view

**Files:**
- Modify: `src/modules/dashboard/manager-queries.ts`
- Create: `src/modules/dashboard/components/executive-tiles.tsx`, `src/modules/dashboard/components/executive-bento.tsx`
- Test: extend `manager-queries.test.ts`, `tests/e2e/dashboard-managers.spec.ts`

**Interfaces:**
- Produces: `getHeadcountMovement(): Promise<{ active: number; joined: number; left: number; teams: { name: string; count: number }[] } | null>` (teams from `getWorkforce()` so small groups are already merged or hidden; null when `analyticsForHome()` hides people); `getHiringPipeline(): Promise<{ stages: { stage: string; count: number }[]; openRoles: number } | null>` (from `getRecruitingSummary()`, counts only); `getTrainingCompliance(): Promise<{ currentPercent: number | null; overdue: number } | null>` using `percentOf`-style safe maths (null when no people are assigned); `getTimeOffCounts(): Promise<{ label: string; count: number }[]>` (counts only, from `getWhosOut()` day counts, never names). `EXECUTIVE_TILES: TileDef[]`: Headcount 3 · Hiring 3 · Training compliance 2 · Risks 2 · System health 2 (wrap `jobHealth()`: "All green" or "N late") · Time off this week 4 · Celebrations 2.

- [ ] **Step 1: Write failing tests**: `trainingPercent(current, assigned)` returns `null` for 0 assigned, 94 for 47 of 50, never above 100; `hiddenSmallGroups`: a team list with a group of 3 is not present in the tile's input (assert the query helper `dropSmall(teams, 5)` removes groups under 5).
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Implement** tiles and `ExecutiveBento`; no names anywhere in the executive tiles.
- [ ] **Step 6: Extend the e2e** (executive account): tiles present, Time off tile contains only counts, no seeded employee name appears in any executive region.
- [ ] **Step 7:** lint, typecheck, tests green. **Step 8: Commit** `feat(dashboard): executive bento view`.

### Task 6: Recruiter and Admin views

**Files:**
- Modify: `src/modules/recruiting/queries.ts` (add the three read queries), `src/modules/dashboard/manager-queries.ts`
- Create: `src/modules/dashboard/components/recruiter-tiles.tsx`, `recruiter-bento.tsx`, `admin-tiles.tsx`, `admin-bento.tsx`
- Test: `src/modules/dashboard/manager-queries.test.ts`, `tests/integration/dashboard-counts.test.ts` (real Postgres), `tests/e2e/dashboard-managers.spec.ts`

**Interfaces:**
- Produces (recruiting, each `requireUser()` + `authorize(user, "recruiting.summary", ...)`): `getUpcomingInterviews(limit = 3): Promise<{ title: string; startsAt: Date; kind: string; scorecardDue: boolean }[]>` (table `talent.interviews`, status scheduled, next 7 days); `getOffersPending(): Promise<{ awaitingSignature: number; declined: number; expiringSoon: number }>` (table `talent.offers`; check its status column and values in `offers/schema.ts` first); `getNewApplicantsByOpening(): Promise<{ title: string; count: number }[]>` (from `listOpenings()` `newThisWeek`, top 3).
- Produces (admin, `authorize(user, "settings.view")`-style check: read the actual permission names in `src/modules/settings/permissions.ts` and use the one that gates invitations, and `audit.view` for audit counts): `getAccessCounts(): Promise<{ invitationsPending: number; roleChangesWeek: number; mfaMissing: number }>`; `getAuditHighlights(): Promise<{ exportsWeek: number; sensitiveViewsWeek: number; importsWeek: number }>` (counts of `ops.audit_log` rows by action prefix over 7 days: `export.*`, `sensitive.view`, `import.*`; content never selected).
- `RECRUITER_TILES`: Pipeline 4 · Offers pending 2 (emphasised) · Interviews 3 · New applicants waiting 3 · Open roles 2 · Talent pool 2 (`getPoolView` count only) · Celebrations 2. `ADMIN_TILES`: System health 2 · Risks 2 · Decisions 2 · Access 3 · Audit highlights 3 · Workforce 2 · Who is out 2 · Celebrations 2.

- [ ] **Step 1: Write failing integration test** `tests/integration/dashboard-counts.test.ts` (follow an existing integration file for setup): seed two interviews (one past, one in 2 days), one offer per status, three audit rows with actions `export.hours`, `sensitive.view`, `auth.login`; assert `getUpcomingInterviews` returns only the future one, `getOffersPending` counts, `getAuditHighlights` counts 1/1/0 and returns no `before`/`after` content.
- [ ] **Step 2: Run** `pnpm test:integration -- dashboard-counts`. Expected: FAIL.
- [ ] **Step 3: Implement** the five queries. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Write failing authz test** per role for each new query (employee and team lead refused for admin queries; employee refused for recruiting queries) in `tests/authz/dashboard-counts-queries.test.ts`; run (FAIL), then make queries `authorize` as specified; run (PASS).
- [ ] **Step 6: Implement** tiles and both bento views; **Step 7: extend the e2e** with a recruiter and a Super Admin account (all regions present).
- [ ] **Step 8:** lint, typecheck, unit and integration tests green. **Step 9: Commit** `feat(dashboard): recruiter and admin bento views`.

### Task 7: Wire the page

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`, `src/modules/dashboard/components/kpi-cards.tsx` (no longer used for the migrated lenses; remove only if nothing imports it), `tests/e2e/dashboard.spec.ts` (update assertions that name "Key numbers" for views that now use KPI tiles)
- Test: `tests/e2e/dashboard-managers.spec.ts`, `src/ui-conventions.test.ts` (must stay green)

**Interfaces:**
- Consumes: `MeStrip`, `TeamLeadBento`, `HrBento`, `ExecutiveBento`, `RecruiterBento`, `AdminBento`, `MyWorkBento`.
- Produces: `page.tsx` renders `GreetingHeader`, then for every lens `MeStrip` (except `my_work`, which already is the personal view) and the lens's bento; the old panel layout is deleted once all six lenses are covered.

- [ ] **Step 1: Update the e2e** `dashboard.spec.ts` first so its expectations match the new regions (dual-role test: Admin view shows "Needs your decision" and "System health"; team view shows "Team hours"; "Add person" and "Review hours" buttons still present).
- [ ] **Step 2: Run it** (temporary Chrome config, `E2E_BASE_URL` pointing at the dev server). Expected: FAIL on the old layout.
- [ ] **Step 3: Rewire** `page.tsx` with a `switch (lens)`; keep `maxDuration` and the `Loading` skeleton helper only if still used.
- [ ] **Step 4: Run** the e2e, then `pnpm lint && pnpm typecheck && pnpm vitest run && pnpm build`. Expected: all green.
- [ ] **Step 5: Verify visually** at 1500, 820 and 390 px, light and dark, for each lens; look for empty gaps, overflow, console errors (the test harness in Task 3's e2e can capture console errors: none besides the existing logo and font warnings).
- [ ] **Step 6: Update** `docs/modules/app-shell-and-dashboard.md` (views, tile list, Me strip, Decisions, Celebrations, rules). **Step 7: Commit** `feat(dashboard): bento layout for every view`.

### Task 8: Edit layout

**Files:**
- Modify: `src/modules/dashboard/schema.ts` (create if absent, `core` schema) or `src/modules/core/schema.ts` (follow where per-user preferences already live), `src/modules/dashboard/permissions.ts`, `tests/authz/matrix.test.ts`
- Create: `src/modules/dashboard/layout-service.ts` (server-only), `src/modules/dashboard/layout-actions.ts` (`"use server"`), `src/modules/dashboard/layout-validators.ts`, `src/modules/dashboard/components/edit-layout.tsx` (client dialog), migration via `pnpm db:generate`
- Test: `src/modules/dashboard/layout-validators.test.ts`, `tests/authz/dashboard-layout-actions.test.ts`, `tests/integration/dashboard-layout.test.ts`, e2e extension

**Interfaces:**
- Table `core.dashboard_layouts`: `userId uuid` (FK `core.users`), `view text` (a `Lens`), `hidden jsonb` (string array), `order jsonb` (string array), `updatedAt timestamptz`; primary key `(userId, view)`; RLS enabled.
- Permission `dashboard.customize`: own scope, all six roles (matrix row `"O O O O O O"`).
- `layoutSchema` (Zod): `{ view: z.enum(LENSES), hidden: z.array(z.string().max(40)).max(30), order: z.array(z.string().max(40)).max(30) }`.
- `getLayout(user: AuthUser, view: Lens): Promise<{ hidden: string[]; order: string[] } | null>`; `saveLayout(user, input): Promise<{ ok: true } | { ok: false; error: string }>` in `layout-service.ts`; actions `saveDashboardLayout(input: unknown): Promise<ActionResult>` and `resetDashboardLayout(input: unknown): Promise<ActionResult>` (`requireUser()` first, then `runAction`, audit `dashboard.layout_save` / `dashboard.layout_reset` with the view and tile ids only).
- `EditLayout({ view, tiles, layout })`: dialog (use `FormDialog`) listing every tile of the view with a show/hide checkbox and move up/down buttons (keyboard-usable), "Reset to default"; mounted in the Me strip's `actions` slot. `page.tsx` passes the loaded layout to `BentoView`.

- [ ] **Step 1: Write failing tests**: validator accepts a valid layout, rejects an unknown view, over-long ids and 31 entries; authz test for each of the six roles saving their own layout (not refused) and for a layout whose `view` the person does not hold (saved but harmless: `arrangeTiles` only touches ids that exist); integration test: save, read back, save again replaces, reset deletes the row, audit row carries ids only.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement** schema, migration, permission, service, actions, validators. **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Implement** `EditLayout` and mount it; hidden tiles are removed by `arrangeTiles`; a hidden "Needs your decision" tile still leaves the approvals reachable from the sidebar.
- [ ] **Step 6: Extend the e2e**: a lead hides "Team flags" and moves "Reviews and goals due" first, reloads, sees it persisted, then resets.
- [ ] **Step 7:** `pnpm lint && pnpm typecheck && pnpm vitest run && pnpm test:integration && pnpm build`. Expected: all green.
- [ ] **Step 8: Update docs** (`app-shell-and-dashboard.md`), add the birthday notice line reminder to the pending privacy-notice update, **Step 9: Commit** `feat(dashboard): edit layout (hide and reorder tiles)`.

### Task 9: Final check

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm vitest run && pnpm test:integration && pnpm build`. Expected: all pass.
- [ ] **Step 2:** Run the e2e specs `dashboard.spec.ts`, `dashboard-bento.spec.ts`, `dashboard-managers.spec.ts` against the local app through the temporary Chrome config; delete the temporary config afterwards.
- [ ] **Step 3:** Ask the owner whether to run a whole-branch code review, and whether to push; do neither without a yes.
