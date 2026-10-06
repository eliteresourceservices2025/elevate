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

Safe Voice is a **separate small app on its own subdomain** (e.g. `voice.<domain>`) or a separate Vercel project, so the browser never sends ELEVATE's login cookies with a report. It writes only to the `ops.safevoice_*` tables through a dedicated database role. Setup is in section 14.

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

There are two separate Google "OAuth clients": one for **sign-in** (used by Supabase, steps 1 to 4 below) and one for **interview calendars** (used by ELEVATE itself, section 6b).

1. Create a project "ELEVATE" in Google Cloud Console.
2. OAuth consent screen: External (ERS uses personal Gmail today), app name ELEVATE, scopes `openid email profile`; add test users while in testing mode, then publish.
3. Credentials → OAuth client (Web): authorized redirect URI = `https://<supabase-project>.supabase.co/auth/v1/callback`.
4. Enable the Google Calendar API. Calendar access is requested separately, only from HR and recruiters, with scope `https://www.googleapis.com/auth/calendar.events`.

**Check:** "Sign in with Google" works on localhost.

### 6b. Google Calendar for interviews (Phase 3.1b)

Without this, ELEVATE sends interview invites as calendar files by email (it works). With it, HR and recruiters can connect their own Google Calendar so each interview is created there with a Google Meet link and Google sends the invites.

1. In the same Google Cloud project, open **APIs & Services > Library**, search for **Google Calendar API** and click **Enable**.
2. Open **Google Auth Platform** (older screens: APIs & Services > OAuth consent screen) and set the app up:
   - **Audience / user type:** **Internal** if ERS uses Google Workspace (no review needed, tokens do not expire). Otherwise **External**.
   - App name ELEVATE, a support email, and a developer contact email.
   - **Data access (scopes):** click Add or remove scopes and add **calendar.events** (Google describes it as "View and edit events on all your calendars"; do not pick the broader plain "calendar" scope), plus `openid` and `.../auth/userinfo.email`.
   - For External: while the app is in **Testing**, add each recruiter and HR person's Google address as a **Test user**. **Testing mode connections stop working after 7 days**, so people must reconnect weekly. To avoid that, click **Publish app** and complete Google's short verification for the sensitive Calendar scope (a privacy policy page, a demo video and a short explanation), or move ERS to Google Workspace and use Internal.
3. **Credentials > Create credentials > OAuth client ID > Web application**, name it "ELEVATE Calendar":
   - **Authorized redirect URIs:** `http://localhost:3000/api/google/callback` for local development, and `https://<your ELEVATE address>/api/google/callback` for production. They must match exactly (no trailing slash).
