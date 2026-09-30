# ELEVATE — HRIS Architecture Plan

*ELITE Employee & VA Engagement / Talent Experience*

Sep 29, 2026 · @Lorie

## Executive summary

ELEVATE replaces TalentHR ($300/month) with an ERS-owned HRIS that runs for about **$45/month**, saving roughly **$3,060 a year**, while keeping every employee record encrypted, access-controlled and audited.

It is one Next.js application (a modular monolith) on Vercel Pro, with Supabase Pro (Singapore region) for the database, sign-in and file storage. ELEVATE has its own web time clock, and Jibble stays only for screenshots, switched on and off by ELEVATE's clock. ELEVATE becomes the single place for people data, time off, hiring, onboarding, documents, reviews and analytics. Payroll computation is out of scope: ELEVATE exports hours.

**Goals**

1. Cover everything the team uses TalentHR for, plus the gaps: VA-specific records, client assignments, a built-in time clock and compliance tracking.
2. Meet the Philippine Data Privacy Act (RA 10173) and what US healthcare clients expect of VA staff records.
3. Stay buildable and maintainable by one developer with Claude Code.

**Key decisions**

| Area | Decision | Why |
| --- | --- | --- |
| Framework | Next.js 16.3 (App Router, Server Actions), TypeScript | Current stable; one codebase for UI and API |
| Hosting | Vercel Pro, $20/month | Hobby plan forbids commercial use |
| Database, auth, files | Supabase Pro, $25/month, Singapore | Daily backups, no pausing, 8 GB DB, 100 GB files, MFA included |
| Sign-in | Google or email + password, MFA required for everyone | Both options you asked for; MFA closes stolen-password risk |
| Attendance | ELEVATE's own web time clock; Jibble Free kept only for screenshots | Browsers can't take screenshots; Jibble Free does it for unlimited users at $0 |
| E-signatures | Built in: "ELEVATE Sign" with sealed PDF + audit certificate | Meets RA 8792 for contracts and NDAs without a second server or per-document fees |
| Payroll | Out of scope; hours export only | Avoids tax-computation liability |
| HIPAA | ELEVATE holds employment records only, never patient data | Employment records are excluded from HIPAA's PHI definition |

## Scope: modules and process categories

The first release covers 4 module groups split into 15 processes, plus 3 platform services every module uses. Payroll computation, a client portal and native mobile apps are out of scope (the web app is mobile-responsive).

| Group | Process | What it covers | Main users |
| --- | --- | --- | --- |
| A. Core HR | A1 People records | Profile, employment details, government IDs (TIN, SSS, PhilHealth, Pag-IBIG), emergency contacts, payout details, client assignment, custom fields, change history | HR, employee (own) |
| A. Core HR | A2 Organization | Departments, teams, positions, reporting lines, interactive org chart | HR, everyone (view) |
| A. Core HR | A3 Document vault | Per-person files, company policies, expiry tracking (NBI clearance, HIPAA training certificates, IDs) | HR, employee (own) |
| A. Core HR | A4 Announcements | Company posts, policy acknowledgments with read receipts | HR, everyone |
| B. Time & attendance | B1 Time off | Leave types, accrual policies, balances, requests, 2-level approval, PH and US holiday calendars, team calendar | Everyone, leads, HR |
| B. Time & attendance | B2 Attendance | Web time clock (clock in/out, breaks, IP or location check, optional selfie, idle prompts); lates, absences, overtime; hours export for payroll | HR, leads |
| B. Time & attendance | B3 Schedules | Shift per person in the client's time zone, rest days, schedule changes | HR, leads |
| C. Talent lifecycle | C1 Recruiting (ATS) | Job openings, public careers page and apply form, pipeline board, interviews on Google Calendar, scorecards, offers | Recruiter, HR, leads |
| C. Talent lifecycle | C2 Onboarding | Checklist templates per role, task owners and due dates, document collection, contract signing, equipment issue | HR, new hire, IT/admin |
| C. Talent lifecycle | C3 Offboarding | Resignation or separation, clearance checklist, asset return, access revocation, exit interview, final hours export | HR, leads |
| C. Talent lifecycle | C4 E-signatures | Templates, signing order, sealed PDF with audit certificate | HR, signers |
| D. Engagement & insight | D1 Performance | Review cycles, probation (regularization) reviews, self and manager reviews, goals | Leads, HR, employee |
| D. Engagement & insight | D2 Safe Voice | Anonymous reports, case code for follow-up, HR case handling | Anyone, HR |
| D. Engagement & insight | D3 Assets | Inventory, QR tags, assignment and return history | HR/admin |
| D. Engagement & insight | D4 People analytics | Headcount, turnover, time-off usage, attendance, hiring funnel | Executive, HR |

