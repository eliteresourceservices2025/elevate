# Bento dashboards for lead, HR, executive, recruiter and admin views

Date: 2026-11-19. Status: designs approved in chat ("approve as drawn"); this doc awaits approval before a plan is written.
Builds on the VA bento (`apps/elevate/src/modules/dashboard/components/my-work-bento.tsx`, `bento.tsx`), which is built and uncommitted.

## Intent
The VA view is now a compact bento grid. The other views (`team_lead`, `hr`, `executive`, `recruiter`, `admin`) still use the older two-column panel layout, and the recruiter view has no tiles of its own. Give every view the same bento look, put decisions first for managers, and add a few shared ideas so managers are not forced onto the VA view for their own day.

## Goals
- Same 6-column bento (tiles compact, no wasted space, collapses to 2 then 1 column) for every view.
- Shared skeleton on every manager view: slim **Me strip** (own clock state, hours this week, today's shift), then **Needs your decision** tile (approvals), role tiles, **Celebrations** tile.
- **Edit layout:** each person can hide or reorder tiles, saved per person. A preference only, never a permission; tiles still ask their own module.
- Counts and wording only on tiles: never a name or reason where the current widget rule forbids it; Safe Voice stays off the dashboard.

## Non-goals / anti-goals
- No pay, ratings or per-person training scores on any tile; executive tiles are counts, groups under 5 hidden (analytics rule).
- No new access: no tile may show something its owning module would not show that person. Hiding a tile is never the only guard.
- No peer presence ("clocked in") for VAs; the clocked-in list is for leads/HR through existing team-attendance queries.
- No job more frequent than 30 minutes; no new scheduled work needed.

## Views (6 columns; spans in brackets)
- **Team lead:** Decisions (4) · Team hours (2) · Clocked in now (2) · Team flags (2) · Celebrations (2, two rows) · Who is out (2) · Reviews and goals due (2). Top tile is approvals (time off, corrections, extra hours, timesheets), oldest first.
- **HR:** six KPI tiles (1 each: active, onboarding, offboarding, change requests, docs expiring, training overdue) · Decisions (4) · Risks (2) · Onboarding/offboarding tracker (3) · Workforce by team (3) · Needs attention (2) · Who is out (2) · Celebrations (2).
- **Executive:** Headcount and movement (3) · Hiring pipeline (3) · Training compliance (2) · Risks (2) · System health (2) · Time off this week, counts only (4) · Celebrations (2).
- **Recruiter:** Pipeline by stage (4) · Offers pending (2) · Interviews (3) · New applicants waiting (3) · Open roles (2) · Talent pool (2) · Celebrations (2).
- **Admin (Super Admin):** System health (2) · Risks (2) · Decisions (2) · Access: pending invitations, role changes this week, MFA not set up (3) · Audit highlights: counts of exports, sensitive views, imports (3) · Workforce (2) · Who is out (2) · Celebrations (2).
- Celebrations on manager views is one combined tile (birthdays, anniversaries, new joiners); VAs keep three separate tiles. Birthdays still honour the opt-out and never carry the year.

## Approaches considered
1. **One layout component per view, shared tile primitives (chosen).** Each view is a small component like `my-work-bento.tsx` placing its tiles; tiles live beside their module's queries. Simple, testable, easy to reorder.
2. A generic tile registry plus per-role config. Cleaner for Edit layout but a bigger refactor up front; revisit when Edit layout is built, using the registry only for ordering and hiding.
3. Keep the old panels and only restyle. Cheapest, but cannot give the dense, no-whitespace result the owner asked for.
Chosen: 1, with the tile list per view held in one array so Edit layout can later filter and reorder it.

## Build order
1. Shared pieces: Me strip, Decisions tile (reuses `getApprovalQueue`), combined Celebrations tile (reuses `people-strip-queries.ts`).
2. Team lead, then HR (reuse KPI, tracker, workforce, risks, attention queries, restyled as tiles).
3. Executive, Recruiter, Admin. Recruiter tiles need new read queries on the recruiting module (pipeline counts, interviews, offers); Admin tiles need counts for invitations, role changes, MFA, audit actions. Each query is `requireUser()` + `authorize()` and returns counts only.
4. Edit layout: per-person hidden/ordered tile ids (new small table, own scope, audit with ids only), then wiring.

## Constraints
Every new query starts with `requireUser()` and `authorize()`; per-role authz tests for each new permission; Zod on the layout action; RLS on any new table with a migration; tiles wrapped in `guarded()` and `Suspense`; the 6-query database limiter respected; `docs/modules/app-shell-and-dashboard.md` updated; help-center screenshots re-taken after the UI lands.

## Left to the builder
Exact tile contents and wording within the rules above; which existing queries to extract versus wrap; the layout-preference table shape; e2e coverage per view.

## Open points to confirm while building
- Interview data source for the recruiter tile (exists in recruiting module? scorecard due wording).
- Whether "Team flags" counts reuse `listFlags` as is.
- The privacy notice line about birthdays is still pending (see the VA bento work).
