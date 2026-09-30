# ELEVATE — Build prompts for Claude Code

Paste one prompt at a time into Claude Code from the repo root. Each assumes `CLAUDE.md` and `docs/architecture-plan.md` are in the repo. Finish a phase's **gate** before starting the next. Commit after each prompt.

Tip: start each session with "Read CLAUDE.md and the architecture plan section for <module> first. Plan before coding, then show me the plan."

---

## Phase 0 — Setup and foundations (weeks 1–2)

**Gate:** MFA login works end to end; role tests pass; CI green.

**0.1 Project skeleton**
> Set up the ELEVATE skeleton per CLAUDE.md and SETUP.md: folder structure, Tailwind theme tokens (placeholder ERS palette), shadcn/ui base components, app shell with sidebar navigation for all modules (links can be placeholders), `src/lib/db.ts` with Drizzle over the Supabase transaction pooler (`prepare: false`, `server-only`), drizzle.config.ts with schemas core/docs/time/talent/ops, Vitest and Playwright configs, and GitHub Actions CI (lint, typecheck, test). No features yet.

**0.2 Auth and MFA**
> Implement Supabase Auth with @supabase/ssr: email + password sign-up/sign-in, Google OAuth, password reset, and mandatory TOTP MFA enrollment and challenge. `src/proxy.ts` refreshes the session and redirects any `(app)` route to /mfa unless the session is AAL2. Add `requireUser()` in `src/lib/auth.ts` that returns the current user with roles or throws. Sign-up is allowed only for emails that HR has invited (an `core.invitations` table) or listed in `SUPER_ADMIN_EMAILS`.

**0.3 Roles, permissions, audit**
> Create `core.users`, `core.roles`, `core.user_roles`, `ops.audit_log` (insert-only; revoke UPDATE/DELETE). Implement `authorize(user, action, resource)` in `src/lib/authz.ts` from the permission matrix in the architecture plan §3 (roles: super_admin, hr_admin, team_lead, recruiter, executive, employee; scopes own/team/all). Implement `writeAudit()`. Add a Settings → Roles page (Super Admin only) to assign roles, audited. Write `tests/authz/` helpers that run an action as each role and assert allowed/forbidden.

**0.4 Field encryption and seed**
> Implement `src/lib/crypto.ts`: AES-256-GCM encrypt/decrypt with versioned keys from `FIELD_ENCRYPTION_KEYS` (format `v2:base64,v1:base64`, newest first; ciphertext stores the key version). Unit-test round trip and key rotation. Write `scripts/seed.ts` with fake data: 40 employees across 5 teams and 6 clients, one user per role.

---

## Phase 1 — Core HR (weeks 3–6)

**Gate:** HR reviews profiles on seed data and signs off; authz tests pass for every action.

**1.1 People records (A1)**
> Build the People module: `core.employees`, `core.employee_sensitive` (encrypted columns), `core.employment_history`, `core.emergency_contacts`, `core.custom_field_defs/values`, `core.clients`, `core.client_assignments`. Pages: directory (TanStack Table, search, filters by team/client/status), profile with tabs (Personal, Employment, Government IDs, Payout, Emergency, Client assignments, History). Sensitive tabs follow the permission matrix and are masked with a "reveal" action that is audited. Employee self-service edits of contact/bank details create a change request that HR approves; approved changes write before/after to employment_history.

**1.2 Organization (A2)**
> Departments, teams, positions, and `manager_id` on employees with dated changes. Org chart page with React Flow + d3-hierarchy layout: zoom, search, click a node to open the profile (respecting permissions). Prevent cycles in the manager chain.

**1.3 Document vault (A3)**
> `docs.document_types` (with `requires_expiry`), `docs.documents` linked to an employee or the company. Upload through signed URLs to private buckets, server-side MIME and size checks (PDF, JPG, PNG, DOCX ≤10 MB), 60-second download links. Expiry reminders at 30 and 7 days via an Inngest scheduled function. Include document types for NBI clearance, government IDs, HIPAA training certificate, client confidentiality agreement, background check.

**1.4 Announcements and policy acknowledgments (A4)**
> `docs.announcements`, `docs.policies`, `docs.policy_acknowledgments`. HR posts; items marked "requires acknowledgment" show a banner until acknowledged; HR sees who has not acknowledged. In-app notifications (`ops.notifications`) with a bell menu; email via Resend only for acknowledgments due and a daily digest.