**Platform services (used by every module):** P1 identity, roles and permissions · P2 notifications (in-app and email) · P3 audit log and data-retention jobs.

## Users, roles and permissions

Access is decided by role plus scope: every permission is limited to **own** record, **team** (people who report to you) or **all**. A person can hold more than one role (a team lead is also an employee), and the widest matching permission applies.

| Capability | Super Admin | HR Admin | Team Lead | Recruiter | Executive | Employee/VA |
| --- | --- | --- | --- | --- | --- | --- |
| View people directory and org chart | All | All | All | All | All | All |
| View full profile | All | All | Team (no sensitive fields) | — | — | Own |
| Sensitive fields (gov IDs, payout, pay rate) | All | All | — | — | — | Own, masked |
| Edit profile | All | All | — | — | — | Own contact info (HR approves) |
| Documents | All | All | — | — | — | Own |
| Approve time off | All | All (final) | Team (first level) | — | — | — |
| Attendance and schedules | All | All | Team | — | Summary | Own |
| Recruiting (ATS) | All | All | Assigned openings | All | Summary | — |
| Onboarding / offboarding | All | All | Team tasks | Hand-off only | — | Own tasks |
| Performance reviews | All | All | Team | — | Summary | Own |
| Safe Voice cases | Designated handlers only | Designated handlers only | — | — | Counts only | Submit, follow up by case code |
| Assets | All | All | Team (view) | — | — | Own |
| People analytics | All | All | Team | Hiring only | All (read-only) | — |
| Settings, roles, audit log | All | Policies and templates | — | — | — | — |

**Rules the code enforces**

- Every server action calls one `authorize(user, action, resource)` check; the UI hiding a button is never the only guard.
- Sensitive fields are encrypted in the database and only decrypted for roles in the matrix; each view of them is written to the audit log.
- Safe Voice handlers are named individually, so a Super Admin does not see reports by default.
- Role changes and every approval are logged with who, what, when and the before/after values.

## System architecture and tech stack

ELEVATE is a modular monolith: one Next.js app deployed to Vercel, where each module (people, time, recruiting and so on) lives in its own folder with its own database tables, server actions and permission rules. The browser never talks to the database directly; every read and write goes through server code that checks permissions first.

&#91;embedded content: system architecture · app, data layer, outside services\]

Staff and public pages reach the same app; only server code talks to Supabase and the outside services, and only after `authorize()` has checked role and scope.

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16.3, React 19, TypeScript | Server Components by default; Server Actions for writes; Route Handlers for webhooks and cron |
| UI | Tailwind CSS v4, shadcn/ui (Radix), lucide icons | ERS-branded theme tokens |
| Tables and grids | TanStack Table | Sorting, filters, column visibility; server-side paging |
| Charts | shadcn charts (Recharts) | Analytics dashboards |
| Org chart | React Flow (xyflow) + d3-hierarchy layout | Free, zoomable, no licence limits |
| Drag and drop | dnd-kit | ATS pipeline board, checklist ordering |
| Forms | React Hook Form + Zod | One Zod schema validates in browser and on server |
| Client state | URL state (nuqs) + TanStack Query only where a grid needs live refresh | No Redux or Zustand needed |
| Database | Supabase Postgres, Singapore region | Connection through the Supabase pooler |
| ORM and migrations | Drizzle ORM + drizzle-kit | Typed SQL, versioned migrations in Git |
| Sign-in | Supabase Auth: Google OAuth, email + password, TOTP MFA | MFA required (AAL2) before any page loads |
| Files | Supabase Storage, private buckets | Short-lived signed URLs; no public files except the careers page |
| Background jobs | Inngest (free: 50,000 executions/month) + Vercel Cron | Jibble clock mirroring, missed clock-out alerts, reminders, approval escalations, retention clean-up |
| Email | Resend (free: 3,000/month, 100/day) + React Email | In-app notifications first; email for approvals and digests |
| PDFs and signing | pdf-lib, @react-pdf/renderer, react-signature-canvas | Offer letters, certificates of employment, sealed signed PDFs |
| Rate limiting | Upstash Redis (free tier) | Login, careers form, Safe Voice |
| Monitoring | Sentry (free tier), Vercel logs | Errors with personal data scrubbed |
| Testing | Vitest, Playwright | Permission tests for every role |

