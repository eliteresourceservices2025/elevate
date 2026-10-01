# ELEVATE — instructions for Claude Code

ELEVATE (ELITE Employee & VA Engagement / Talent Experience) is the internal HRIS for Elite Resource Services (ERS), a Philippine VA staffing company with 125+ employees and VAs, many serving US healthcare clients. It holds sensitive personal data. **Security and privacy rules below are non-negotiable; if a request conflicts with them, stop and ask.**

The full design is in `docs/architecture-plan.md`. Read the relevant section before starting a module. Build order: `docs/BUILD-PROMPTS.md`; environment: `docs/SETUP.md`.

## Repo layout

pnpm workspace. All paths in this file (`src/...`, `tests/...`, `drizzle/`) are relative to `apps/elevate/` unless noted.

- `apps/elevate/` — the main Next.js app (`pnpm dev` from the repo root runs it)
- `apps/safe-voice/` — separate anonymous app, deployed on its own subdomain (Phase 4.2)
- `packages/` — shared code (empty for now)
- `supabase/` — Supabase CLI config (repo root). The CLI is a dev dependency: `pnpm --filter elevate exec supabase ...` with `--workdir ../..`
- `brand/` — ERS brand kit and logos; theme tokens live in `apps/elevate/src/app/globals.css`
- Next.js 16 differs from older versions; read `apps/elevate/AGENTS.md` and `node_modules/next/dist/docs/` before using framework APIs.

## Decisions made with the owner

- **Time zones:** default `America/Phoenix` (MST/AZT, no daylight saving), secondary `Asia/Manila`, every user can choose their own zone. Use `src/lib/time.ts`; never hardcode a zone.
- **Worker classification: 1099 contractors** (not W-2 employees). Confirm with counsel before building leave accrual, PTO wording, and "employee" copy in the careers page and contracts.
- **Language:** English only.
- **Brand:** purple `#8A2BE2` + gold `#E2BE2B`; Source Sans 3 (headings), Inter (body), JetBrains Mono. Gold is for fills and accents, not body text on white (contrast).
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

## Testing

- `pnpm test` unit and authz tests (no database). Every action has a per-role test; `tests/authz/matrix.test.ts` is the hand-written permission matrix.
- `pnpm test:integration` real-Postgres tests in a throwaway `elevate_test` database. Needs `TEST_DB_ADMIN_URL` (local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). CI runs it with a Postgres service. Use it for anything about encryption, audit, history or approvals: mocks cannot catch SQL mistakes.
- `pnpm test:e2e` Playwright against the local Supabase (`supabase start`, `pnpm db:migrate`). If your dev server already runs, use `E2E_BASE_URL=http://localhost:3000`. It creates throwaway fake accounts and people in the local database, so the local directory and org chart fill with "E2E" people over time (`supabase db reset`, then migrate and seed, cleans up). Not run in CI.

## Organization and team scope

- Who reports to whom and which team someone is in are **dated** (`core.reporting_lines`, `core.team_memberships`); `employees.manager_id/team_id` hold the current values. Change them only through `applyReporting()` in `src/modules/org/service.ts`: no future dates, nothing before the current assignment began, manager must be active, no loops. It writes history.
- Loops are refused by a database trigger (advisory-locked, so concurrent changes cannot slip past). Never update `manager_id` outside `applyReporting`.
- **"Team" scope = everyone below you in the chain** (direct and indirect). Resources for team checks carry `managerChainUserIds` (see `managerChainUserIds()`); without it team access is denied. A manager sees a report's profile in a **limited view**: no birth date, civil status, personal email or home address.
- A person who still has active reports cannot be archived or marked separated; HR reassigns them first (`reassignReports`).
- Positions are a catalog; `employees.position` is the display title kept in sync.
- To roll back a half-finished multi-step action, **throw** `ActionFailure` inside the transaction (returning commits).

## Files, notifications and background jobs

- **Files:** private buckets `employee-docs` and `company-docs` (create them with `pnpm storage:setup`, local or hosted). Upload is three steps: `requestUpload` (validates, server picks the path, returns a one-time token) -> browser uploads straight to storage -> `finalizeUpload` (server reads the file, checks the real type by its bytes, size and SHA-256, then activates it; a failing file is deleted). Never trust the browser's file name or declared type. Downloads are 60-second signed links and every one is audited. Archiving keeps the file until retention periods are approved.
- All storage goes through `DocumentStorage` (`src/modules/documents/storage.ts`); tests use `FakeStorage`. Do not call Supabase Storage from anywhere else.
- **Every exported function in a "use server" file is a public endpoint.** Each must call `requireUser()` first, and helpers that take the acting user as a parameter belong in a separate server-only file (see `service.ts` files). `tests/authz/server-actions-guard.test.ts` enforces this.
- **Notifications:** `notify()` (`src/modules/notifications/service.ts`) writes in-app notifications; links must be relative. The bell in the header reads only the signed-in person's own.
- **Jobs (Inngest):** scheduled functions in `src/inngest/functions.ts` are thin wrappers around plain tested functions (`src/modules/documents/jobs.ts`). Local: `INNGEST_DEV=1` in `.env.local` plus `pnpm dlx inngest-cli@latest dev`. Production: `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`; without a key the endpoint refuses to run. Job dates follow the company time zone (`America/Phoenix`).

