# 07 Rollout and operations

## Three releases

### Release 1: the learner and the record (core)

**Built so far:** the `learn` schema (migration 0054), the sign-in handoff, **the 7 HIPAA modules and the 83-question bank, plus the separate Cybersecurity basics course (8 modules, about 80 questions) (authored in `apps/learn/src/content/hipaa`)**, the publish step (`pnpm learn:publish`, draft first; publishing needs a reviewer and counsel's date), assigning (`pnpm learn:assign` until the HR page and the nightly job exist), the course overview, the module player (server-credited time, activity check), the exam runner, results and review, the attestation and an on-screen printable certificate, and the public check page. **Also built:** the ELEVATE side (migration 0055): the `learn-assign`, `learn-remind`, `learn-sync` and `learn-purge` jobs, the Training status page for HR and leads (assign, more tries or time), the client setting "works with patient information" that decides the track, and certificates recorded in Certificates. The **PDF certificate** (download on the certificate page) and its **emailed copy** (queued when the certificate is recorded) are built. **Reminder emails** (30 days, 7 days, due date, then weekly while overdue, with a per-person off switch) and the **pilot limit** (automatic assignment per course: everyone, chosen teams, paused) are built too. The **My training record** page (Learn `/record`, also in My data) is built. **Still open in release 1:** the content sign-off by counsel and the Privacy Officer (not code) and an optional combined "my record" PDF.
- `learn` schema, roles and triggers (migration), `apps/learn` shell, handoff, sessions.
- Core course written in code (8 modules, bank of at least 50), tracks Full and Essentials, pacing, exam engine, attestation,
  certificate and check page, My HIPAA record.
- ELEVATE: menu item and launch, `learn-assign`, `learn-remind`, `learn-sync` (certificate into Certificates), HR Training page
  (assignments, due and overdue, retries), status view for leads, notifications and email, health registry entries.
- Content approved by counsel or the Privacy Officer before go-live.
- Pilot: 10 VAs (mixed teams and clients) and 2 leads, then everyone.

### Release 2: management and governance
- Studio (block editor, versions, preview, publish checklist), client add-ons, `core.clients.handles_phi`.
- Incident report form and inbox (`ops.privacy_incidents`), Privacy Officer flag and designation. **Built** (migration 0057; HR or Super Admin names the officer; one email to HR and officers with no details; see CLAUDE.md, "Privacy incident reports").
- Onboarding checklist task kind `hipaa_training` (**built**, migration 0062), client-assignment readiness (**built**, a warning only), the dashboard training counts (**built**), client audit evidence report (**built**, CSV and PDF); My data export (**built**). The **course studio** is **built** (migrations 0063 and 0064): versions, diff, editing text and exam questions, adding and reordering modules, screens and questions, exam rules, a preview in Learn, a publish checklist and publishing with a second person. Client add-on courses are **built** too (migrations 0065 and 0066): a course per client, created in the studio, assigned to the people on that client, with its own certificate prefix and a column in the client evidence report. **Release 2 is complete.**

### Release 3: reinforcement
**Built:** update modules (migration 0072; see `docs/modules/learn.md`, "Release 3"). Course statistics and the weak-topic recap (built; studio statistics page). Quick-reference cards and quarterly micro-drills (migration 0073). Release 3 is complete, with its parked items (several add-ons per client, acknowledgment-only add-on, version-bound recaps, combined record PDF; migration 0075). Recap videos for client add-ons are not built (see `13-recap-videos.md`).

- Refresher track and exam, update modules, micro-drills, weak-topic statistics and question analytics, quick-reference cards,
  motion graphics or narrated slides for the topics that need them.

## ELEVATE-side change list

| Area | Change |
| --- | --- |
| Migration | `learn` schema, tables, `learn_app` role, views, triggers, `grade_attempt`, `core.clients.handles_phi`, `core.users.is_privacy_officer`, `ops.privacy_incidents` |
| Menu | "HIPAA training" under a new "Learning" group (opens Learn in the same tab through the launch page) |
| Permissions | `learn.*`, `incidents.*` plus matrix rows and authz tests |
| Jobs | `learn-assign`, `learn-remind`, `learn-sync`, `learn-expire`, `learn-purge` in functions and the health registry |
| Checklist | `hipaa_training` check kind (like `policy_acknowledged`), default onboarding item |
| Clients | `handles_phi` switch; assignment screen shows readiness |
| Dashboard | Needs-attention count of overdue and expiring HIPAA training (counts only) |
| Certificates | Learn certificates appear as "HIPAA training (ERS)" with the same expiry reminders |
| Settings | Privacy Officer designation (Super Admin), exam settings (HR) |
| Docs | `docs/SETUP.md`, `DEPLOY.md`, `RUNBOOK.md`, `PRODUCTION-CHECKLIST.md` sections; `CLAUDE.md` Learn section |

## Environment and setup (names only)

| Where | Variables |
| --- | --- |
| Learn on Vercel | `LEARN_DATABASE_URL`, `NEXT_PUBLIC_ELEVATE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| ELEVATE on Vercel | `NEXT_PUBLIC_LEARN_URL` |

Order of operations for each release: (1) migration against production with `DATABASE_URL_DIRECT`; (2) `ALTER ROLE learn_app
LOGIN PASSWORD '...'` out of band; (3) Vercel project, domain and variables; (4) deploy ELEVATE; (5) deploy Learn;
(6) press Sync in Inngest for new jobs; (7) smoke test with a test account.

## Operations (RUNBOOK additions)

- **A learner is stuck on the launch page:** check the account is active in ELEVATE; reopen from the menu; confirm
  `NEXT_PUBLIC_LEARN_URL`; look at the health page for `learn-assign`.
- **Certificate missing in ELEVATE:** `learn-sync` runs every 30 minutes; check the Health page; the Learn certificate is the
  source of truth.
- **Someone locked out of the exam:** HR page, "Grant a retry" with a reason (audited).
- **Content mistake found after publishing:** publish a new version; mark "material" only if people must relearn it.
- **Suspected cheating:** the Privacy Officer reviews attempt timing; a certificate can be revoked with a reason.
- **Signing everyone out of Learn:** `update learn.sessions set ended_at = now() where ended_at is null` (nothing else is lost).
- **Backups and restore:** the `learn` schema is part of the same database backup; the restore test covers it.

## Cost

Within current plans: Vercel Pro (one more project), Supabase Pro (same database), Upstash free (a few commands per start and
submit), Inngest free (five jobs, about 1,500 runs a month), Resend free (reminders go through the existing queue and
budget). Video, if added, is the only item that may need storage or bandwidth beyond today; decided with the owner at release 3.

## Open items (need an owner and a date)

| # | Item | Needed by |
| --- | --- | --- |
| 1 | Designate the Privacy Officer (one or two people) | Before release 1 content approval |
| 2 | Counsel review of attestation, retention periods (6 years / 12 months), and "contractor" wording | Before release 1 go-live |
| 3 | Whether training time is paid or counted anywhere (we only record it) | Before release 1 |
| 4 | Which clients handle patient information (`handles_phi`) so tracks resolve correctly | Before the first assignments |
| 5 | Certificate issuer name and title | Before release 1 |
| 6 | Wait after failure (1 hour), 3 tries and pass mark (80%, matching the existing course) confirmed by counsel/HR. There is no exam time limit | Release 1 pilot |
| 7 | Motion graphics: who produces them and where they are hosted | Release 3 |
| 8 | Incident handling timelines per client BAA (notice windows) | Release 2 |
| 9 | Whether overdue training should ever affect client assignment (default: warning only) | Release 2 |

## Risks and how we handle them

| Risk | Handling |
| --- | --- |
| Content is wrong or outdated | Counsel review, versioned updates, review dates on each module, "material change" workflow |
| Exam too hard or unfair | Pilot statistics, question review rule, retry grants, accommodations |
| Cheating or answer sharing | Randomization, rotating bank, attestation, timing review, revocation |
| Learners lose progress | Autosave after every screen, resume on any device |
| Handoff trouble blocks everyone at shift change | Handoff is a single quick round trip; load tested; clear fallback message |
| Scope creep into a general LMS | Scope list in `01`; new courses are a separate decision |
| Score misuse by managers | Leads see status only; no score fields in lead views, notifications or exports |