The initial research suggested Redux, BullMQ and a VPN. They are dropped: Server Components remove most client state, BullMQ needs an always-on Redis worker that Vercel does not run, and Cloudflare Zero Trust is free only up to 50 users (then $7 per user a month), which would cost more than TalentHR at 125+ people.

## Data model

Everything hangs off one `employees` table, with about 55 tables across 5 Postgres schemas so each module's data stays separate. All tables use UUID keys, `created_at`/`updated_at`, `created_by`, and soft delete (`archived_at`) so history is never lost.

&#91;embedded content: core data model · main tables and relationships\]

| Schema | Tables | Key relationships |
| --- | --- | --- |
| `core` | users, roles, user\_roles, employees, employee\_sensitive (encrypted), employment\_history, departments, teams, positions, clients, client\_assignments, emergency\_contacts, custom\_field\_defs, custom\_field\_values | users 1–1 employees; employees → manager (self-reference) for the org chart; employees → many client\_assignments |
| `docs` | documents, document\_types, policies, policy\_acknowledgments, announcements, esign\_envelopes, esign\_signers, esign\_events | documents → employee or company; envelopes → signers → events |
| `time` | leave\_types, leave\_policies, leave\_balances, leave\_ledger, leave\_requests, leave\_approvals, holidays, schedules, clock\_events, attendance\_days, jibble\_link\_log | leave\_ledger is append-only: balance = sum of ledger rows; attendance\_days → employee + date (unique) |
| `talent` | job\_openings, candidates, applications, pipeline\_stages, interviews, scorecards, offers, checklist\_templates, checklist\_tasks, onboarding\_cases, offboarding\_cases, review\_cycles, reviews, goals, assets, asset\_assignments | application → candidate + opening; a hired candidate becomes an employee; onboarding\_case → employee → tasks |
| `ops` | notifications, audit\_log, safevoice\_reports, safevoice\_messages, import\_batches, settings | audit\_log is insert-only; safevoice tables hold no user ID, IP or device data |

**Design rules**

- Leave balances come from an append-only ledger (accrual, usage, adjustment, carry-over), so any balance can be explained line by line.
- Government IDs, payout details and pay rates live in `employee_sensitive`, encrypted in the app with AES-256-GCM before they reach the database.
- Candidates are separate from employees until hired, so applicant data can be deleted on its own retention schedule.
- Every table has Row Level Security turned on with no public policies, so the Supabase public API key can read nothing even if leaked.

## Security, privacy and compliance

Security is built into the design, not added at the end: every user has 2-step verification, sensitive data is encrypted twice, every sensitive action is logged, and real employee data exists only in production.

### Security controls