## Announcements, policies and email (Phase 1.4)

- `src/modules/announcements/`: announcements (Markdown, audience everyone or teams, recipients frozen at posting), versioned policies (`docs.policy_versions`: a published version is frozen by a database trigger; changes are new versions), and `docs.acknowledgments` (insert-only trigger; one row per person and item/version). For policies the `id` in actions is the policy **version** id.
- Markdown goes through `src/lib/markdown.ts` into React elements, never an HTML string. Do not add `dangerouslySetInnerHTML` for user text.
- The seeded privacy notice and monitoring policy are DRAFT placeholders; publishing refuses text containing "DRAFT PLACEHOLDER". Phase 1.5 and the Jibble mirror gate read them by `kind`.
- **Email:** everything is queued in `ops.email_queue` and sent by the `email-sender` job under a rolling 24-hour budget (`EMAIL_DAILY_BUDGET`, default 90 of Resend's free 100). Acknowledgment emails go first, then the weekday 8:00 AM Manila digest. Bodies carry counts and a link only. With no `RESEND_API_KEY`/`EMAIL_FROM` nothing is sent and the queue waits. Tests use `setEmailSender()`.
- Pass `Date` values to drizzle comparison helpers (`lt`, `gte`), not raw `sql` fragments: raw fragments skip the driver's date encoding.
- Production go-live: Supabase's built-in auth email is heavily rate-limited; configure custom SMTP (Resend can do it) when the Pro project is created.

## Privacy notice and "My data" (Phase 1.5)

- **Gate:** `(app)/layout.tsx` calls `getPrivacyGate()` (`src/modules/privacy/queries.ts`). Until the current published version of the policy with `kind = 'privacy_notice'` is accepted, the layout renders only the acceptance screen. No published notice = no gate; a failure loading it fails open. It is a page-level gate; actions still authorize normally. Acceptance is the same insert-only `docs.acknowledgments` row as any policy (accounts with no people record may accept it too). The privacy notice and monitoring policy always get `requires_ack = true` when published.
- **Publishing the privacy notice is permanent** in a database (versions are frozen), and it stops everyone at the screen. Never publish one against a shared dev database you still use for e2e: `tests/e2e/privacy-gate.spec.ts` runs in its own Playwright project after the others and archives the policy at the end (`update docs.policies set archived_at = now()` switches the gate off). If that test crashes, run that SQL.
- **My data** (`/my-data`): `collectMyData()` in `privacy/service.ts` reads only the signed-in account's own rows, returns sensitive fields as stored masks (never decrypts), and names no other person in the activity list. JSON and PDF (`pdf-lib`, Helvetica, non-Latin text becomes "?") come from `exportMyData`, rate-limited and audited as `mydata.export`.
- **Data rights requests** reuse `core.change_requests` with category `data_rights` (correct, delete, other). HR is notified; approving applies nothing automatically, because deletion is a retention and counsel decision.
- After adding a migration, run `pnpm db:migrate` against the local database before `pnpm test:e2e`: the integration tests build their own database, so they will not reveal a missing local migration.

## Time off: prize days and holidays (Phase 2.1)

- ERS engages 1099 contractors, so there is **no accrual, policy table, carry-over or eligibility rule**. Days off exist only as **prize days** HR awards (`awardDays`, max 5 per award, whole or half days, reason required, optional "use by" date). UI copy says "prize days off", never "PTO" or "paid time off". If ERS ever adds paid leave, add policies and an accrual job on top of the same ledger.
- `time.leave_ledger` (`src/modules/timeoff/`) is append-only (trigger). Entry types: award, usage, reversal, adjustment, expiry, opening_balance; `days` is signed and checked per type. Balance = sum of rows, never stored. Writes for one person take `lockEmployeeLedger()` (advisory lock) so balance checks cannot race. Nobody awards or adjusts their own days (another admin must). Balances never go below zero.
- **Expiry** (`runLeaveExpiry`, daily 1:15 AM Phoenix): writes an `expiry` row (unique per award, so it is idempotent) for what was left unused. What is "left" comes from the pure replay in `ledger.ts`: usage draws from the days that expire soonest first, expired days cannot be drawn, a reversal gives back the most recent draws. Phase 2.2's request flow must write `usage`/`reversal` rows with `effective_on` set to the leave date and use the same lock.
- **Holidays** (`time.holidays`, calendars PH and US, seeded for 2026 and 2027): US federal dates are marked verified; Philippine dates start unverified because each year's list is proclaimed by the government (HR checks them and ticks "verified"). `core.clients.holiday_calendar` picks a client's calendar; a person sees the Philippines plus their current clients' calendars.
- A CHECK constraint passes when it evaluates to NULL: wrap nullable columns in `coalesce` (this bit `leave_ledger_reason_chk`).

## Time off requests and approvals (Phase 2.2)

- `time.leave_requests`: pending_lead -> pending_hr -> approved, or declined / cancelled. The lead step is decided by anyone above the person in the chain (`timeoff.approve` team scope); HR (`timeoff.approve_final`) decides the last step, may only **decline** (not approve) at the lead step, and a lead step that waits 4 working days is escalated to HR by the daily job. A leave type with `skip_hr` finishes at the lead. Nobody decides their own request or one they filed. Nobody above the person = HR decides alone.
- **Days** are working days (Monday to Friday minus PH and client holidays) until schedules exist in 2.5; `workdays.ts` is the one place that rule lives. Requests cannot start in the past (HR files those, `timeoff.file_for_others`), prize-day types need 1 working day's notice, and two live requests for the same person may not overlap (a Postgres exclusion constraint, needs `btree_gist`).
- **Ledger:** approval writes one `usage` row (effective on the first day, tagged with the request id) after `canTake()` passes inside the ledger lock; cancelling approved leave writes a `reversal` dated no earlier than the usage, tagged with the same request id so the replay returns exactly that request's days. Days cannot be used before they were awarded or after they expire.
- **Invites:** approval and cancellation queue an email of kind `invite` with an .ics attachment (`ics.ts`, all-day, title "Day off", no leave type). Email attachments are stored in `ops.email_queue.attachment` and sent through Resend.
- **Calendar** (`getTeamCalendar`): HR sees everyone with leave types and pending requests; a Team Lead their downline; an Executive only counts per day; everyone else their teammates by name (approved only, leave type hidden except their own).
- E2E tip: in the dev server a page can load before React hydrates, and text typed into a controlled field before then is lost. Use `waitForHydration(page, selector)` from `tests/e2e/helpers.ts` before filling forms.

## The time clock (Phase 2.3)

- `time.clock_events` (`src/modules/attendance/`) is append-only (trigger). Web events get the **database clock** (`clock_timestamp()`) and the IP from `x-forwarded-for`; nothing the browser sends can change either. `performClock()` (service.ts) does everything inside `lockEmployeeClock()`: state machine from `clock.ts` (out -> working <-> break -> out; a clock-out on a break writes `break_end` first), no clock-in on approved full-day leave, IP range flag, location, selfie.
- **Breaks are unpaid** (deducted from worked time). The **calendar day** of a session is the day it STARTED in the person's own zone (`time.clock_prefs.time_zone`, default company zone), so a night shift is one day. `attendance_days` is rebuilt nightly from events (`rebuildAttendanceDays`), never hand-edited; the My time page computes live from events.
- **Allowed IP ranges are per team** (`time.clock_rules`): outside = flagged for the lead, never blocked; no row = no restriction. IPv4 and CIDR only.
- **Location and selfie are monitoring**: both work only while a policy with `kind = 'monitoring'` is published (`monitoringPolicyPublished()`), location also needs the person's opt-in (stored rounded to 2 decimals, about 1 km), selfie needs the team rule. Selfies live in `employee-docs/selfies/<employeeId>/`, are checked by their bytes (JPEG, 1.5 MB), and are deleted after 30 days (`purgeSelfies`); the row stays.
- **Idle prompt** only flags (`time.idle_prompts`), it never clocks anyone out. **Missed clock-out**: a session open over 12 hours notifies the person and their lead once (schedule-based grace comes with Phase 2.5).
- **Corrections** are requests (`time.clock_corrections`) approved by the lead (HR for anyone); approval writes NEW `admin_correction` rows and re-checks that the proposed events fit and break nothing that was valid. Nobody decides their own.
- `afterClockEvent()` in service.ts is the empty hook where Phase 2.4 mirrors clock-in and clock-out to Jibble.
- Tests that need a published monitoring policy use `withMonitoring()` in `tests/integration/attendance.test.ts` (adds a published version, then archives the policy), so the seeded placeholder (version 1) stays intact for the announcements tests.

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
- **Files:** private buckets only; signed URLs expire in 60 seconds; allowlist PDF, JPG, PNG, DOCX up to 10 MB; check MIME type server-side.
- **Rate limit** login, careers apply, and Safe Voice endpoints with Upstash.
- **Safe Voice** is anonymous: it runs on its own subdomain/app, never reads auth cookies or sessions, never stores user ID, IP, user agent or file metadata. Reporters get a random case code + passphrase (hashed with a pepper). Only designated handlers can read cases.
- **No patient data (HIPAA):** no module may have fields for client patient information. Upload screens show a warning not to upload client records.
- **Real data only in production.** Seeds and tests use fake data (Filipino and US names, fake IDs).

## Conventions

- File names kebab-case; React components PascalCase; server actions verb-first (`approveLeaveRequest`).
- Return `{ ok: true, data } | { ok: false, error }` from actions; show errors with toasts; never leak stack traces.
- UI copy: plain, short, sentence case. Brand: ERS colors via Tailwind theme tokens in `globals.css`.
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
