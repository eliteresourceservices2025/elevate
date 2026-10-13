# 10 Production deployment walk-through

Everything below happens once, in this order. Run each step from the same PowerShell window rules as `docs/DEPLOY.md`
(production connection strings are typed into the window, never saved in a file that is committed). **Apply migrations before
deploying the code that needs them**, always.

Time needed: about 90 minutes, plus waiting for DNS. Do it outside the Manila shift change (`docs/RUNBOOK.md`, "Deploying").

## 0. Before you start (10 minutes)

1. **Know where production is.** In the Supabase SQL editor of the production project run:

   ```sql
   select count(*) from drizzle.__drizzle_migrations;
   ```

   The repository has 63 migrations (0000 to 0062). Production is behind by the ones not yet applied (the last time this was checked,
   the learn migrations 0054 to 0059 and the incident migration 0057 had not been applied; earlier ones may be missing too, which is
   fine: the command applies whatever is missing, in order). Note the number you see; step 1 should end at 63.
2. **Pull the latest commits** on your computer (`git pull`) and confirm `apps/elevate/drizzle` ends with
   `0062_checklist_hipaa_training.sql`.
3. **Take a backup point.** Supabase dashboard > Database > Backups: note the latest backup time (Pro plan keeps daily backups).
4. **Decide on the roll-out** (read step 9 first): which teams are the pilot, and whether HIPAA, which is already live, should be
   paused until then.

## 1. Apply the migrations (10 minutes)

In PowerShell, in the repository folder:

```powershell
$env:DATABASE_URL_DIRECT = "<the session pooler string, port 5432>"
pnpm db:migrate
```

It should end with "migrations applied successfully". Then check the count again (should be 63) and that these exist:

```sql
select to_regclass('learn.assignments'), to_regclass('ops.privacy_incidents'), to_regclass('talent.credentials');
select column_name from information_schema.columns where table_schema = 'core' and table_name = 'users' and column_name = 'is_privacy_officer';
select column_name from information_schema.columns where table_schema = 'core' and table_name = 'clients' and column_name = 'handles_phi';
```

All three queries must return a row. What the new migrations add: 0050 to 0053 (careers slugs, support and anniversaries,
content files, attendance leads), 0054 to 0056 and 0058 to 0059 (the `learn` schema, nightly jobs, no exam time limit,
certificate reference codes, transcript function), 0057 (privacy incident reports and the Privacy Officer flag).

Close the window afterwards.

## 2. Give the Learn database role a password (5 minutes)

The migration created `learn_app` without a login. In the Supabase SQL editor (one long random password, saved in the password
manager, never in chat):

```sql
ALTER ROLE learn_app LOGIN PASSWORD '<long random password>';
```

Build `LEARN_DATABASE_URL` from the **transaction pooler** string (port 6543): user name `learn_app.<project-ref>`, the password
above. Keep it for step 4.

## 3. Deploy ELEVATE with the new code (15 minutes)

1. Push `main` (`git push origin main`) only when you are ready; Vercel deploys the ELEVATE project.
2. Wait for the deployment to be Ready, then open ELEVATE and sign in.
3. **Inngest:** open the Inngest dashboard, Production environment, press **Sync** (or Apps > Sync new app version). Four jobs
   appear: `learn-assign`, `learn-remind`, `learn-sync`, `learn-purge`. The older jobs stay.
4. **Health check:** Attendance > Health in ELEVATE should show the four new jobs as "waiting for first run" (not late for a day).

If something looks wrong, the previous deployment can be promoted again in Vercel; the migrations are additive and the old code
runs against them.

## 4. Create the Learn project on Vercel (20 minutes)

Follow `docs/DEPLOY.md`, Part 5b, steps 2 to 5 (that part is the authoritative list; the short version):

1. Vercel > Add New > Project > import the same repository. Name `elevate-learn`. **Root Directory `apps/learn`**, Node 24.x.
2. Environment variables, Production, set **before** the first deploy:
   - `LEARN_DATABASE_URL` (Sensitive): from step 2;
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Sensitive): the same values as ELEVATE;
   - `NEXT_PUBLIC_ELEVATE_URL`: `https://elevate.eliteresourceservices.com` (https, no trailing slash).
3. Deploy. Then Settings > Domains > add `learn.eliteresourceservices.com`; at the DNS host add the CNAME Vercel shows; wait for the
   certificate.
4. In the **ELEVATE** project add `NEXT_PUBLIC_LEARN_URL` = `https://learn.eliteresourceservices.com` (Production) and
   **redeploy ELEVATE**. (Until then "My training" says training is not available yet.)

## 5. Check the sign-in handoff (5 minutes)

Sign in to ELEVATE > **My training** (under Learning) > **Open training**. You land on Learn saying "Hello, <your name>" and "You have
no training assigned yet". **Sign out of training** returns you to ELEVATE. If it says the link expired, follow the troubleshooting
paragraph at the end of `docs/DEPLOY.md` Part 5b.

## 6. Before any course goes live: set the people side (15 minutes)

1. **Clients:** People > Clients. For each client, set **Works with patient information** correctly (it is on by default). This
   decides who gets the Full HIPAA track and who gets Essentials.
