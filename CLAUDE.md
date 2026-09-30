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
