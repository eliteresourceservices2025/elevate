# Deploying ELEVATE and Safe Voice (first go-live walkthrough)

One GitHub repository, **two Vercel projects**: ELEVATE (`apps/elevate`) and Safe Voice (`apps/safe-voice`), one Supabase project, and a few small services. Follow the parts in order. Nothing here needs real people's data until Part 8.

**Free tiers.** This walkthrough works on Vercel Hobby and Supabase Free for a demo to the team. Know the limits (Part 9) and upgrade both to Pro **before any real data goes in**.

## Part 0. Decide first

- **Addresses.** Vercel gives free addresses like `elevate-xyz.vercel.app`; that is fine for the demo. For real use, pick a domain and two subdomains (for example `elevate.<domain>` and `voice.<domain>`). A domain is also needed to send email (Part 3).
- **Passwords and keys** go in the password manager, never in chat, git or screenshots.
- **Never put real people's data into anything but the production project.** Use the demo with fake or test accounts only.

## Part 1. Supabase (the production project)

1. supabase.com > New project. Region **Singapore**. Save the database password.
2. **Project Settings > API:** copy the project URL, the publishable (anon) key and the secret (service role) key.
3. **Project Settings > Database > Connection string:** copy two strings (replace the password):
   - the **transaction pooler** (port 6543): this is `DATABASE_URL` for the app;
   - the **session pooler** (port 5432): this is `DATABASE_URL_DIRECT` for migrations. (The plain "direct" host is IPv6 only; the session pooler works from any network.)
4. **Authentication:**
   - Providers: Email on (confirm email on, minimum password length 12) and Google (Part 3).
   - Multi-factor: TOTP on.
   - URL configuration: **Site URL** = the ELEVATE address; Redirect URLs: `<elevate address>/auth/callback` and `<elevate address>/auth/confirm`.
   - Email templates: paste `supabase/templates/confirmation.html` (Confirm signup) and `recovery.html` (Reset password).
   - **SMTP:** Supabase's built-in email sends only a few messages an hour. Set custom SMTP to Resend (Part 3) before inviting more than a couple of people.
5. **Run the migrations** from your computer. In PowerShell, in the repository folder, set the connection in this window only (it overrides `.env.local`, which stays untouched), then run:

   ```powershell
   $env:DATABASE_URL_DIRECT = "<the session pooler string>"
   pnpm db:migrate
   ```

   It should end with "migrations applied successfully". Close the window afterwards.
6. **Turn on the sign-up guard.** Authentication > Hooks > **Before User Created** > choose the function `private.before_user_created`. Until this is on, nobody can sign up.
7. **Create the storage buckets** (same window, with the production URL and secret key):

   ```powershell
   $env:NEXT_PUBLIC_SUPABASE_URL = "<project url>"
   $env:SUPABASE_SECRET_KEY = "<secret key>"
   pnpm storage:setup
   ```
8. **Data API:** make sure the app schemas (`core`, `docs`, `time`, `talent`, `ops`) are **not** exposed in Settings > API.
9. **Safe Voice database roles.** In the SQL editor run (two different long random passwords, saved in the password manager):

   ```sql
   ALTER ROLE safevoice_app LOGIN PASSWORD '<long random password 1>';
   ALTER ROLE safevoice_handler LOGIN PASSWORD '<long random password 2>';
   ```

   Build their connection strings from the transaction pooler string, replacing the user name with `safevoice_app.<project-ref>` and `safevoice_handler.<project-ref>` and the password with the matching one.
10. **First Super Admin.** In PowerShell set `$env:SUPER_ADMIN_EMAILS = "you@yourcompany.com"` (plus the database string from step 5) and run `pnpm db:bootstrap`. This creates invitations only. You sign up with that email after deploying (Part 6). The value may hold several emails separated by commas, but **only the first of them to sign up becomes Super Admin** (the app promotes one while no Super Admin exists); the others sign up as ordinary Employees and the Super Admin gives them roles in Settings.

**Do not run `pnpm db:seed` against this project.** It refuses remote databases on purpose.

## Part 2. Generate the secrets

Make these once and store every copy in the password manager. **Losing the encryption key or the pepper cannot be undone.**

```powershell
node -e "console.log('v1:' + require('crypto').randomBytes(32).toString('base64'))"   # FIELD_ENCRYPTION_KEYS (a NEW key, not the one from your laptop)
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"           # SAFEVOICE_PEPPER (never change it later)
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"              # CRON_SECRET
```

## Part 3. Other services