| Area | Control |
| --- | --- |
| Sign-in | Google or email + password (12+ characters, leaked-password check); authenticator-app MFA required for every account before the app loads |
| Sessions | Expire after 8 hours idle; all sessions revoked the moment someone is offboarded or a role changes |
| Permissions | One `authorize()` check in every server action; automated tests for each role; the Supabase service key is server-only |
| Database | Row Level Security on every table with no public policies; the browser never queries the database |
| Encryption | TLS in transit; Supabase AES-256 at rest; government IDs, payout details and pay rates also encrypted by the app (AES-256-GCM, versioned keys for rotation) |
| Files | Private buckets; links expire after 60 seconds; allowlist of PDF, JPG, PNG, DOCX up to 10 MB |
| Web attacks | Strict security headers and CSP, Zod validation on every input, Server Action CSRF protection, rate limits on login, careers and Safe Voice forms, Vercel firewall |
| Audit | Insert-only log of logins, role changes, approvals, exports, and every view of sensitive fields |
| Backups | Supabase daily backups (7 days) plus a weekly encrypted database export to separate storage via GitHub Actions |
| Code | Dependabot and secret scanning on GitHub; no real data in development or staging |

### Philippine Data Privacy Act (RA 10173)

| Requirement | How ELEVATE meets it |
| --- | --- |
| Transparency | Privacy notice shown on first login and on the careers form; acknowledgment stored with date and version |
| Proportionality | Only fields HR actually uses are collected; Jibble screenshots stay in Jibble and are never copied into ELEVATE |
| Sensitive personal information (government IDs, health details in leave documents) | Field encryption, HR-only access, access logged |
| Data subject rights | Employees see and download their own data and request corrections in the app |
| Retention | Configurable per record type (for example, rejected applicants purged after a set period); an automatic job deletes or anonymizes expired data. Periods to be confirmed with counsel |
| Breach management | Audit trail plus an incident runbook to notify the National Privacy Commission within 72 hours ([NPC Circular 16-03](https://www.alburolaw.com/procedure-for-notifying-the-national-privacy-commission-in-case-of-data-privacy-breach/)) |
| Registration | Mandatory at 250+ employees or 1,000+ people whose sensitive data is processed ([NPC Circular 2022-04](https://www.alburolaw.com/registration-of-data-processing-system-and-designation-of-data-protection-officer-mandated-by-npc-circular-no-2022-04/)); applicants count toward the 1,000, so ERS should name a Data Protection Officer now |

**Activity monitoring.** Employers may monitor staff for declared purposes, but the NPC has found random screenshots and keystroke logging excessive when employees were not told ([L&E Global summary](https://leglobal.law/2026/05/29/philippines-employee-monitoring-and-the-right-to-privacy-key-considerations-under-the-data-privacy-act-of-2012/)). Before using Jibble screenshots, ERS needs a written monitoring policy each person signs in ELEVATE, screenshots only while clocked in, Jibble's blur setting on, and a short retention period.

**Screenshots and patient data.** VAs who work in US healthcare clients' systems will have patient records in their screenshots. Keeping screenshots only in Jibble, never in ELEVATE, keeps ELEVATE free of patient data; in Jibble, turn on blurring and keep the shortest retention period.

### US healthcare clients (HIPAA)

HIPAA's definition of protected health information excludes employment records an organization holds as an employer ([USA HIPAA](https://www.usahipaa.com/blog/does-hipaa-apply-to-employers)), so ELEVATE itself does not need a HIPAA plan or a Business Associate Agreement. It must never hold client patient data: upload screens say so, and no module has free-text fields for client work. What US clients do expect is proof about the VAs, so ELEVATE tracks per person: HIPAA training certificates and expiry, signed confidentiality agreements per client, background checks, and a per-client compliance export.

### E-signatures (RA 8792)

The Electronic Commerce Act accepts electronic signatures on employment contracts when the signature identifies the signer, shows intent, is protected against tampering and is tied to the document ([BlueInk summary](https://www.blueink.com/electronic-signature-law/philippines)). Notarized documents, affidavits and deeds still need wet ink. ELEVATE Sign covers each requirement in section C4 of the process flows.

## Integrations

ELEVATE runs its own web time clock for attendance, and Jibble Free stays only for screenshots, because no browser app can capture screenshots and no other free tool covers 125+ people.

### Attendance and monitoring options

| Tool | Free plan | Screenshots / activity | Fit |
| --- | --- | --- | --- |
| [Jibble](https://www.timely.com/blog/jibble-pricing/) (current) | Unlimited users; 2 geofences, 1 work schedule | Screenshots, GPS, face recognition included free | **Kept for screenshots only.** Paid Premium is $4.49–$5.99 per user a month if you later need unlimited schedules |
| [ActivTrak](https://www.insightful.io/blog/14-free-open-source-time-tracking-employee-monitoring-software) | 3 users, 30 days of history | Activity yes; screenshots paid only | Too small |
| [Clockify](https://www.insightful.io/blog/14-free-open-source-time-tracking-employee-monitoring-software) | 5 users | Screenshots need Pro ($9.99 per user a month) | Too small |
| [ActivityWatch](https://www.insightful.io/blog/14-free-open-source-time-tracking-employee-monitoring-software) | Open source, unlimited | App and window tracking, stored only on each laptop | No central view for HR |
| Build it into ELEVATE | — | Clock-in, breaks, IP or location check, selfie, idle prompts; no screenshots (browsers can't) | Chosen for time and attendance |

### ELEVATE time clock and the Jibble link

- **ELEVATE is the record of time.** Clock in, clock out and breaks happen in ELEVATE and are stored in `clock_events`; hours, lates and overtime all come from there.
- **Jibble only captures screenshots.** When someone clocks in or out in ELEVATE, ELEVATE clocks them in or out of Jibble through its API, so the Jibble desktop app runs screenshots only during work time. Jibble's API supports clock-in and clock-out actions (its [Zapier integration](https://zapier.com/apps/jibble/integrations/zapier-tables/1648671/create-new-zapier-tables-records-from-new-jibble-timeentries) exposes them), and credentials come from Organization Settings → API Credentials ([API docs](https://docs.api.jibble.io/)).
- **To test first:** that a clock-in made through the API starts screenshots in the Jibble desktop app. If it does not, VAs clock in to both apps, and a nightly job compares ELEVATE with Jibble timesheets and flags gaps.
- Every Jibble call is logged in `jibble_link_log` and retried on failure. Screenshots and GPS stay in Jibble and are never copied into ELEVATE.

### Google Workspace

- **Sign in with Google** through Supabase Auth; works with company or personal Gmail accounts.
- **Calendar:** recruiters and HR connect their own Google Calendar once, so interview invites and approved leave appear with Meet links. Everyone else receives standard calendar invites (.ics) by email, which work in any calendar.
- If ERS moves to one company Workspace domain later, login can be restricted to that domain with one setting.

### Email

Resend sends approval requests, reminders and daily digests from a verified ERS sending domain. The free plan's 100 emails a day is enough if announcements and routine updates stay in-app; upgrade to Resend Pro ($20/month, 50,000 emails) only if daily sends regularly pass 100 ([pricing](https://resend.com/pricing)).

### TalentHR (one-time)

TalentHR offers CSV/XLSX export and an API (basic auth, 2,000 requests a minute) used for the migration in section 10 ([API docs](https://apidocs.talenthr.io/)).

## Process flows

Each process below has a trigger, its steps, and the record it produces. Steps that wait on a person send an in-app notification and, if untouched after 2 working days, an email reminder.

### A. Core HR

**A1 People records.** Trigger: new hire, or a change request.

1. HR creates the record (or it is created automatically from a hired candidate).
2. The employee completes personal details, emergency contacts, government IDs and payout details in a guided form.
3. HR verifies against uploaded ID documents and marks the record verified.
4. Later changes by the employee (address, phone, bank) go to HR as a change request; approved changes write to `employment_history` with before/after values.

**A2 Organization.** HR maintains departments, teams and positions; setting a person's manager updates the org chart instantly. Moving someone to a new team or client is a dated change, so history shows who reported to whom and when.

**A3 Document vault.** HR or the employee uploads a file, picks a document type, and sets an expiry date if the type needs one. 30 and 7 days before expiry, the employee and HR are reminded.

**A4 Announcements.** HR posts an announcement; if marked "requires acknowledgment", each person must click acknowledge, and HR sees who has not.

### B. Time and attendance

**B1 Time off.**

1. Employee picks a leave type and dates; ELEVATE shows the balance, holidays and teammates already off.
2. Team lead approves or declines (level 1).
3. HR gives final approval (level 2); some leave types can be set to skip level 2.
4. On approval, a usage row is written to the ledger, the team calendar updates, and a calendar invite goes out.
5. Cancelling approved leave reverses the ledger row. Monthly or yearly accruals run automatically from each leave policy.

&#91;embedded content: time-off approval flow · 2 levels\]

**B2 Attendance (ELEVATE time clock).**

1. The employee clicks Clock in. ELEVATE records the time, IP address and, if location is allowed, the approximate location; an optional selfie can be required per team.
2. ELEVATE checks the IP against office or allowed ranges and flags anything outside them for the team lead.
3. ELEVATE clocks the person into Jibble so screenshots start.
4. Breaks and lunch are started and ended the same way. In Chrome and Edge, an idle prompt asks "Still working?" after a set time with no activity in ELEVATE.
5. Clock out stops the day and the Jibble timer. A missed clock-out triggers an alert after the shift ends, and the entry needs lead approval.
6. Each night ELEVATE builds `attendance_days` from the clock events, compares them with the schedule and approved leave, and flags lates, absences and overtime. Team leads review flags; HR exports approved hours per pay period as CSV for payroll.

**B3 Schedules.** HR assigns each VA a shift in the client's time zone with rest days. ELEVATE shows it in both the client's time zone and Philippine time, and changes are dated.

### C. Talent lifecycle

**C1 Recruiting.**

1. HR or a recruiter opens a job with its hiring team and pipeline stages.
2. Candidates apply on the public careers page (privacy notice, file upload, rate limit, spam check).
3. The recruiter moves candidates across the board: Applied, Screening, Interview, Assessment, Offer, Hired or Rejected.
4. Interviews are scheduled on Google Calendar; interviewers submit scorecards.
5. An offer letter is generated from a template and signed with ELEVATE Sign.
6. Marking a candidate Hired creates the employee record and starts onboarding.

**C2 Onboarding.** Starting onboarding copies the checklist template for that role into tasks with owners (HR, IT/admin, team lead, new hire) and due dates relative to the start date. Tasks include signing the contract, NDA and policies, uploading pre-employment documents, issuing equipment and a welcome meeting. The case closes when every required task is done.

**C3 Offboarding.** A resignation or separation opens an offboarding case with the last working day. The clearance checklist covers asset return, access revocation on the last day, turnover notes, exit interview and final hours export. ELEVATE disables the account automatically at the end of the last working day.

**C4 E-signatures (ELEVATE Sign).**

1. HR picks a template or uploads a PDF, places signature fields and sets the signing order.
2. Each signer, already signed in with MFA, reviews the document and ticks a consent to sign electronically.
3. They type or draw their signature.
4. When the last signer finishes, ELEVATE stamps the signatures, adds a certificate page (names, emails, timestamps, IP addresses, MFA method) and stores the SHA-256 fingerprint of the final PDF.
5. Anyone can later re-check the fingerprint to prove the file has not changed.

### D. Engagement and insight

**D1 Performance.** HR launches a review cycle (quarterly, annual, or probation) and picks a template. Employees write a self-review, the team lead writes theirs, and HR calibrates and shares the result. Probation reviews are scheduled automatically at month 3 and month 5 so regularization decisions are made before month 6.

**D2 Safe Voice.**

1. Anyone opens the Safe Voice page. It is served separately, so no login session, cookie or IP address is recorded with the report.
2. They submit a category and description, with optional attachments that have file metadata stripped.
3. They receive a random case code and passphrase to check replies later.
4. Designated handlers triage the case, message the reporter through the case thread, and close it with an outcome.

**D3 Assets.** HR registers an item and prints its QR label. Assigning it to a person records the date and condition; returns are part of offboarding.

**D4 People analytics.** Dashboards are built from nightly summary tables: headcount by team and client, joiners and leavers, turnover, time-off usage, attendance flags, hiring funnel and time to hire. Executives see these read-only; team leads see their own team.

## Infrastructure, environments and cost

ELEVATE runs for $45 a month ($540 a year) against TalentHR's $3,600 a year.

| Item | Plan | Monthly cost | What it includes |
| --- | --- | --- | --- |
| Vercel | Pro, 1 seat | $20 | $20 usage credit, commercial use allowed, cron jobs, firewall ([pricing](https://vercel.com/pricing)) |
| Supabase | Pro | $25 | 8 GB database, 100 GB files, 100,000 monthly users, daily backups kept 7 days, $10 compute credit ([pricing](https://supabase.com/pricing)) |
| Jibble, Resend, Inngest, Upstash, Sentry, GitHub | Free tiers | $0 | See section 7 for limits |
| Domain | ERS subdomain (decided later) | $0 | Uses the existing ERS domain |
| **Total** |  | **$45** | Savings vs TalentHR: about $255 a month |

**Headroom.** 125 people with 30 documents each at 0.5 MB is about 2 GB of files, 2% of the 100 GB included. Employee data will stay far under the 8 GB database limit for years.

**When costs would rise:** a second developer on Vercel (+$20), Resend Pro if emails pass 100 a day (+$20), or point-in-time database recovery if leadership wants restores to the minute (+$100).

### Environments

| Environment | Where | Data |
| --- | --- | --- |
| Local | Your laptop: Next.js dev server + Supabase CLI (Docker) | Fake seed data only |
| Preview | A Vercel preview URL for every pull request + a Supabase Free project for staging | Fake seed data only |
| Production | Vercel Pro + Supabase Pro, Singapore | Real data |

### Release process

1. Work on a feature branch; GitHub Actions runs lint, type check, unit tests, permission tests and a migration check on every push.
2. Open a pull request; Vercel builds a preview for testing.
3. Merge to `main`; a GitHub Action applies database migrations to production after your manual approval, then Vercel deploys.
4. Roll back with Vercel's instant rollback; migrations are written to be backward-compatible for one release.

## TalentHR migration

All TalentHR data moves in 2 dry runs and 1 final run, with TalentHR kept active until HR signs off that the numbers match.

| Data | Source | Method |
| --- | --- | --- |
| Employee profiles, custom fields, terminated employees | Settings → Import & Export → CSV/XLSX ([help article](https://help.talenthr.io/hc/en-us/articles/8587268826653-How-to-export-your-employee-data-in-TalentHR)) | Import tool with column mapping |
| Departments, positions, managers | Same export + API | Rebuilt before people are loaded |
| Time-off balances and history | API, or TalentHR reports export | Loaded as opening-balance rows in the leave ledger |
| Documents and files | API; manual download for anything the API does not return | Bulk upload matched to people by email |
| Applicants and open jobs | API or export | Only active candidates; closed ones archived as a file |

**Steps**

1. **Map:** list every TalentHR field and its ELEVATE destination; unmapped fields become custom fields.
2. **Dry run 1:** load the export into a quarantined import area in production (HR-only, hidden from the rest of the app). Staging is not used because it must never hold real data.
3. **Reconcile:** a report compares headcount, each person's leave balance and document counts between TalentHR and ELEVATE. HR fixes mismatches at the source.
4. **Dry run 2:** repeat until the report is clean.
5. **Final run:** freeze TalentHR changes for one day, export, import, reconcile, go live.
6. **Archive:** keep a full TalentHR export as an encrypted file for the retention period, then cancel TalentHR at the end of its billing period.

Every import is tagged with a batch ID, so a bad batch can be rolled back in one step.

## Build roadmap

ELEVATE can replace TalentHR in about 21 working weeks, built in 6 phases that each end with a gate HR can check.

&#91;embedded content: build roadmap · 6 phases, 6 gates\]

The weeks are an estimate for one developer working with Claude Code alongside other duties; they are sequential, not calendar dates. Security and permission tests are written in every phase, not saved for the end. TalentHR stays paid until the phase 5 gate passes.

## Risks and open decisions

The biggest risk is that ELEVATE depends on one developer; the plan answers it with documentation, tests and a managed platform that needs no server upkeep.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Single developer (bus factor of 1) | Fixes stall if you are away | CLAUDE.md, architecture docs and tests in the repo; managed hosting with no servers to patch; admin runbook for HR |
| A permission bug exposes data | Privacy breach, NPC notification | Central `authorize()` check, automated tests per role, deny-all database policies, audit log |
| Jibble's desktop app doesn't start screenshots on an API clock-in | VAs have to clock in twice | VAs clock in to both apps; ELEVATE compares the two nightly and flags gaps |
| Emails exceed 100 a day | Some notifications delayed | In-app first, daily digests, Resend Pro at $20 if needed |
| Safe Voice reporter identified | Loss of trust | No session, cookie or IP stored; hosting logs excluded for that route where possible; small categories not shown in stats |
| Scope creep delays cutover | Paying TalentHR longer | Phase gates below; features outside the 15 processes go to a backlog |
| Migration mismatches | Wrong leave balances | 2 dry runs and a reconciliation report before go-live |

**Open decisions**

- [ ] Generate Jibble API credentials and test that an API clock-in starts screenshots in the Jibble desktop app
- [ ] Pick the domain, for example an ERS subdomain
- [ ] Name the Data Protection Officer and the Safe Voice handlers
- [ ] Approve retention periods (applicants, separated employees, audit log) with counsel
- [ ] Write and roll out the monitoring policy before Jibble screenshots are used
- [ ] Share ERS brand colors and logo for the theme

## Sources

Pages opened for this plan, as of September 29, 2026.

- [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines): Hobby is non-commercial only
- [Vercel pricing](https://vercel.com/pricing)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase MFA docs](https://supabase.com/docs/guides/auth/auth-mfa)
- [Next.js 16.3 release](https://nextjs.org/blog/next-16-3)
- [Inngest pricing](https://www.inngest.com/pricing)
- [Resend pricing](https://resend.com/pricing)
- [Jibble API docs](https://docs.api.jibble.io/)
- [Jibble pricing review (Timely)](https://www.timely.com/blog/jibble-pricing/)
- [Free monitoring tools compared (Insightful)](https://www.insightful.io/blog/14-free-open-source-time-tracking-employee-monitoring-software)
- [Cloudflare Zero Trust free plan limits (ZeroMetric)](https://zerometric.net/research/cloudflare-zero-trust-free-plan-limits-2026/)
- [TalentHR API docs](https://apidocs.talenthr.io/)
- [TalentHR export help article](https://help.talenthr.io/hc/en-us/articles/8587268826653-How-to-export-your-employee-data-in-TalentHR)
- [DocuSeal vs Documenso (Verdocs)](https://verdocs.com/blog/docuseal-vs-documenso)
- [Philippine e-signature law (BlueInk)](https://www.blueink.com/electronic-signature-law/philippines)
- [Employee monitoring under the DPA (L&E Global)](https://leglobal.law/2026/05/29/philippines-employee-monitoring-and-the-right-to-privacy-key-considerations-under-the-data-privacy-act-of-2012/)
- [NPC Circular 2022-04 summary (Alburo Law)](https://www.alburolaw.com/registration-of-data-processing-system-and-designation-of-data-protection-officer-mandated-by-npc-circular-no-2022-04/)
- [NPC breach notification summary (Alburo Law)](https://www.alburolaw.com/procedure-for-notifying-the-national-privacy-commission-in-case-of-data-privacy-breach/)
- [HIPAA and employers (USA HIPAA)](https://www.usahipaa.com/blog/does-hipaa-apply-to-employers)

* [Jibble: connecting Zapier (API credentials)](https://www.jibble.io/help/connecting-zapier-with-jibble)

- [Jibble on Zapier: Clock In and Clock Out actions](https://zapier.com/apps/jibble/integrations/zapier-tables/1648671/create-new-zapier-tables-records-from-new-jibble-timeentries)
