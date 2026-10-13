# 02 Architecture

## Shape

```
  ELEVATE (apps/elevate)                           ELEVATE Learn (apps/learn)
  elevate.eliteresourceservices.com                learn.eliteresourceservices.com
  ┌───────────────────────────┐   POST + one-time  ┌──────────────────────────┐
  │ sign-in, MFA, roles        │ ─────token──────▶  │ own session cookie        │
  │ HR pages: assignments,     │                    │ course player, exam,      │
  │ reports, evidence, incident│                    │ certificate, studio       │
  │ jobs: assign, remind, sync │                    │ role: learn_app (DB)      │
  └─────────────┬─────────────┘                    └─────────────┬────────────┘
                │ owner connection                               │ restricted role
                └──────────────  Postgres: schema learn  ────────┘
```

- **Learn** is a minimal Next.js 16 app (React 19, TypeScript strict, pnpm workspace member, port 3200 locally, region `sin1`).
  It owns the learner experience and the content studio. It has **no Supabase keys, no service keys and none of ELEVATE's
  secrets**: only its own database role and its own session secret.
- **ELEVATE** owns people, roles, teams, clients, notifications, email, audit and the Certificates module. It owns the **database
  migrations** for the `learn` schema (migrations live in `apps/elevate/drizzle`, like Safe Voice's tables), and the HR-facing
  pages and jobs.
- **One database, two doors.** ELEVATE uses its normal connection. Learn uses the `learn_app` role created by a migration with no
  login (ops sets the password out of band, exactly like `safevoice_app`).

## Why a separate app (not a module)

- A learner-facing surface with a hostile-by-nature exam deserves its own deployment, CSP, secrets and blast radius.
- ELEVATE's `main` stays focused on HR; Learn can ship content or UI changes without redeploying HR.
- The same shape will host later courses.

## Sign-in handoff (decided)

A shared cookie on `.eliteresourceservices.com` was rejected: the browser would send ELEVATE's auth cookie to
`safevoice.eliteresourceservices.com` too, which breaks Safe Voice's promise. Instead:

1. In ELEVATE a person clicks **HIPAA training** (menu item under "Learning", the page `/learn`, which already requires a
   signed-in AAL2 session) and presses **Open HIPAA training** (it starts by itself with `?auto=1`). A server action
   (`startLearnLaunch`, permission `learn.launch`, rate limit `learnLaunch`) creates a **launch token**: 256 random bits, stored only as a SHA-256 hash in
   `learn.launch_tokens` with the user id, expiry (60 seconds) and a one-use flag.
2. The browser then **POSTs** the token to `https://learn.../auth/handoff` with a form (so the token is never in a URL, history or
   referrer). Learn accepts it only when the `Origin` is ELEVATE's address.
3. Learn consumes it with a single atomic `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING`, so a replay
   fails. It then creates a Learn session: a random 256-bit value in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, stored as a
   hash in `learn.sessions` with user id, the sign-in methods ("password, totp") copied from ELEVATE's session, a 30-minute idle
   timeout and an 8-hour absolute limit.
4. A visitor with no Learn session is redirected to ELEVATE's `/learn?auto=1` (which signs them in with MFA first, then posts
   back). A failed handoff goes to `/expired`, which links to `/learn` without `auto`, so there is no loop. Signing out of Learn ends
   only the Learn session (POST `/auth/signout`, accepted only from Learn's own pages) and returns to `/signed-out`, then ELEVATE.
5. On every request Learn checks the session and that the account is still active (`learn.v_learners.active`); deactivating a
   person in ELEVATE ends their Learn access within the next request.

Learn never sees a password, an ELEVATE cookie or a Supabase token.

## What Learn may read and write

| Reads (through views, never the people tables) | Writes |
| --- | --- |
| `learn.v_learners`: user id, display name, work email, active flag, team id, track | `learn.module_progress` (append-only events) |
| `learn.v_staff_roles`: which people may use the studio or see all results | `learn.module_time`, `learn.exam_attempts`, `exam_attempt_items`, `exam_answers` |
| its own course content and assignments | `learn.attestations`, `learn.certificates` (insert-only) |
| | `learn.drills` results, `learn.notices_seen` |

ELEVATE reads everything in `learn` and writes `courses`, `assignments`, `retry_grants` and other management data.

## ELEVATE-side modules (new)

- `src/modules/learn/` in ELEVATE: assignment resolution (who gets which track), deadlines, reminders, the certificate sync into
  `talent.credentials`, HR reports and the client evidence report, retry grants, privacy officer flag handling.
- `src/modules/privacy-incidents/` (new): the incident report form and inbox (`ops.privacy_incidents`). Learn's incident module
  links to it; reporting needs an ELEVATE sign-in, which people already have.
- New permissions (matrix rows and authz tests for every one): `learn.view_own`, `learn.view_status` (team: passed or not yet),
  `learn.view_results` (HR, Super Admin, Privacy Officer), `learn.assign`, `learn.grant_retry`, `learn.manage_course`,
  `learn.export_evidence`, `incidents.report` (everyone), `incidents.handle` (HR, Super Admin, Privacy Officer).

## Jobs (respect the Inngest budget: nothing more often than 30 minutes)

| Job | Schedule | What it does |
| --- | --- | --- |
| `learn-assign` | daily 1:35 AM Phoenix | Resolve each active person's track from their client assignments; create assignments with due dates; close assignments for people who left |
| `learn-remind` | daily 8:50 AM Manila | 30-day, 7-day and due-date reminders to the person; weekly overdue summary to the lead and HR (counts and names, never scores) |
| `learn-sync` | every 30 minutes | Copy new Learn certificates into ELEVATE's Certificates (idempotent), notify the person |
| `learn-purge` | daily 3:50 AM Phoenix | Remove per-question answers older than 12 months, expired launch tokens and sessions, unused media |
| `learn-expire` | daily 1:50 AM Phoenix | Mark certificates expired and open renewals (refresher assignment) |

All are added to `src/inngest/functions.ts` **and** `health/registry.ts` together (a test enforces it). Learn itself runs no
scheduled work.

## Course content model

Content is **data, not HTML**: a course version is a JSON document validated by one Zod schema shared by the studio and the
player. Blocks: heading, paragraph (limited inline formatting), list, callout, compare (authorized / not authorized),
scenario (choices with feedback), checklist, image, media (video or narrated slides with captions and transcript), knowledge
check. There is no raw HTML and no script, so a content editor cannot inject code.

Publishing a version freezes it (database trigger, like policy versions). Every attempt, attestation and certificate stores the
course version id.

## Hosting and environment

- Vercel project `elevate-learn` (root `apps/learn`), region `sin1`, custom domain `learn.eliteresourceservices.com`.
- Environment (names only): `LEARN_DATABASE_URL` (the `learn_app` role), `NEXT_PUBLIC_ELEVATE_URL` (no session secret: a session is a random value and only its hash is stored), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- ELEVATE gains `NEXT_PUBLIC_LEARN_URL` (public address of Learn, like `NEXT_PUBLIC_SAFEVOICE_URL`) and
  `LEARN_LAUNCH_SECRET` is **not** needed: tokens are random values checked in the database, not signed.
- No new paid service. Videos (release 3) are static assets with captions; hosting is decided with the owner then.
