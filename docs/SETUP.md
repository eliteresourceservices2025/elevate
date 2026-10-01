# ELEVATE — Development Environment Setup

ELITE Employee & VA Engagement / Talent Experience. Internal HRIS for Elite Resource Services.
Companion to the "ELEVATE — HRIS Architecture Plan" doc. Follow the steps in order; each ends with a check.

---

## 0. Accounts to create (all under an ERS-owned email, not a personal one)

| Service | Plan | Used for |
| --- | --- | --- |
| GitHub | Free (private repo) | Code, Actions CI, Dependabot |
| Vercel | Pro ($20/mo) | Hosting (Hobby forbids commercial use) |
| Supabase | Pro ($25/mo) for production, Free for staging | Postgres, Auth, Storage |
| Resend | Free | Transactional email |
| Inngest | Free | Background jobs |
| Upstash | Free | Redis for rate limiting |
| Sentry | Free | Error monitoring |
| Google Cloud | Free | OAuth client for "Sign in with Google" + Calendar API |
| Jibble | Free (existing) | Generate an API token to confirm Free-plan API access |

Turn on 2-step verification for every one of these accounts. Store all secrets in a password manager, never in chat or the repo.

**Check:** you can log in to each and 2FA is on.

---

## 1. Local machine

| Tool | Version | Install |
| --- | --- | --- |
| Node.js | 24 LTS | `nvm install 24 && nvm use 24` (or fnm) |
| pnpm | 10+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| Docker Desktop | current | Needed by the Supabase CLI for the local database |
| Supabase CLI | current | `brew install supabase/tap/supabase` or `pnpm dlx supabase` |
| Vercel CLI | current | `pnpm add -g vercel` |
| Git + GitHub CLI | current | `gh auth login` |
| Claude Code | current | Your build assistant |

Editor: VS Code or Cursor with ESLint, Prettier, Tailwind CSS IntelliSense, and Drizzle extensions.

**Check:** `node -v` shows v24, `pnpm -v`, `docker ps`, `supabase -v` all work.

---

## 2. Create the repository

```bash
pnpm create next-app@latest elevate --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack
cd elevate
git init && gh repo create ers/elevate --private --source=. --push   # use the ERS org/account
```

Install the core dependencies:

```bash
# UI
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button input label form select textarea dialog sheet tabs table \
  dropdown-menu badge card avatar calendar popover toast sonner chart command separator skeleton
pnpm add lucide-react @tanstack/react-table @tanstack/react-query nuqs @xyflow/react d3-hierarchy \
  @dnd-kit/core @dnd-kit/sortable date-fns date-fns-tz qrcode.react react-signature-canvas

# Forms and validation
pnpm add react-hook-form zod @hookform/resolvers

# Data and auth
pnpm add drizzle-orm postgres @supabase/supabase-js @supabase/ssr
pnpm add -D drizzle-kit

# Jobs, email, PDFs, rate limits, monitoring
pnpm add inngest resend @react-email/components pdf-lib @react-pdf/renderer \
  @upstash/ratelimit @upstash/redis @sentry/nextjs

# Testing and quality
pnpm add -D vitest @vitest/coverage-v8 @playwright/test @testing-library/react prettier \
  prettier-plugin-tailwindcss eslint-plugin-security tsx
```

Copy `CLAUDE.md` and `.env.example` from this kit into the repo root, then `cp .env.example .env.local`. Export the "ELEVATE — HRIS Architecture Plan" doc as Markdown and save it as `docs/architecture-plan.md`; `CLAUDE.md` and the build prompts point Claude Code to it.

**Check:** `pnpm dev` serves the starter page at http://localhost:3000.

---

## 3. Folder structure

```
elevate/
├─ CLAUDE.md                     # rules for Claude Code (from this kit)
├─ drizzle/                      # generated SQL migrations (committed)
├─ supabase/                     # supabase CLI config, seed.sql (fake data only)
├─ docs/                         # architecture plan export, runbooks, ADRs
├─ tests/
│  ├─ authz/                     # one permission test file per module
│  └─ e2e/                       # Playwright flows
└─ src/
   ├─ app/
   │  ├─ (auth)/login, mfa/      # sign-in, MFA enroll + challenge
   │  ├─ (app)/                  # authenticated shell (AAL2 required)
   │  │  ├─ dashboard/  people/  org-chart/  documents/  announcements/
   │  │  ├─ time-off/  attendance/  schedules/
   │  │  ├─ recruiting/  onboarding/  offboarding/  signing/
   │  │  ├─ reviews/  assets/  analytics/  safe-voice-cases/
   │  │  └─ settings/            # roles, policies, templates, audit log
   │  ├─ careers/                # public job board + apply form
   │  ├─ api/inngest/route.ts    # Inngest endpoint
   │  └─ api/cron/*/route.ts     # Vercel Cron endpoints (secret-protected)
   ├─ proxy.ts                   # session refresh + AAL2 gate (Next 16 "proxy", formerly middleware.ts)
   ├─ modules/                   # one folder per module
   │  └─ <module>/
   │     ├─ schema.ts            # Drizzle tables for this module
   │     ├─ actions.ts           # "use server" mutations, each calls authorize()
   │     ├─ queries.ts           # server-only reads, each calls authorize()
   │     ├─ validators.ts        # Zod schemas shared by form + action
   │     ├─ permissions.ts       # this module's actions and scopes
   │     └─ components/
   ├─ lib/
   │  ├─ db.ts                   # Drizzle client (server-only)
   │  ├─ supabase/               # server + browser clients (auth only)
   │  ├─ auth.ts                 # getCurrentUser(), requireAal2()
   │  ├─ authz.ts                # authorize(user, action, resource)
   │  ├─ crypto.ts               # AES-256-GCM field encryption, versioned keys
   │  ├─ audit.ts                # writeAudit()
   │  ├─ storage.ts              # signed upload/download URLs
   │  ├─ email.ts  rate-limit.ts  inngest.ts
   └─ components/ui/             # shadcn components
```