2. **Privacy Officer:** open **Privacy incidents** (Speak up) and name the Privacy Officer(s) by sign-in email. They then see the
   incident inbox. HR and Super Admin always do.
3. **Safe Voice handlers:** unchanged, but confirm at least two exist (Settings > Go-live checklist shows it).
4. **Email:** confirm `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_REPLY_TO` are set on ELEVATE. Certificate copies and incident
   notices need them; without them the certificate copy waits in the queue and incident emails are skipped (in-app notices still
   work). Remember the free plan sends 100 emails a day.
5. **Content review:** counsel and the Privacy Officer read the HIPAA course (`docs/learn/08-source-check.md`) and the
   Cybersecurity course (`docs/learn/09-cybersecurity-sources.md`). Record the date counsel approved; the publish command asks for it.

## 7. Publish the courses (10 minutes)

From your computer, with the production `DATABASE_URL_DIRECT` in the PowerShell window (the same way as step 1):

```powershell
cd apps/elevate
pnpm learn:publish --course hipaa                 # saves a DRAFT (safe to repeat); read the line it prints
pnpm learn:publish --course cybersecurity         # the same for Cybersecurity basics
```

Each prints "Saved as a draft: version 1 (N modules, M questions)". When the content is approved, publish (this freezes that
version and records who reviewed it and the date counsel approved it):

```powershell
pnpm learn:publish --course hipaa --publish --reviewer eliteresourceservices2025@gmail.com --counsel-date YYYY-MM-DD
pnpm learn:publish --course cybersecurity --publish --reviewer eliteresourceservices2025@gmail.com --counsel-date YYYY-MM-DD
```

The reviewer must be an ELEVATE account (the command stops with "No ELEVATE account" otherwise). The counsel date is recorded as a
fact: use the real date. Changing the text later means saving a new version (re-running the command), never editing a published one.

## 8. Try it with one person first (15 minutes)

Before the nightly job assigns everyone, put yourself on each course by hand:

```powershell
pnpm learn:assign --course hipaa --email <your work email> --track full
pnpm learn:assign --course cybersecurity --email <your work email> --track full
```

(Or use **Training status** in ELEVATE: choose the course tab, find yourself, press Assign.) Then in Learn: read one module,
confirm the Finish button unlocks after the time shown, take the exam, accept the statement, download the PDF, and check that:

- the PDF has the logo, the module list and the transcript page, and the reference starts with `ERSHC-` or `ERSCSC-`;
- the certificate copy arrives by email within about 30 minutes (the sync job runs every 30 minutes);
- the certificate appears under **Certificates** in ELEVATE;
- the public check page (`/verify` on Learn) says valid for the reference and your full name.

Delete nothing afterwards: your test certificate is real evidence. If you do not want it, ask HR to revoke it with a reason.

## 9. Choose who gets each course

A course published for the **first time** starts **paused**: the publish command adds a "paused" rule, so publishing alone assigns
nobody (migration 0060). A course that was already live before that migration (HIPAA in production today) has no rule and keeps
assigning everyone each night, so **set it before the next 1:35 AM Phoenix run** if you want a pilot.

In ELEVATE open **Training status**, pick the course tab, and use **Automatic assignment**:

- **Everyone:** each night everyone active who needs the course is assigned it (due in 30 days; new hires 30 days after their start).
- **Chosen teams only:** tick the pilot teams (10 VAs and 2 leads, as planned). Anyone else can still be assigned by hand.
- **Paused:** nobody is assigned automatically. Leavers are still closed out and existing assignments keep their reminders.

Widen it to everyone when the pilot went well. It takes effect at the next nightly run; assignments already made stay.

Reminders go out in the app **and by email** at 30 days, 7 days and the due date, then weekly while overdue (people can turn the
emails off in Settings > Email notifications). The emails share the daily budget of 90, so a night that assigns many people drains
over a few days; certificate copies and acknowledgments always go first. HR and leads see progress on **Training status**.

## 10. Afterwards

- Tick the matching rows in Settings > Go-live checklist and note the date in `docs/PRODUCTION-CHECKLIST.md`.
- Add the two new items to the HR runbook share-out: Privacy incidents (who to tell) and Training status (who is overdue).
- Re-run `docs/learn/08-source-check.md` whenever the HIPAA content or the rules change (the regulation text, HHS guidance).

## If it goes wrong

| Problem | What to do |
| --- | --- |
| Learn says "sign-in link expired" for everyone | `NEXT_PUBLIC_ELEVATE_URL` in Learn must equal the ELEVATE address exactly; check `LEARN_DATABASE_URL` and the role password; see `docs/DEPLOY.md` Part 5b |
| Nobody got assigned overnight | Inngest Sync was not pressed, or no version is published; check the `learn-assign` run in Inngest and Attendance > Health |
| Certificate copy never arrives | `RESEND_API_KEY` or the daily budget; the email waits in `ops.email_queue`; the certificate is still in Learn and Certificates |
| A wrong course version was published | Publishing cannot be undone; save the corrected content (a new version) and publish it; people on the old version finish it |
| Need to switch Learn off quickly | Remove `NEXT_PUBLIC_LEARN_URL` from the ELEVATE project and redeploy; the menu item says training is not available |
