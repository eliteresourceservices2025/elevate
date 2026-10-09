# Production checklist (Supabase Pro and Vercel Pro)

Work top to bottom. Each item says **what**, **where**, and **how you know it is done**. Tick it in this file as you go (or print it). The first deployment steps are in `docs/DEPLOY.md`; outages are in `docs/RUNBOOK.md`. The app also has a live checklist at **Settings > Go-live checklist** that checks the settings by name.

Rules that never change: keys and passwords only in a password manager and in Vercel (never in chat, email or git); real people's data only in the production project; do not run `pnpm db:seed` against production.

---

## 1. Today: the code on GitHub is current

- [ ] **Push everything** from the computer that has the latest work: `git push origin main`.
- [ ] **CI is green** (GitHub > Actions). It was red only because five hours tests failed on Mondays; that fix is now on `main`.
- [ ] **Apply the newest migration to Supabase** *before* the new code runs (PowerShell, session pooler string, as in DEPLOY Part 1 step 5): `pnpm db:migrate`. Check in the SQL editor: `select count(*) from drizzle.__drizzle_migrations;` returns **45** (migrations 0000 to 0044). Do this every time a new file appears in `apps/elevate/drizzle/`.
- [ ] Vercel finished the deploy of both projects (Deployments tab shows "Ready").

## 2. Supabase (Pro)

**Plan and size**
- [ ] Settings > Billing shows **Pro**. Leave the spend cap on until you have watched usage for a month.
- [ ] Compute size: the default is fine for a pilot. If pages feel slow at 125 people, raise it one step (Settings > Compute and Disk). Connections are limited by size, and the app deliberately uses few (see CLAUDE.md, "Database connection").

**Backups (this is why you upgraded: do not skip)**
- [ ] Database > Backups shows **daily backups**. Pro keeps 7 days.
- [ ] Decide on **point-in-time recovery** (paid add-on, per-second restore). Recommended once real payroll hours and IDs are in: a bad import or deletion could otherwise lose up to a day.
- [ ] **Restore test, once, before real data**: restore a backup into a new/scratch project (Database > Backups > restore options) and confirm people and a document are there; then delete the scratch project. Tick "Backups checked with a restore test" on the go-live page.
- [ ] Put a monthly reminder to repeat it, and keep one **encrypted export of the TalentHR data** somewhere separate (go-live checklist).

**Sign-in (Authentication)**
- [ ] **Custom SMTP** is set to Resend (Authentication > SMTP), the sender is a monitored address on your verified domain, and the **email rate limit** has been raised from the default now that SMTP is custom (Authentication > Rate limits).
- [ ] Email templates pasted (`supabase/templates/confirmation.html`, `recovery.html`).
- [ ] **Password**: minimum length 12, and turn on **leaked password protection** (a Pro setting).
- [ ] **TOTP MFA** is on. Providers: Email on; Google on only if you want the button.
- [ ] **Before User Created hook** is on (`private.before_user_created`). Test: sign up with an email that was never invited; it must be refused.
- [ ] URL configuration uses the **final addresses** (Site URL and both redirect URLs) after you add the custom domain (section 3).
- [ ] If your plan shows **session settings**, set an inactivity timeout (24 hours is a sensible start). The clock's heartbeat keeps working sessions alive.

**Data safety**
- [ ] **Data API is switched off**, or at least none of `core, docs, time, talent, ops` is exposed (Settings > API). ELEVATE never uses it: it reads the database from the server and uses Supabase only for sign-in and file links. Turning it off removes a whole class of risk.
- [ ] Database > Advisors: run the **Security** and **Performance** advisors. Fix anything marked critical; tell me what remains and I will tell you which are expected (tables with RLS and no policy are intentional: nothing reads them except the server).
- [ ] Storage: the buckets `employee-docs`, `company-docs`, `recruiting-docs`, `signed-docs` exist and are all **private** (`pnpm storage:setup` creates them).
- [ ] SSL is enforced (Settings > Database).
- [ ] The two Safe Voice database logins exist with long **letters-and-digits** passwords saved in the password manager, and the app strings use the pooler user names (`safevoice_app.<ref>`, `safevoice_handler.<ref>`).

**Watching it**
- [ ] Settings > Billing > usage alerts on. Database > Reports checked once a week for the first month (CPU, connections).

## 3. Vercel (Pro)