- **Upstash** (upstash.com): create a Redis database in Singapore; copy the REST URL and token. Create a **second** database for Safe Voice if you can (so its rate limits are separate).
- **Inngest** (inngest.com): create an app; copy the **event key** and **signing key**. After the first deploy, register `https://<elevate address>/api/inngest` in the Inngest dashboard (Part 6).
- **Resend** (resend.com): add and verify a sending domain (it gives you DNS records). Create a sending-only API key. Without a verified domain it can only email yourself. Use the same Resend account's SMTP details in Supabase (Part 1, step 4).
- **Google sign-in** (console.cloud.google.com): an OAuth client of type Web with the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`; paste its client ID and secret into Supabase > Authentication > Providers > Google. (Calendar for interviews uses a second client, `docs/SETUP.md` 6b: optional for the demo.)
- **Sentry**: optional for the demo. Do not turn on anything that sends personal data.

## Part 4. Vercel project 1: ELEVATE

1. vercel.com > Add New > Project > import the GitHub repository.
2. **Root Directory:** `apps/elevate`. Framework: Next.js. Leave "Include files outside the Root Directory" **on**. **Node.js Version: 24.x** (Settings > General).
3. **Environment variables** (Production). Mark secrets Sensitive:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | the ELEVATE address (with https) |
   | `NEXT_PUBLIC_APP_NAME` | ELEVATE |
   | `NEXT_PUBLIC_SUPABASE_URL` | project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key |
   | `SUPABASE_SECRET_KEY` | secret key |
   | `DATABASE_URL` | transaction pooler string (port 6543) |
   | `FIELD_ENCRYPTION_KEYS` | the new `v1:...` key |
   | `ELEVATE_ENV` | `production` (Production only, never Preview) |
   | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | from Resend; a monitored address, not no-reply |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | from Inngest (leave `INNGEST_DEV` empty) |
   | `CRON_SECRET` | the random value |
   | `SUPER_ADMIN_EMAILS` | the email(s) you invited in Part 1, step 10 (the app checks this at first sign-in; without it nobody becomes Super Admin) |
   | `SAFEVOICE_HANDLER_DATABASE_URL` | the `safevoice_handler` string |
   | `NEXT_PUBLIC_SAFEVOICE_URL` | the Safe Voice address (set after Part 5, then redeploy) |

   Not needed on Vercel: `DATABASE_URL_DIRECT`, any `JIBBLE_*` (add `JIBBLE_ACCESS_TOKEN` only when a team is ready for it), `GOOGLE_*` (only for interview calendars), `TALENTHR_API_KEY` (used from your own computer, Part 8).
4. Settings > Deployment Protection: keep Vercel Authentication on for **Preview** deployments.
5. Deploy.

**Cron on the free plan.** Vercel Hobby allows a scheduled call only once a day, so `apps/elevate/vercel.json` runs the backstop once daily. The jobs themselves run on Inngest. On Pro, change the schedule back to `*/15 * * * *` (every 15 minutes).

## Part 5. Vercel project 2: Safe Voice

1. Add New > Project > import the **same** repository again.
2. **Root Directory:** `apps/safe-voice`. Node 24.x.
3. Environment variables (Production), all Sensitive:
   - `SAFEVOICE_DATABASE_URL`: the `safevoice_app` string;
   - `SAFEVOICE_PEPPER`: the pepper (never change it);
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: without these, production refuses every request on purpose.
   It needs nothing else, and none of ELEVATE's secrets.
4. **Privacy settings (cannot be set from code):** in this project add no Web Analytics, no Speed Insights, no log drains and no Sentry; set log retention to the shortest available. See `docs/SETUP.md` 14b.
5. Deploy. Copy its address into ELEVATE's `NEXT_PUBLIC_SAFEVOICE_URL` and redeploy ELEVATE.
6. Optional: Settings > Git > **Ignored Build Step** on each project so a change to one app does not rebuild the other.

## Part 6. First sign-in and checks

1. In Inngest register `https://<elevate address>/api/inngest`.
2. Open ELEVATE, **Sign up with the email you put in `SUPER_ADMIN_EMAILS`**, set up your authenticator. You land on the dashboard as Super Admin.
3. Settings > Roles and access: tick **Safe Voice handler** for at least two people.
4. Open the Safe Voice address, send a test report, then open it in ELEVATE under Safe Voice cases.
5. Settings > **Go-live checklist**: work through it. Settings checks describe the deployment you are looking at.
6. Test invitations: Settings > Invitations to a test email; confirm the email arrives (needs Part 3 SMTP) and the sign-up works.

## Part 7. Before anyone else uses it

- **Privacy notice and monitoring policy:** the seeded ones are draft placeholders and cannot be published. HR writes the real text (counsel to read it) and publishes. **Publishing the privacy notice stops everyone at an acceptance screen**, so do it when you are ready.
- **Backups:** the free Supabase plan has no automatic backups and pauses a project after a week of no use. Upgrade to **Pro** first, then do a restore test.
- Switch Vercel to Pro for company use (Hobby is for personal, non-commercial projects and has one seat).
- Custom domain on both projects, then update Supabase's Site URL and redirect URLs, ELEVATE's `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SAFEVOICE_URL`.

## Part 8. Moving real data (only after Part 7)

Follow `docs/SETUP.md` section 15 and the go-live checklist: import people (Settings > Import), pull documents with `pnpm talenthr:pull` (set `ELEVATE_ENV=production` and the production connection in your PowerShell window the same way as Part 1), reconcile, sign off, then send invitations in waves.

## Part 9. Free-tier limits to know

- **Supabase Free:** no automatic backups, pauses after about a week of inactivity, small database and storage, strict limits on built-in auth email, some security options (such as leaked-password protection) are Pro only.
- **Vercel Hobby:** personal non-commercial use, one seat, daily cron only, shorter function time limits (large imports or PDF work may time out).
- **Resend Free:** about 100 emails a day and one domain.
- **Inngest and Upstash free tiers** are enough for a demo and a pilot.

## If something goes wrong

- Build fails on Vercel: check the Root Directory and the Node version first.
- "Sign-ups are refused": the Before User Created hook is not on (Part 1, step 6).
- "Safe Voice cases: not connected": `SAFEVOICE_HANDLER_DATABASE_URL` is missing or wrong.
- Reports are refused (429) on Safe Voice: the Upstash variables are missing.
- No emails: custom SMTP or the Resend domain is not verified yet.
- Anything about outages and recovery: `docs/RUNBOOK.md`.