Safe Voice is a **separate small app on its own subdomain** (e.g. `voice.<domain>`) or a separate Vercel project, so the browser never sends ELEVATE's login cookies with a report. It writes only to the `ops.safevoice_*` tables through a dedicated database role.

---

## 4. Supabase

### Local

```bash
supabase init
supabase start          # prints local API URL, keys and DB URL -> put them in .env.local
```

### Production project

1. Create the project in the **Singapore (ap-southeast-1)** region on the Pro plan. Save the database password in the password manager.
2. **Auth → Providers:** enable Email (confirm email ON, minimum password length 12, leaked-password protection ON) and Google (paste the Google OAuth client ID and secret from step 6).
3. **Auth → Multi-Factor:** enable TOTP (authenticator app). The app enforces AAL2 on every page.
4. **Auth → URL configuration:** site URL = production URL; add `http://localhost:3000` and the Vercel preview pattern to redirect URLs.
5. **Auth → Sessions:** inactivity timeout 8 hours.
6. **Storage:** create private buckets `employee-docs`, `company-docs`, `signed-docs`, `careers-uploads`, `avatars`. None public.
7. **API settings:** do NOT expose app schemas (`core`, `docs`, `time`, `talent`, `ops`) to the Data API. The app reads data only through Drizzle on the server.
8. **Database → Backups:** confirm daily backups are on.

### Staging project

A second project on the **Free** plan, same settings, used by Vercel preview deployments. Fake seed data only.

**Check:** `supabase status` works locally; you can sign up a test user in the production dashboard and delete it.

---

