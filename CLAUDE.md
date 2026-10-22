# ELEVATE — instructions for Claude Code

ELEVATE (ELITE Employee & VA Engagement / Talent Experience) is the internal HRIS for Elite Resource Services (ERS), a Philippine VA staffing company with 125+ employees and VAs, many serving US healthcare clients. It holds sensitive personal data. **Security and privacy rules below are non-negotiable; if a request conflicts with them, stop and ask.**

The full design is in `docs/architecture-plan.md`. Read the relevant section before starting a module, and the matching `docs/modules/*.md` file listed under "Module notes" below. Build order: `docs/BUILD-PROMPTS.md`; environment: `docs/SETUP.md`; first deployment: `docs/DEPLOY.md`; going live on the Pro plans: `docs/PRODUCTION-CHECKLIST.md`.

## Repo layout

pnpm workspace. All paths in this file (`src/...`, `tests/...`, `drizzle/`) are relative to `apps/elevate/` unless noted.

- `apps/elevate/` — the main Next.js app (`pnpm dev` from the repo root runs it)
- `apps/safe-voice/` — separate anonymous app, deployed on its own subdomain (Phase 4.2; see the Safe Voice section)
- `apps/learn/` — ELEVATE Learn, the training app (HIPAA and Cybersecurity courses, client add-ons, own subdomain; notes in `docs/modules/learn.md`, plan in `docs/learn/`)
- `packages/` — shared code (empty for now)
- `supabase/` — Supabase CLI config (repo root). The CLI is a dev dependency: `pnpm --filter elevate exec supabase ...` with `--workdir ../..`
- `brand/` — ERS brand kit and logos; theme tokens live in `apps/elevate/src/app/globals.css`
- Next.js 16 differs from older versions; read `apps/elevate/AGENTS.md` and `node_modules/next/dist/docs/` before using framework APIs.

## Decisions made with the owner

- **Time zones:** default `America/Phoenix` (MST/AZT, no daylight saving), secondary `Asia/Manila`, every user can choose their own zone. Use `src/lib/time.ts`; never hardcode a zone.
- **Worker classification: 1099 contractors** (not W-2 employees). Confirm with counsel before building leave accrual, PTO wording, and "employee" copy in the careers page and contracts.
- **Language:** English only.
- **Brand:** main purple `#6C1ABA` (the ERS website color; the bosses disliked the earlier dark violet sidebar) + gold `#E2BE2B` as the accent; Source Sans 3 (headings), Inter (body), JetBrains Mono. Text is a neutral deep ink, not violet. Gold is for fills and accents, not body text on white (contrast). **Light and dark themes** (tokens in `globals.css`, `:root` and `.dark`): ELEVATE uses `next-themes` (`ThemeProvider`, `ThemeToggle` in the header: light, device setting (default), dark; the choice is saved in this browser). **Safe Voice follows the device setting and has Auto/Light/Dark buttons that live in page memory only**: it must never write to browser storage (a test scans for it), so a reload returns to the device setting.
- **Jibble:** build both the API mirror and the nightly fallback comparison; the mirror stays off for a team until a signed monitoring policy exists.
- **Repo:** https://github.com/eliteresourceservices2025/elevate (private). Do not push without the owner's OK.

## Stack

- Next.js 16.3 App Router, React 19, TypeScript strict, pnpm, Node 24
- Tailwind CSS v4 + shadcn/ui; lucide-react icons; TanStack Table; shadcn charts (Recharts); React Flow for the org chart; dnd-kit for boards
- React Hook Form + Zod (one schema in `validators.ts`, used by the form AND the server action)
- Supabase: Auth (Google + email/password, TOTP MFA), Storage (private buckets), Postgres (Singapore)
- Drizzle ORM + drizzle-kit migrations; schemas `core`, `docs`, `time`, `talent`, `ops`
- Inngest (jobs), Vercel Cron, Resend + React Email, pdf-lib, Upstash rate limiting, Sentry
- Vitest (unit + authz tests), Playwright (e2e)

## Architecture rules