**1.5 Privacy notice**
> On first login show the ERS privacy notice (versioned text in `docs.policies`) and store the acknowledgment with version and timestamp. Add "My data" page: employee downloads their own profile data as JSON/PDF.

---

## Phase 2 — Time and attendance (weeks 7–11)

**Gate:** one pilot team uses the time clock for a week with Jibble screenshots running; leave balances match TalentHR for 10 sample people.

**2.1 Leave policies and ledger (B1)**
> `time.leave_types`, `time.leave_policies` (accrual amount, frequency, cap, carry-over, eligibility after N months), `time.leave_ledger` (append-only: accrual, usage, adjustment, carryover, opening_balance), `time.holidays` (PH and US calendars; per-employee calendar based on assignment). Balance = sum of ledger. Monthly accrual as an Inngest cron function, idempotent per employee per period.

**2.2 Leave requests and approvals**
> Request form showing balance, holidays and teammates already off. Two-level approval: team lead then HR, with a per-leave-type "skip HR" option. On approval write a usage ledger row, update the team calendar, send an .ics invite; cancellation reverses the ledger row. Reminders after 2 working days; escalation to HR after 4. Team calendar page (month view) scoped by role.

**2.3 ELEVATE time clock (B2)**
> Build the web time clock. Table `time.clock_events` (employee, type: clock_in | break_start | break_end | clock_out, occurred_at UTC, ip, approx_location nullable, selfie_document_id nullable, source web|admin_correction, correction_reason). A persistent clock widget in the app header shows status and elapsed time. Clock-in records IP (from the request, never trusted from the client) and, if the employee allows it, browser geolocation rounded to ~1 km; compare the IP with per-team allowed ranges in settings and flag outside ones. Optional selfie per team via getUserMedia, stored as a private document. Idle prompt in Chrome/Edge using the Idle Detection API with graceful fallback to "no activity in ELEVATE for N minutes". Missed clock-out: Inngest job after shift end + grace period notifies the employee and lead; corrections need lead approval and are audited. Nightly job builds `time.attendance_days` from clock events vs schedule and approved leave (hours, first in, last out, late, overtime, absence flags). Server-side rules: no overlapping sessions, no clock-in while on approved full-day leave.

**2.4 Jibble link (screenshots only)**
> Integrate the Jibble API with Client ID/Secret from Jibble Organization Settings → API Credentials (check docs.api.jibble.io for the token flow). Map people by email (`core.employees.jibble_person_id`). On ELEVATE clock-in/clock-out, call Jibble's clock-in/clock-out so the Jibble desktop app captures screenshots only during work time; queue the call through Inngest with retries and log each call in `time.jibble_link_log`. Add an admin toggle "Mirror clock to Jibble" per team. Fallback mode (if API clock-ins do not start screenshots): nightly job pulls Jibble timesheets and flags days where ELEVATE and Jibble differ by more than 15 minutes. Never store screenshots or GPS from Jibble.

**2.5 Schedules and hours export (B3)**
> `time.schedules`: shift start/end in the client's time zone, rest days, effective dates. Show both client time and Manila time. Attendance review page for team leads (flags for their team). HR export of approved hours per pay period as CSV.

---

## Phase 3 — Talent lifecycle (weeks 12–15)

**Gate:** one real hire runs from application to completed onboarding; a contract is signed and its fingerprint verifies.

**3.1 Recruiting (C1)**
> `talent.job_openings`, `talent.candidates`, `talent.applications`, `talent.pipeline_stages`, `talent.interviews`, `talent.scorecards`, `talent.offers`. Public `/careers` pages (job list, job detail, apply form with privacy notice consent, resume upload, Upstash rate limit, honeypot field). Kanban pipeline with dnd-kit. Interview scheduling on the recruiter's connected Google Calendar (OAuth, `calendar.events` scope, refresh token encrypted). Scorecards per interviewer. Recruiters see only ATS data.

**3.2 ELEVATE Sign (C4)**
> `docs.esign_envelopes`, `docs.esign_signers`, `docs.esign_events`. HR uploads a PDF or picks a template, places signature/date/name fields, sets signing order. Signers (signed in at AAL2) review, tick an explicit "I agree to sign electronically" consent, type or draw (react-signature-canvas) their signature. On completion: stamp signatures with pdf-lib, append a certificate page (document name, signers, emails, timestamps in UTC and Manila time, IP addresses, MFA method, event log), compute SHA-256 of the final PDF, store it, and make the original read-only. Add a "Verify document" page that checks an uploaded PDF's hash against records.