## 5. Drizzle ORM

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/modules/*/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT! },
  schemaFilter: ["core", "docs", "time", "talent", "ops"],
  strict: true,
});
```

`src/lib/db.ts` connects through the Supabase **transaction pooler (port 6543)** with `prepare: false`, and imports `server-only` so it can never be bundled for the browser.

Scripts in `package.json`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio",
"db:seed": "tsx scripts/seed.ts"
```

Every migration also runs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for each new table (no policies = deny for the public key).

**Check:** `pnpm db:generate && pnpm db:migrate` creates the tables in the local database.

---

## 6. Google Cloud (sign-in + Calendar)

1. Create a project "ELEVATE" in Google Cloud Console.
2. OAuth consent screen: External (ERS uses personal Gmail today), app name ELEVATE, scopes `openid email profile`; add test users while in testing mode, then publish.
3. Credentials → OAuth client (Web): authorized redirect URI = `https://<supabase-project>.supabase.co/auth/v1/callback`.
4. Enable the Google Calendar API. Calendar access is requested separately, only from HR and recruiters, with scope `https://www.googleapis.com/auth/calendar.events`.

**Check:** "Sign in with Google" works on localhost.

---

## 7. Other services

- **Resend:** add and verify a sending subdomain (e.g. `mail.<ERS domain>`) with the SPF/DKIM records it gives; create an API key restricted to sending.
- **Inngest:** create an app, copy the event key and signing key; locally run `pnpm dlx inngest-cli@latest dev`.
- **Upstash:** create a Redis database in the Singapore region; copy the REST URL and token.
- **Sentry:** create a Next.js project; run `pnpm dlx @sentry/wizard@latest -i nextjs`; set `sendDefaultPii: false` and scrub request bodies.
- **Jibble:** the free plan does not offer a Client ID and Secret, but it offers a **personal access token** (see docs.api.jibble.io; generate it from your Jibble account). Put it in `apps/elevate/.env.jibble.local` as `JIBBLE_ACCESS_TOKEN=...` for tests (that file is git-ignored) and in the host's environment settings for production. Make the token from an account that will stay (it acts as that person; if they leave or the token expires, ELEVATE tells HR that Jibble is refusing it). **Safety lock:** ELEVATE sends clock calls to Jibble only when the deployment has `ELEVATE_ENV=production`; set that on the production host and nowhere else. On a laptop or staging, only the Jibble person ids in `JIBBLE_TEST_PERSON_IDS` (test people only) are sent, so a copy of the app can never clock real people in or out. Then run `pnpm jibble:probe test.person@example.com --clock` with a TEST person to see whether an API clock-in starts screenshots in the Jibble desktop app (Jibble is kept for screenshots only; ELEVATE is the time clock).

---

## 8. Encryption key

Generate a 32-byte key for field encryption (government IDs, payout details, pay rates):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store it as `FIELD_ENCRYPTION_KEYS` in the format `v1:<base64>`. To rotate, add `v2:<base64>` in front (`v2:...,v1:...`); new writes use the first key and a background job re-encrypts old rows. Keep a copy in the password manager: losing it makes those fields unreadable.

---

## 9. Vercel

```bash
vercel link
vercel env add   # add each variable from .env.example for Production and Preview
```

- Production env vars point to the Supabase **Pro** project; Preview vars point to **staging**.
- Mark every secret as "Sensitive".
- Settings → Deployment Protection: enable Vercel Authentication for **preview** deployments.
- Settings → Firewall: enable the attack-challenge mode toggle if login abuse appears; add a rate-limit rule on `/login`.
- `apps/elevate/vercel.json` already has the backstop cron (`/api/cron/backstop`, every 15 minutes). Set `CRON_SECRET` (at least 16 random characters) in the project's environment variables: Vercel then sends it with each call, and without it the route refuses everyone. The route runs the health check, sends waiting Jibble calls, repairs Jibble and sends missed clock-out notices when the job service (Inngest) is down. See `docs/RUNBOOK.md`.

**Check:** a push to a branch produces a preview URL behind Vercel login.

---

## 10. GitHub Actions and repo protection

- `.github/workflows/ci.yml` on every push/PR: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest, includes `tests/authz`), `pnpm db:generate --check` equivalent (fail if schema and migrations differ), Playwright smoke tests against the preview.
- `.github/workflows/migrate.yml` on push to `main`: runs `pnpm db:migrate` against production using a GitHub **environment** "production" that requires your manual approval.
- `.github/workflows/backup.yml` weekly: `pg_dump` of production, encrypted with `age` to a public key, uploaded to separate storage.
- Branch protection on `main`: PR required, CI must pass. Enable Dependabot and secret scanning.

---

## 11. First run checklist

- [ ] `pnpm dev` runs with Supabase local, Inngest dev server and seed data
- [ ] Sign up → forced MFA enrollment → dashboard loads only at AAL2
- [ ] An Employee test user gets "forbidden" on another person's profile (authz test passes)
- [ ] CI green on a pull request; preview deploy works
- [ ] Production and staging env vars set in Vercel; no real data anywhere but production

Then start **Phase 0** in `BUILD-PROMPTS.md`.

---

## 12. Auth setup notes (added in Phase 0.2)

- **Invite-only sign-up** is enforced in the database by `private.before_user_created` (migration `0001_auth_invite_only_hook.sql`). On every new Supabase project: run `pnpm db:migrate`, then in Dashboard > Auth > Hooks enable **Before User Created** and point it at `private.before_user_created`. Until then sign-ups are refused.
- **Bootstrap the first Super Admin:** set `SUPER_ADMIN_EMAILS` in `.env.local` and run `pnpm --filter elevate db:bootstrap`. It creates invitations only; the Super Admin role is assigned in Phase 0.3.
- **Email templates:** paste `supabase/templates/confirmation.html` and `recovery.html` into Dashboard > Auth > Email Templates (Confirm signup, Reset password). Their links must go to `{{ .SiteURL }}/auth/confirm?...` so the server sets the session.
- **URL configuration:** Site URL = the production URL. Redirect URLs must include `/auth/callback` and `/auth/confirm` for production, localhost and the Vercel preview pattern.
- **Local mail:** `supabase start` runs Mailpit at http://127.0.0.1:54324; all auth emails land there.
- **Lost authenticator:** Supabase has no recovery codes. A Super Admin removes the factor through the Auth admin API (a Settings action is planned in Phase 0.3); the person then enrolls again.

---

## 13. Document storage and background jobs (added in Phase 1.3)

- **Buckets:** after `pnpm db:migrate`, run `pnpm --filter elevate storage:setup` against each environment (local, staging, production). It creates `employee-docs`, `company-docs` and `recruiting-docs` (applicant resumes) and `signed-docs` (ELEVATE Sign originals and sealed copies) as private buckets limited to 10 MB and PDF/JPG/PNG/DOCX, and corrects them if they drift. Never make them public.
- **Inngest (expiry reminders, cleanup of unfinished uploads):** create the free Inngest app, then add `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to the Vercel environment and register `https://<your-domain>/api/inngest` in the Inngest dashboard. Leave `INNGEST_DEV` unset in production.
- **Local:** set `INNGEST_DEV=1` in `.env.local` and run `pnpm dlx inngest-cli@latest dev` to see and trigger the jobs at http://localhost:8288.
- **Not included:** virus scanning. Files are restricted to four types, checked by their bytes, stored privately and only ever served as downloads. Add a scanner later if ERS wants one.