4. Copy the **Client ID** and **Client secret** into `apps/elevate/.env.local` (local) or the host's environment (production), never into chat or the repo:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   NEXT_PUBLIC_APP_URL=http://localhost:3000   # the address people use; the redirect address is built from it
   ```
   Restart the app.
5. **Check:** sign in as an HR or recruiter account, open **Recruiting**, find the **Google Calendar** card, click **Connect Google Calendar**, approve on Google's screen and you come back to Recruiting saying it is connected. Schedule an interview on a test applicant: it appears on that Google Calendar with a Meet link.
6. If Google shows "access blocked" or "app not verified": the person is not a Test user yet (External, Testing), or the redirect address does not match step 3.

Disconnecting in ELEVATE revokes the permission at Google. Anyone can also remove it at https://myaccount.google.com/permissions.

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

> The step-by-step first deployment (two Vercel projects, Supabase, Upstash, Inngest, Resend) is in `docs/DEPLOY.md`. The cron in `apps/elevate/vercel.json` is every 15 minutes (Vercel Pro); the free Hobby plan only accepts a daily one.

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

---

## 15. Moving from TalentHR (added in Phase 5)

1. **Import people** (Settings > Import from TalentHR) on the **production** system only, never on a laptop or test copy: upload the CSV, check the column choices and date format, read the preview, commit, then read the reconciliation. Repeat until it is clean (a second dry run matches people by work email).
2. **Pull documents** with `pnpm talenthr:pull` (RUNBOOK 5b8). The TalentHR API key goes in the git-ignored `apps/elevate/.env.talenthr.local`.
3. **Sign off** the reconciliation, then work through Settings > Go-live checklist. TalentHR stays active for a two-week parallel run.
4. Send invitations in waves, pilot team first.

## 14. Safe Voice (added in Phase 4.2)

Safe Voice is its own small app (`apps/safe-voice`) deployed as **its own Vercel project on its own subdomain** (for example `voice.<ERS domain>`), so the browser never sends ELEVATE's login cookies with a report. It has no Supabase keys, no sign-in and none of ELEVATE's secrets: it can only reach three tables through a dedicated database role.

### 14a. Database roles (once per Supabase project)

Migration 0037 creates the tables and two **login-less** roles with exactly the access they need and row-level security policies for those roles only:

- `safevoice_app`: used by the Safe Voice app. May add reports, messages and attachments and read back only what a reporter is shown. It cannot update or delete anything and cannot read report text or attachment bytes.
- `safevoice_handler`: used by ELEVATE for designated handlers. May read cases (never the code or passphrase hashes), add handler messages, change a case's status and outcome. Nothing else.

Give each a password **in the Supabase SQL editor** (never in git, chat or a migration):

```sql
ALTER ROLE safevoice_app LOGIN PASSWORD '<long random password>';
ALTER ROLE safevoice_handler LOGIN PASSWORD '<another long random password>';
```

Save both in the password manager. Connection strings use the pooler (port 6543); on the pooler the user name carries the project reference, for example `safevoice_app.<project-ref>`.

### 14b. The Safe Voice project

1. In Vercel create a **second project** from the same repository with **Root Directory = `apps/safe-voice`**. Give it the subdomain. It does not need the ELEVATE environment variables.
2. Environment variables (Production; mark as Sensitive):
   - `SAFEVOICE_DATABASE_URL`: the `safevoice_app` connection string.
   - `SAFEVOICE_PEPPER`: at least 32 random characters (`openssl rand -base64 48`). **Never change it**: it keys the hashes of every case code and passphrase, so changing it locks every reporter out. Keep two copies in the password manager.
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: its own Upstash database is best (separate from ELEVATE's). Without Upstash, production refuses every request (fail closed).
3. **Logging (cannot be set from code).** In the Safe Voice project's settings: do not add any log drain or analytics (no Web Analytics, no Speed Insights, no Sentry), set runtime log retention to the shortest available, and keep the Firewall's own logging for this project to what the plan allows. The app never logs an address, header, cookie or body, and the platform's request logs are the one thing outside its control: tell the owner what the plan records.
4. Do **not** put the Safe Voice subdomain under a wildcard cookie domain of the ELEVATE site, and do not link to it from ELEVATE pages with a tracking parameter.

### 14c. ELEVATE side

- Add `NEXT_PUBLIC_SAFEVOICE_URL` (the public address of the Safe Voice site, for example `https://voice.<ERS domain>`) to the **ELEVATE** project so everyone gets the "Report a concern" link in the menu. It is a public value, not a secret; with none set the link is hidden in production.
- Add `SAFEVOICE_HANDLER_DATABASE_URL` (the `safevoice_handler` connection string) to the **ELEVATE** project's environment variables. Without it the Safe Voice cases page says "not connected" and, in production, the `safevoice-notify` job shows as failing in Attendance > Health.
- **Designate handlers** (Super Admin only): Settings > Roles and access, tick "Safe Voice handler" on a person (audited). No role grants case access, a Super Admin included; name at least two people so one absence does not leave reports unread. If nobody is designated while reports wait, the Super Admins get one in-app warning a day.
- Run `pnpm db:migrate` against each environment (it creates the roles and tables).

### 14d. Local development

```bash
supabase start
pnpm db:migrate
# give the roles a local password (SQL editor at http://127.0.0.1:54323 or psql):
#   ALTER ROLE safevoice_app LOGIN PASSWORD 'local-only-password';
#   ALTER ROLE safevoice_handler LOGIN PASSWORD 'local-only-password';
```

Then create `apps/safe-voice/.env.local` (git-ignored; see `apps/safe-voice/.env.example`) with `SAFEVOICE_DATABASE_URL=postgresql://safevoice_app:local-only-password@127.0.0.1:54322/postgres`, a throwaway `SAFEVOICE_PEPPER`, and add `SAFEVOICE_HANDLER_DATABASE_URL=postgresql://safevoice_handler:local-only-password@127.0.0.1:54322/postgres` to `apps/elevate/.env.local`. Run `pnpm --filter safe-voice dev` (port 3100). The integration tests make their own roles' passwords in the throwaway `elevate_test` database.

**Check:** send a test report at `http://localhost:3100`, write down the code and passphrase, open it under "Check a case", then open ELEVATE as a designated handler and find it under Safe Voice cases.