**3.3 Offers and hiring**
> Generate offer letters from templates with @react-pdf/renderer, send for signing, and on "Hired" create the employee record from the candidate and open an onboarding case.

**3.4 Onboarding and offboarding (C2, C3)**
> `talent.checklist_templates` (per position), `talent.onboarding_cases`, `talent.offboarding_cases`, `talent.checklist_tasks` (owner role or person, due date relative to start or last day, requires document/signature flags). Onboarding: contract, NDA, policy signing, pre-employment documents, equipment issue, welcome meeting. Offboarding: clearance, asset return, turnover notes, exit interview form, final hours export; an Inngest job disables the account and revokes all sessions at the end of the last working day. Certificate of employment generation on request.

---

## Phase 4 — Engagement and insight (weeks 16–18)

**Gate:** security review checklist passed (below); analytics numbers match manual counts.

**4.1 Performance (D1)**
> `talent.review_cycles`, `talent.review_templates`, `talent.reviews`, `talent.goals`. Cycles: quarterly, annual, probation. Probation reviews auto-scheduled at month 3 and month 5 after start date. Self review → lead review → HR calibration → shared with employee (acknowledgment recorded).

**4.2 Safe Voice (D2)**
> Build Safe Voice as a separate minimal Next.js app (or route group deployed as its own Vercel project) on its own subdomain. It never reads cookies or sessions; request logging disabled for its routes where possible; it connects with `SAFEVOICE_DATABASE_URL` (a DB role limited to `ops.safevoice_reports` and `ops.safevoice_messages`). Submit form: category, description, optional attachments with metadata stripped (images re-encoded, PDFs rebuilt with pdf-lib). Returns a random case code and passphrase (hashed with a pepper). Reporter can view replies and reply by code + passphrase. In ELEVATE, only users flagged as Safe Voice handlers see the case list and can reply, change status and close with an outcome. Stats show counts only, hiding categories with fewer than 5 reports.

**4.3 Assets (D3)**
> `talent.assets` (type, serial, purchase date, condition, status), `talent.asset_assignments`. QR label page (qrcode.react) for printing; scanning a QR opens the asset (auth required). Assignment and return history; returns tied to offboarding tasks.

**4.4 People analytics (D4)**
> Nightly Inngest job fills summary tables. Dashboards with shadcn charts: headcount by team/client over time, joiners and leavers, turnover rate, time-off usage, attendance flags, hiring funnel and time to hire. Executive: read-only all; team lead: own team; recruiter: hiring only. CSV export audited.

**4.5 Security review**
> Run a security review of the whole codebase against CLAUDE.md: every action/query calls authorize(); authz tests cover all roles; no supabase-js data queries from the client; RLS enabled on every table; no secrets in NEXT_PUBLIC_ vars; sensitive fields encrypted; audit coverage; file upload checks; rate limits; security headers and CSP in next.config; Sentry PII scrubbing; dependency audit. Produce a findings list and fix each.

---

## Phase 5 — Migration and cutover (weeks 19–21)

**Gate:** HR signs off the reconciliation report after a 2-week parallel run; then cancel TalentHR.

**5.1 Import tool**
> Build Settings → Import: upload TalentHR CSV/XLSX exports into a quarantined `ops.import_batches` area (HR-only), map columns to ELEVATE fields (save the mapping), validate with Zod, preview errors, then commit. Every imported row carries the batch ID; "Roll back batch" deletes it. Leave balances import as `opening_balance` ledger rows.

**5.2 TalentHR API pull**
> Add a script `scripts/talenthr-import.ts` using the TalentHR API (basic auth with API key, 2,000 requests/minute limit) to fetch what the CSV export lacks: time-off history, documents, applicants. Save documents to storage matched by employee email.

**5.3 Reconciliation report**
> Report comparing TalentHR export vs ELEVATE: headcount (active/terminated), each person's leave balance per type, document counts per person, open applicants. Highlight mismatches. Export as PDF for HR sign-off.

**5.4 Go-live**
> Checklist page for cutover: DNS/domain, production env vars, backups verified (restore test), Sentry alerts, invite emails sent in waves (pilot team first), help page and HR admin runbook in `docs/`.