1. **Modular monolith.** Each module lives in `src/modules/<module>/` with `schema.ts`, `actions.ts`, `queries.ts`, `validators.ts`, `permissions.ts`, `components/`. A module never imports another module's `schema.ts` directly for writes; call that module's exported functions.
2. **Server Components by default.** Add `"use client"` only for interactivity. No Redux/Zustand; URL state via `nuqs`; TanStack Query only for live-refresh grids.
3. **All data access is server-side through Drizzle** (`src/lib/db.ts`, which imports `server-only`). Never query app tables with supabase-js from the browser. supabase-js is used only for auth and signed storage URLs.
4. **Every server action and query starts with** `const user = await requireUser()` (AAL2 enforced) and `await authorize(user, "<module>.<action>", resource)`. Hiding a button is never the only guard.
5. **Validate every input with Zod on the server**, even if the form already did.
6. Leave balances come only from the append-only `time.leave_ledger`; never store a mutable balance number.
7. Use soft delete (`archived_at`); never hard-delete employee records except through the retention job.
8. Dates: store `timestamptz` in UTC; display in the viewer's zone; schedules also show the client's zone. Use `date-fns-tz`.
9. **Time and attendance: ELEVATE is the time clock and the only source of hours.** `time.clock_events` is append-only (clock_in, break_start, break_end, clock_out); corrections are new rows with a reason and lead approval, never edits. Timestamps come from the server clock and the IP from the request, never from values the browser sends. Location is optional, needs the employee's permission, and is stored rounded (~1 km). `time.attendance_days` is always rebuilt from clock events, never edited by hand.
10. **Jibble is used only for screenshots.** On clock-in/clock-out, ELEVATE mirrors the event to Jibble through its API (queued in Inngest, retried, logged in `time.jibble_link_log`). Never read hours from Jibble into payroll exports, and never copy Jibble screenshots, GPS or activity data into ELEVATE: screenshots can contain client patient data.

## Job frequency (Inngest cost)