**Plan and projects**
- [ ] Both projects (ELEVATE and Safe Voice) are under the **Pro team**, not an old personal Hobby space. Billing shows Pro with the seats you need; set a spend limit.
- [ ] Root directories `apps/elevate` and `apps/safe-voice`, Node 24.x on both.
- [ ] **Function region is Singapore (sin1)** in both (set by `vercel.json`; confirm under Settings > Functions). Do not remove it: it is the difference between a 2-second and a 10-second dashboard.
- [ ] **Cron**: Settings > Cron Jobs lists `/api/cron/backstop` every 15 minutes (this repo's `vercel.json` now does that on Pro), and `CRON_SECRET` is set (16+ characters).

**Domains**
- [ ] Add `elevate.<yourdomain>` to the ELEVATE project and `voice.<yourdomain>` (or similar) to Safe Voice. Add the DNS records Vercel shows; wait for the green check and HTTPS.
- [ ] Then update, in this order: Supabase Site URL and redirect URLs; ELEVATE `NEXT_PUBLIC_APP_URL`; ELEVATE `NEXT_PUBLIC_SAFEVOICE_URL`; redeploy both. Test sign-in on the new address.
- [ ] The old `*.vercel.app` addresses still work; that is fine, but tell people only the new ones.

**Environment variables (audit both projects, tick each)**
- [ ] ELEVATE has every name on the go-live page's list (it shows missing ones by name), plus `SUPER_ADMIN_EMAILS`, `ELEVATE_ENV=production` (**Production only**), and the Jibble token (section 5).
- [ ] Safe Voice has only `SAFEVOICE_DATABASE_URL`, `SAFEVOICE_PEPPER`, and the two Upstash values. Nothing from ELEVATE.
- [ ] Every secret is marked **Sensitive**. No production secret is copied into **Preview** or **Development** (they should be empty or point at a staging project).
- [ ] Deployment Protection: **Vercel Authentication on for Preview**; production stays public (people must reach it).

**Protection and visibility**
- [ ] Firewall (Pro): add a **rate-limit rule** on `/login` and on `/api/careers/apply`. Keep "attack challenge mode" off unless you see abuse.
- [ ] Alerts: turn on Vercel alerts for error rate and usage.
- [ ] **Safe Voice project: no Web Analytics, no Speed Insights, no log drains, no Sentry**, shortest log retention. This is part of what makes reports anonymous; `docs/SETUP.md` 14b explains each.
- [ ] ELEVATE: skip analytics products too (they collect IPs for no benefit here).

## 4. Other services

- [ ] **Upstash**: the **free plan is fine to start** for under 50 people. The clock page checks in only every 10 minutes while someone is clocked in (and when they come back to the tab), so expect well under the free monthly allowance; look at the usage page after the first week. If you get near the limit, switch to pay-as-you-go and set a monthly spending cap (about $5): it costs cents. Keep two databases (ELEVATE and Safe Voice). If Upstash is down or at its cap, login and sign-up fail closed on purpose; the clock keeps working.
- [ ] **Inngest**: stay on the **free plan**. The schedules were slowed on purpose and now total about **19,000 runs a month** (the busiest are overbreak alerts every 10 minutes and the Jibble sweep every 15), well inside the free allowance for this size. Check the usage page after one week; if it is high, slow the busiest schedules further instead of paying. Confirm the app is **synced** (Apps lists ELEVATE with its functions) and that the Production environment keys are the ones in Vercel.
- [ ] **Resend**: domain verified with SPF, DKIM and DMARC (all green). The **free plan (100 emails a day, 3,000 a month) is enough** for under 50 people: send invitations in waves of about 15 (Supabase sign-in mail shares the allowance), and keep `EMAIL_DAILY_BUDGET` at its default of 90. Upgrade only if you actually hit the limit. `EMAIL_FROM` and `EMAIL_REPLY_TO` are monitored addresses, never no-reply.
- [ ] **Google sign-in** (only if you use the button): to let anyone with a Google account use it, the consent screen must be **published (In production)**, not Testing (Testing only admits listed test users). Branding: app name ELEVATE, support and developer emails, **home page** `https://<elevate address>/login`, **privacy policy** `https://<elevate address>/privacy`, **terms** `https://<elevate address>/terms` (both public pages are in the app), authorized domain `eliteresourceservices.com` (Google may ask you to verify the domain in Search Console with a DNS TXT record). Keep only the default scopes (openid, email, profile): then publishing needs no Google review. Have counsel read `/privacy` and `/terms` (`apps/elevate/src/app/(legal)`). The calendar-for-interviews client is separate and optional.
- [ ] **Sentry** (optional but recommended): errors only, **no personal data**. Alerts go to a person who will read them.
- [ ] **Uptime monitor** (free tools such as UptimeRobot or Better Stack): watch `https://<elevate address>/login` and `https://<safe voice address>/` every 5 minutes, alert to two people.

## 5. Jibble (screenshots)

You proved the API clock-in works with `pnpm jibble:probe`. For the real link all of these are needed (the Jibble page under Attendance shows which is missing):

- [ ] `JIBBLE_ACCESS_TOKEN` in Vercel Production, made from a Jibble account that will stay; redeploy.
- [ ] `ELEVATE_ENV=production` on Production (safety lock: without it, calls are logged as skipped).
- [ ] A real **monitoring policy** is published (section 6). Turning a team's Jibble switch on needs it.
- [ ] Attendance > Jibble > **Match people** (work email must equal the Jibble email) and check every pilot person is matched.
- [ ] Attendance > Rules: the **Jibble switch on for the pilot team only**, with that team's allowed IP ranges if you use them.
- [ ] A pilot person clocks in on ELEVATE and the Jibble desktop app starts tracking; clock-out stops it. The page's "Recent calls" shows the calls as sent.
- [ ] HR knows the **pause switch** (Attendance > Jibble) and where the alerts go.

## 6. Policies and legal (needs people, not code)

- [ ] **Counsel reads**: contractor wording (1099), the signing consent text, the monitoring policy, retention periods (recruiting: 12 months after rejection, 6 after withdrawal; nothing else is auto-deleted), and the early-engagement review wording. Tick the go-live item.
- [ ] **Write and publish the real privacy notice and monitoring policy** (Settings > Policies). The seeded ones are placeholders and cannot be published. **Publishing the privacy notice stops everyone at an acceptance screen**, and a published version can never be edited (changes are new versions). Do it when HR is ready to answer questions.
- [ ] Philippines Data Privacy Act: name a **Data Protection Officer**, and ask counsel whether ERS must register with the National Privacy Commission. ELEVATE holds government IDs and bank details.
- [ ] **No patient data**: remind HR and leads (the upload screens already warn). Jibble screenshots can contain client data, which is why ELEVATE never copies them.
- [ ] Data-processing terms with each vendor (Supabase, Vercel, Resend, Upstash, Inngest, Jibble) kept on file, since they handle personal data for ERS.

## 7. Set up the live app (first sign-in as Super Admin)

- [ ] **People with roles**: use Settings > Invitations to invite HR admins, leads and recruiters with their roles in the invitation (Super Admin only). Check Settings > Roles afterwards.
- [ ] **Two Safe Voice handlers** named (tick the handler box when inviting, or Settings > Roles). Send a test report from the live Safe Voice address and answer it from ELEVATE; confirm no cookie is set.
- [ ] **Company structure**: departments, teams, positions, clients (People > Structure, Clients), reporting lines.
- [ ] **Holidays**: tick "verified" on each Philippine holiday HR has checked (US federal ones are pre-verified).
- [ ] **Hours settings**: pay period (Attendance > Hours export), each team's clock rules, schedules for the pilot team.
- [ ] **Templates**: document types, onboarding and offboarding checklists, review template, offer template; one real job opening if you want the careers page live.
- [ ] **Time zone** default is Phoenix with Manila as the second display; people can set their own.

## 8. Move the real data (only after sections 2 and 3)

- [ ] Import people (Settings > Import): upload, check the preview, commit, reconcile, **sign off**. Do a dry run first (the quarantine) and read the "changed" and "errors" lists.
- [ ] `pnpm talenthr:pull --dry-run --as <your email>` first, then without `--dry-run` (production connection and `ELEVATE_ENV=production` set in your PowerShell window, as DEPLOY Part 8 says). Keep the TalentHR key in `apps/elevate/.env.talenthr.local` only.
- [ ] Re-run reconciliation daily during the parallel run; the documents comparison should reach zero gaps.
- [ ] Remove or archive any test accounts and test people that are not real staff.

## 9. Rollout plan

1. **Pilot week**: one team, with HR on call. ELEVATE clock, Jibble screenshots if used. Fix what they find.
2. **Waves**: invite the rest in groups (50 at a time is plenty), so support questions arrive manageably. People accept an invite from the email, set a password, and enrol an authenticator app.
3. **Two-week parallel run**: TalentHR stays active; reconcile daily.
4. **Cut over**: HR signs off; export and encrypt a full TalentHR archive; cancel TalentHR at the end of its billing period.
5. **Share** `docs/RUNBOOK.md` with HR and whoever answers questions.

## 10. After every deploy (smoke test, 10 minutes)

1. Open the ELEVATE address: sign in as yourself with MFA; the **dashboard** loads in a few seconds with no "could not load" boxes.
2. Menu items open; search (Ctrl+K) finds a person.
3. Clock in and out (and check the Jibble page shows the calls if the link is on).
4. Open **Attendance > Health**: every job is "ok" (none late).
5. Send a test **Safe Voice** report and see it in Safe Voice cases (handlers only).
6. Open the Vercel deployment's logs for errors for a few minutes.

**Deploying safely:** migrate first (section 1), then deploy; deploy at the Manila shift change (see the runbook); if something is wrong, Vercel > Deployments > the previous deployment > **Promote to Production** puts the old code back in seconds. A database migration is not undone by that, which is why migrations only ever add things.

## 11. If something breaks

Start at `docs/RUNBOOK.md`. For a stuck or slow page: Vercel > Logs for the request (look for `dashboard panel failed` lines), Supabase > Reports, and the SQL in `docs/DEPLOY.md` ("If something goes wrong").