- Scheduled jobs are deliberately infrequent (about 19,000 runs a month in total, safely inside Inngest's free allowance). The most frequent are overbreak alerts (10 min), the Jibble sweep (15 min) and a handful at 30 minutes. Do not add a job that runs more often than every 30 minutes without a reason: each run counts toward the plan. The host cron backstop (15 min) covers the attendance-critical work. When changing a schedule, change `src/inngest/functions.ts` AND `health/registry.ts` together.

## Database connection (do not remove the query limiter)

- `src/lib/db.ts` wraps the driver with `limitQueries` (`src/lib/limit-queries.ts`): **at most 6 queries run at once, the rest wait in the app**, never inside the driver. Reason: behind Supabase's transaction pooler (Supavisor, port 6543, which production uses) a driver that queues more queries than it has connections stalls the pooler: a server connection sits `active` in `ClientRead` until the 2-minute statement timeout, and every other query waits behind it, so a page that asks for 20+ things at once (the dashboard) froze for minutes. Proven with a plain script: 30 parallel queries hung, 150 through the limiter took 0.5 s. Settings that did NOT help: `max`, `max_pipeline`, `prepare`, `fetch_types`.
- The limit is below `max: 10` connections on purpose, so transactions (`db.transaction` reserves a connection) still find one free. Keep it that way when changing either number.
- **To reproduce pooler problems locally:** set `[db.pooler] enabled = true` in `supabase/config.toml` (`default_pool_size = 15` matches the free plan), `supabase stop` then `supabase start`, and run the app with `DATABASE_URL=postgresql://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres`. Dashboard panels also time out after 20 s (`guarded`), so a database stall shows a notice instead of a frozen page.

## Testing

- `pnpm test` unit and authz tests (no database). Every action has a per-role test; `tests/authz/matrix.test.ts` is the hand-written permission matrix.
- `pnpm test:integration` real-Postgres tests in a throwaway `elevate_test` database. Needs `TEST_DB_ADMIN_URL` (local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). CI runs it with a Postgres service. Use it for anything about encryption, audit, history or approvals: mocks cannot catch SQL mistakes.
- `pnpm test:e2e` Playwright against the local Supabase (`supabase start`, `pnpm db:migrate`). If your dev server already runs, use `E2E_BASE_URL=http://localhost:3000`. It creates throwaway fake accounts and people in the local database, so the local directory and org chart fill with "E2E" people over time (`supabase db reset`, then migrate and seed, cleans up). Not run in CI.

## Organization and team scope

- Who reports to whom and which team someone is in are **dated** (`core.reporting_lines`, `core.team_memberships`); `employees.manager_id/team_id` hold the current values. Change them only through `applyReporting()` in `src/modules/org/service.ts`: no future dates, nothing before the current assignment began, manager must be active, no loops. It writes history.
- Loops are refused by a database trigger (advisory-locked, so concurrent changes cannot slip past). Never update `manager_id` outside `applyReporting`.
- **"Team" scope = everyone below you in the chain** (direct and indirect). Resources for team checks carry `managerChainUserIds` (see `managerChainUserIds()`); without it team access is denied. A manager sees a report's profile in a **limited view**: no birth date, civil status, personal email or home address.
- **Attendance lead (a second lead for time matters)** (`core.attendance_leads`, migration 0053, `org/service.ts`: `applyAttendanceLead`, `timeChainUserIds`, `timeNoticeUserIds`, `timeDownlineEmployeeIds`; HR sets it on the Employment tab, `org.manage_reporting`): someone who reports their time to a lead who is not their manager. For **time matters only** (hours review and approval, time corrections, extra hours, time off, team attendance, the dashboard's time approvals and their notices) the attendance lead counts as "above" the person, and gets the notices first. Every time-related module uses the `time*` helpers; everything about the person's record (profile, reviews, goals, documents, assets, onboarding, recruiting, analytics) keeps the manager chain (`managerChainUserIds`, `downlineEmployeeIds`). A lead only holds the reach their ROLE gives them, so an attendance lead who is not a Team Lead decides nothing. The lead may not be the person, someone below them, or someone who left. **An Executive who is someone's manager also approves that person's time off** (`timeoff.approve` is team scope for the Executive role; no other time permission was given to the Executive).
- A person who still has active reports cannot be archived or marked separated; HR reassigns them first (`reassignReports`).
- Positions are a catalog; `employees.position` is the display title kept in sync.
- To roll back a half-finished multi-step action, **throw** `ActionFailure` inside the transaction (returning commits).

## Files, notifications and background jobs

- **Folders** (`docs.document_folders`, `documents.folder_id`, migration 0047; `documents.organize`: HR for anyone, a person for their own): a person's documents can be sorted into their own folders (30 at most, unique names per person, plain names, never written to the audit log: only ids). Removing a folder archives it and its documents return to "No folder". A document can only go into a folder of the same person (checked in `moveDocument` and at upload). The person's Documents tab is `DocumentLibrary` (folder buttons with counts, paged list, a "Move to" choice per row). Files that came from TalentHR sit in a per-person folder "Imported from TalentHR" (migration backfill).
- **Files:** private buckets `employee-docs` and `company-docs` (create them with `pnpm storage:setup`, local or hosted). Upload is three steps: `requestUpload` (validates, server picks the path, returns a one-time token) -> browser uploads straight to storage -> `finalizeUpload` (server reads the file, checks the real type by its bytes, size and SHA-256, then activates it; a failing file is deleted). Never trust the browser's file name or declared type. Downloads are 60-second signed links and every one is audited. Archiving keeps the file until retention periods are approved.
- All storage goes through `DocumentStorage` (`src/modules/documents/storage.ts`); tests use `FakeStorage`. Do not call Supabase Storage from anywhere else.
- **Every exported function in a "use server" file is a public endpoint.** Each must call `requireUser()` first, and helpers that take the acting user as a parameter belong in a separate server-only file (see `service.ts` files). `tests/authz/server-actions-guard.test.ts` enforces this.
- **Notifications:** `notify()` (`src/modules/notifications/service.ts`) writes in-app notifications; links must be relative. The bell in the header reads only the signed-in person's own.
- **Jobs (Inngest):** scheduled functions in `src/inngest/functions.ts` are thin wrappers around plain tested functions (`src/modules/documents/jobs.ts`). Local: `INNGEST_DEV=1` in `.env.local` plus `pnpm dlx inngest-cli@latest dev`. Production: `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`; without a key the endpoint refuses to run. Job dates follow the company time zone (`America/Phoenix`).

## Navigation rule

**A menu item opens its own page, at its own address, with its own item highlighted. Never redirect a menu item to a tab of another page** (it reads as "the menu took me somewhere else"). If two things belong together, link between them inside the pages instead. "My profile" (`/people/me`) renders the profile itself (`ProfileView`, shared with `/people/[id]`) rather than redirecting to the People list, and Schedules (`/schedules`) is its own page. A new module gets a page at the menu's address; the sidebar highlights the longest matching link.

## UI conventions (enforced by `src/ui-conventions.test.ts`)

- **Every page starts with `PageHeader`** (title = the page's only h1, description, actions, breadcrumbs instead of a "back" link) inside **`PageContainer`** (widths `full`, `wide`, `medium`, `form`, `narrow`). Never write an `<h1>` or a `max-w-*` root wrapper in a page.
- **Tabs that are addresses use `TabNav`**; a long form opens in a `FormDialog` from a header button; an empty list uses `EmptyState`; a tinted note uses `Alert` (variants `success`, `warning`, `info`, `destructive`, `muted`).
- **Status colours are tokens**: `success`, `warning`, `info`, `destructive` (with `-surface`). Never raw `red/amber/green-*` classes (document categories, the label sheet and the signing paper preview are the only exceptions). New colour pairs must reach 4.5:1 (`src/app/status-tokens.test.ts`).
- **Control heights** are `h-(--control-h)`, `h-(--control-h-sm)`, `h-(--control-h-lg)` (the variable form, so `cn()` lets a component's own `h-11` win). Fonts are Inter (text) and Source Sans 3 (headings) only; the monospace font is for codes and IDs.
- **Never add `loading.tsx` to a route that can call `notFound()`** (it turns the 404 into a 200); use a `Suspense` fallback inside the page. Long lists get a card list below the tablet width, not a sideways-scrolling table.
- Details and the component list: `docs/modules/app-shell-and-dashboard.md`.

## Module notes (read the file before changing that area)

The detailed working notes for each module live in `docs/modules/`. They are not loaded automatically: **open the matching file before you change, extend or test that area**, then follow it. The hard rules are repeated here so they are never missed.

### Announcements, policies and email — `docs/modules/announcements-and-privacy.md`
Announcements, versioned policies, email queue, privacy notice gate, My data.

- Policy and announcement versions are frozen by triggers; acknowledgments are insert-only.
- All email goes through `ops.email_queue` under the daily budget; bodies carry counts and a link only.
- Markdown is rendered to React elements, never an HTML string; every Markdown box is `MarkdownField`.
- Publishing the privacy notice is permanent and gates everyone; never publish one against a shared dev database.

### Time off — `docs/modules/time-off.md`
Prize days, the leave ledger, requests and approvals.

- 1099 contractors: no accrual or PTO; days off are HR-awarded prize days; copy never says PTO.
- `time.leave_ledger` is append-only; a balance is the sum of rows, never stored; take the ledger lock for writes.
- Nobody decides their own request or awards their own days.

### The time clock — `docs/modules/time-clock.md`
Clock events, breaks, corrections, time claims, end-of-day notes.

- `time.clock_events` is append-only; server clock and request IP only; corrections are new rows with approval.
- `attendance_days` is rebuilt from events, never hand-edited; the clock is online-only on purpose.
- Location and selfie are monitoring: only under a published monitoring policy; screenshots in claims are proof, never hours.

### The Jibble link — `docs/modules/jibble.md`
Jibble mirror, repair job, safety lock, pause switch.

- Jibble is only for screenshots; ELEVATE is the only source of hours. Never store Jibble screenshots, GPS or activity.
- ELEVATE sends to Jibble only when `ELEVATE_ENV=production`; tests use a fake client and never call the real API.
- Jibble being down must never block or slow the ELEVATE clock.

### Schedules and extra hours — `docs/modules/schedules-and-extra-hours.md`
Shift schedules, nightly flags, extra-hours requests.

- A shift belongs to the day it starts in the person's own zone; people with no schedule get no flags.
- Copy says "extra hours", never "overtime"; ELEVATE labels hours and never computes pay.

### Hours review, export and system health — `docs/modules/hours-review-and-health.md`
Hours approval, payroll export, test-only days, job health, backstop.

- `time.hours_approvals` and `hours_marks` are append-only; nobody approves their own hours; export never computes pay.
- A new scheduled job must be added to both `src/inngest/functions.ts` and `health/registry.ts` and wrapped in `track()`.
- `docs/RUNBOOK.md` is the operations guide; keep it current.

### App shell, dashboard and search — `docs/modules/app-shell-and-dashboard.md`
Shell layout, tables, account menu, dashboard widgets, search, paging.

- Use `overflow-clip`, not `overflow-hidden`, on the shell; only the content area scrolls.
- A dashboard view only reorders widgets and is never a permission; widgets show counts and wording, never a name or reason; Safe Voice is not on it.
- Every long list is paged with `PagerLinks` or `usePaged`.

### Recruiting, signing, offers and onboarding — `docs/modules/recruiting-and-hiring.md`
Applicants, interviews, ELEVATE Sign, offers, hiring, onboarding and offboarding.

- Applicants are not employees; stage history, scorecards and signing events are append-only (signing events are hash-chained).
- Pay is a free-text note only; letters say "independent contractor".
- Documents are shown in the page through our own authenticated route, never a storage link. **In-page preview** (`/api/documents/[documentId]/preview`, `/api/recruiting/resume/[applicationId]`): PDFs and pictures as they are, DOCX rebuilt as safe plain HTML in a CSP sandbox (`documents/docx.ts`; never put converter output in the page as raw HTML, and a Word file declaring an unreasonable unpacked size is refused before it is opened); DOC stays download-only. Access goes through `authorizeDocumentView` (`documents/service.ts`), the same check as the download link, audited as `document.preview`.
- The ATS layer (applicants list, source and tags, bulk actions, resume keyword match, talent pool, duplicate merge, reports, email wording) is in the "ATS layer" section of the module notes. The keyword match is a reading aid only: no AI, resume text never stored, nothing about the person used, nobody rejected by it. Bulk actions never hire. Only applicants who ticked "keep my details" can be in the talent pool. Name no form field `id` (it shadows `form.id`).
- Separation is a retryable step list; assets and final hours are tracked, never computed.

### Performance reviews and goals — `docs/modules/reviews.md`
Review cycles, calibration, visibility rules, goals.

- No pay, raise or bonus field exists; ratings are never converted into pay; no review content in emails or notifications.
- Visibility is the pure `visibility()` function; nobody writes or shares their own review.

### Safe Voice — `docs/modules/safe-voice.md`
The anonymous reporting app and the handler side.

- Anonymous by design: no user id, IP, user agent, cookie, file name or time of day is stored or logged; UTC day only.
- Separate app and database roles; ELEVATE reads cases only through `handler-db.ts`; only designated handlers see cases.
- Never put counts or a live feed of Safe Voice on the dashboard; the pepper must never change.
- `apps/safe-voice/tests/privacy.test.ts` scans the source: no cookies, no browser storage.

### Assets and people analytics — `docs/modules/assets-and-analytics.md`
Equipment tracking with QR labels; aggregate people analytics.

- Assets track items only, never money; assignment history is append-only with one active assignment per item.
- Analytics reads only aggregate tables; groups under 5 are hidden on the server; no per-person rows, pay or review ratings.

### TalentHR import and go-live — `docs/modules/talenthr-import.md`
CSV and Excel import, API pull, reconciliation, go-live checklist.

- Real exports are never put in the repo, tests or a development database; tests use the invented fixtures.
- Imports are previewed first, committed in one transaction, and rolled back by archiving, never deleting.
- `talenthr:pull` refuses to run unless `ELEVATE_ENV=production`; the API key lives only in a git-ignored env file.

### Invitations, certificates, deactivation, support, anniversaries — `docs/modules/people-admin.md`
Invitation roles, Certificates, account deactivation, Contact support, anniversary reminders.

- Invitation grants are applied exactly once at first sign-in, and only if the invitation had not expired.
- Certificates are a name and dates only (no file, number or score); a renewal is a new row.
- Deactivating bans sign-in and archives the account; a person with an active people record is refused (use Offboarding).

### ELEVATE Learn (HIPAA and other training) — `docs/modules/learn.md`
The Learn app, course content and studio, assignment jobs, client add-ons, certificates, evidence report.

- Read `docs/learn/` before touching `apps/learn` or the `learn` schema; a new `learn` function must be granted to `learn_app` on purpose.
- Learn has no Supabase keys and no ELEVATE secrets; people arrive by a one-time POST handoff token; the answer key never reaches the app role.
- Content is validated JSON, never HTML; published versions are frozen; the certificate PDF file is duplicated in both apps and a test fails if they differ.
- Training never blocks work (overdue warns only); evidence and status views show completion only, never scores to leads or clients.

### Schedule and client import from an attendance sheet — `docs/modules/schedule-import.md`
Settings > Import schedules and clients: upload the team's attendance sheet (CSV or XLSX), preview what would change.

- HR and Super Admin only; it sets assignments and schedules, never worked hours (the sheet's totals are ignored).
- Anything it cannot match with certainty goes to a person with the reason; nothing is guessed, and people missing from the sheet are never ended automatically.
- Rows are one encrypted payload, wiped on discard, on apply and after 14 days; audit entries hold counts only.
- Matches HR confirms (a sheet's spelling of a person or client) are remembered by normalized spelling and used on later sheets; column layouts are remembered by header row.
- Apply re-checks everything under a lock and refuses a stale preview; a row that no longer fits is skipped with the reason; ending is only for assignments HR ticked; backdating needs the shown impact acknowledged.

### Voluntary self-identification (gender, pronouns, sexual orientation, religion) — `docs/modules/demographics.md`
Optional profile answers and the optional part of the apply form.

- Everything is optional. Gender, sexual orientation and religion are private unless the person switches "Show on my profile to colleagues" on for that answer (owner decision 2026-10-22; off by default, per field); otherwise HR sees combined counts of 5 or more only. Applicant answers are never shown, only counted.
- Separate tables, never joined into people or recruiting queries; sexual orientation, religion and self-descriptions are encrypted.
- Never used for hiring, pay, promotion, reviews or any scoring; audit rows carry field names only. Pronouns are always public.

### Privacy incident reports — `docs/modules/incidents.md`
Staff privacy incident reports and their handling.

- Free text written by staff; the form forbids patient details; audit entries and notices never carry the text.
- Only the reporter, HR, Super Admin and the Privacy Officer flag see a report; nobody handles their own report.

### Help center and the screenshot tool — `docs/modules/help-center.md`
Plain-English how-to guides (files in `apps/elevate/content/help`), role-aware, with pictures taken by `pnpm help:shots`.

- Each guide has an `audience`; a guide a person may not read is a 404 everywhere (page, title, picture, video). Pictures and videos are served by a signed-in route, never `public/`.
- Guides name real buttons: after changing a screen a guide shows, run `pnpm help:shots` and re-read the guide. Fake data only; never client or patient information.
- The tool runs against the local database only; reset it first for clean pictures (see the note).

## Adding a permission or action

1. Add the action to that module's `permissions.ts` (`"<module>.<action>": { roles: { hr_admin: "all", ... } }`). Scopes: own, team, all. Nothing listed = no access.
2. Add the matching row to `tests/authz/matrix.test.ts` (written by hand from the architecture plan, never derived from the registry). The suite fails if an action has no row.
3. In the action or query: `const user = await requireUser()` first (outside `runAction`), then `await authorize(user, "<module>.<action>", resource)` inside it. Return `runAction(...)` results. Pages wrap queries in `orNotFound()`.
4. Write `writeAudit()` inside the same transaction as the change. Pass `tx`.
5. Add the action to a per-role authz test like `tests/authz/settings-actions.test.ts`.
6. `team` scope needs `managerChainUserIds` on the resource (Phase 1.2); without it team access is denied.

The audit log is insert-only at the database level (trigger). Test data written to it stays until `supabase db reset`.

## Encrypting sensitive fields

`src/lib/crypto.ts`: `fieldCrypto().encrypt(value, context)` / `.decrypt(stored, context)`. The context string binds a value to its place, for example `employee_sensitive:tin:<employeeId>`, so a ciphertext copied to another row or column will not decrypt. Always use the same context when reading and writing. Decrypt only after `authorize()`, call `writeAudit()` with action `sensitive.view` (field name, never the value), and show `maskValue()` by default. Rotation: put the new key first in `FIELD_ENCRYPTION_KEYS` (`v2:...,v1:...`), run the re-encrypt job until `needsReencrypt()` is false for every row, then drop the old key. Losing every copy of a key makes its fields unreadable, so keep copies in the password manager.

## Seed data

`pnpm db:seed` creates one fake sign-in account per role (`seed.<role>@example.com`; password in the git-ignored `apps/elevate/.seed-credentials.local`) and refuses to run against production or any remote database unless `ELEVATE_ENV=staging`. The deterministic 40-employee dataset lives in `src/lib/seed/data.ts` and is inserted with clients, assignments, encrypted fake IDs, 2 departments, 6 teams, the position catalog and a reporting tree (Employee account reports to the Team Lead account, who reports to the Executive account). Re-running fills only what is missing.

## Security and privacy rules

- **MFA:** the `(app)` layout and `proxy.ts` require AAL2. No page or action works at AAL1 except MFA enrollment/challenge.
- **Roles:** Super Admin, HR Admin, Team Lead, Recruiter, Executive, Employee. Scopes: own, team, all. The matrix in `docs/architecture-plan.md` §3 is the source of truth; `src/lib/authz.ts` implements it; `tests/authz/` must cover every action for every role.
- **Sensitive fields** (government IDs: TIN, SSS, PhilHealth, Pag-IBIG; bank/payout details; pay rates) live only in `core.employee_sensitive`, encrypted with `src/lib/crypto.ts` (AES-256-GCM, versioned keys). Decrypt only for Super Admin, HR Admin, or the employee (masked by default). Every decrypt writes an audit entry.
- **Audit:** call `writeAudit()` for logins, role changes, approvals, exports, imports, sensitive views, and every create/update/delete on employee data (store before/after JSON, minus secrets).
- **RLS:** every new table gets `ENABLE ROW LEVEL SECURITY` in its migration with no public policies.
- **Secrets:** only `NEXT_PUBLIC_*` values may reach the browser. Never log tokens, passwords, government IDs or file contents. Sentry must not receive PII.
- **Files:** private buckets only; signed URLs expire in 60 seconds; allowlist PDF, JPG, PNG, WEBP, DOC, DOCX up to 10 MB, judged by the file's bytes (`sniffFileKind`), never its name; check MIME type server-side. An old-format Word file (DOC) is accepted only when it holds a Word part and no macro project, a DOCX only with no `vbaProject`; Excel, PowerPoint, Outlook files and anything with macros stay refused.
- **Rate limit** login, careers apply, and Safe Voice endpoints with Upstash.
- **Safe Voice** is anonymous: it runs on its own subdomain/app, never reads auth cookies or sessions, never stores user ID, IP, user agent or file metadata. Reporters get a random case code + passphrase (hashed with a pepper). Only designated handlers can read cases.
- **No patient data (HIPAA):** no module may have fields for client patient information. Upload screens show a warning not to upload client records.
- **Real data only in production.** Seeds and tests use fake data (Filipino and US names, fake IDs).

## Conventions

- File names kebab-case; React components PascalCase; server actions verb-first (`approveLeaveRequest`).
- Return `{ ok: true, data } | { ok: false, error }` from actions; show errors with toasts; never leak stack traces.
- UI copy: plain, short, sentence case. Brand: ERS colors via Tailwind theme tokens in `globals.css`.
- Password boxes use `PasswordField` (`modules/auth/components/password-field.tsx`): hidden by default with a Show/Hide button. Sign-in and sign-up failures that are about the platform (not the person's credentials) are told apart from a wrong password (`signup-errors.ts`); a wrong password, an unknown email and an unconfirmed email still read the same, and the not-invited rejection still reads as sign-up success.
- Accessibility: labels on every input, keyboard-usable dialogs and boards, 4.5:1 contrast.
- Write tests with each feature: Zod validators, authz for every new action, one Playwright happy path per flow.

## Commands

```bash
pnpm dev            # app on :3000
supabase start      # local Postgres/Auth/Storage
pnpm dlx inngest-cli@latest dev
pnpm db:generate    # after changing any schema.ts
pnpm db:migrate
pnpm db:seed
pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e
```

## Definition of done (every task)

- [ ] `authorize()` on every new action/query, with authz tests for all 6 roles
- [ ] Zod validation server-side
- [ ] Audit entries where required
- [ ] Migration generated, RLS enabled on new tables
- [ ] Lint, typecheck, unit and authz tests pass
- [ ] No secrets or PII in logs, client bundles or Sentry
