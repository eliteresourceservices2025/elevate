# 04 Course and exam

## Tracks

| Track | Who | Modules | Exam |
| --- | --- | --- | --- |
| **Full** | People assigned to a client flagged "handles patient information" and anyone whose job touches client data | All 8 core modules + any client add-ons | 25 questions |
| **Essentials** | Internal staff with no client data (finance, HR, recruiting, leadership) | Modules 1, 2, 3, 6 (phishing) and 7: foundations, PHI, privacy, phishing, incidents | 15 questions |
| **Refresher** | Anyone renewing within 60 days before or after expiry | Changed modules plus a "what you should already know" recap | 15 questions |

Pass mark for every track: **85%**. The track is resolved by ELEVATE from the person's client assignments (a new
`core.clients.handles_phi` setting HR maintains); a person can be moved by hand with a reason.

## Core curriculum (8 modules, about 85 minutes)

Original text, drafted from HHS/OCR public guidance, then reviewed. The sample's list is a starting point, not a script.

| # | Module | Learning goals (plain language) | Min. time |
| --- | --- | --- | --- |
| 1 | HIPAA foundations and ERS's role | Who the parties are (covered entity, business associate, subcontractor, workforce); where ERS and a VA sit; why "I can see it" is not "I may use it" | 9 |
| 2 | PHI, ePHI and identifiers | What counts, the 18 identifier families, context, screenshots and paper, de-identification limits | 10 |
| 3 | Privacy Rule and minimum necessary | Use vs disclosure vs request, treatment/payment/operations awareness, the ERS 5-point send check (who, what, why, where, how) | 11 |
| 4 | Security Rule and safeguards | Administrative, physical, technical safeguards; access control, audit controls, transmission security; passwords and MFA | 12 |
| 5 | Remote work and device security | Home workspace, screen privacy, shared devices, networks, approved systems, lost devices | 14 |
| 6 | Phishing and social engineering | Spotting and reporting, vishing, MFA fatigue, safe handling of attachments and links | 11 |
| 7 | Privacy and security incidents | What an incident is, speed matters, how to report in ELEVATE, no cover-ups, breach basics, sanctions awareness | 8 |
| 8 | Scenario lab | Mixed, realistic situations that combine modules; certification readiness | 10 |

Minimum time per module is **60% of the estimate** (rounded), enforced on the server; the player shows the estimate, not the
minimum.

## Lesson format

- A module is 8 to 15 short screens: a point, a plain example, a "what would you do" scenario, and a 2 to 4 question knowledge
  check (feedback is immediate and **not graded toward the exam**).
- Each screen is readable in under a minute, carries one idea, and ends with an action (continue, choose, check).
- **Scenarios** use the ERS voice and invented people; feedback explains the reason, not just right or wrong.
- **Motion graphics and narrated slides** only for topics that need a visual (for example the data path of a message, spotting a
  phishing email, a remote workspace). Every video has captions, a transcript and a reduced-motion alternative.
- A "key points" card ends each module and feeds the quick-reference cards.
- A glossary opens in a side panel from any term.

## Pacing rules

1. Modules unlock in order; the exam unlocks when every module for the track is complete.
2. A module completes when all screens were opened, its knowledge check was answered, and the server-measured active time
   reached the minimum.
3. Time is credited by **heartbeats** (one per 30 seconds while the page is visible and there was input in the last 5 minutes).
   No input for 5 minutes shows the activity prompt; if ignored, time stops counting.
4. Progress is saved after every screen; closing the tab and returning resumes at the same place, on any device.
5. Re-reading a completed module is always allowed and does not affect anything.

## Exam engine

| Rule | Value (adjustable by HR in settings, with audit) |
| --- | --- |
| Questions | 25 (Full), 15 (Essentials, Refresher), stratified by topic |
| Pass mark | 85% |
| Time limit | 30 minutes (Full), 20 minutes (short) |
| Tries | 3, then HR grants more (reason required; counted in `retry_grants`) |
| Wait after a failed try | 1 hour, and the missed topics' modules must be reopened |
| Question types | Single answer, multiple answers (all or nothing), true/false, scenario best-answer |
| Bank size | 80 built (10 per module; the Essentials pool is 50), each tagged by topic and module, each with a rationale. A lint test (`apps/learn/src/content/hipaa/content.test.ts`) checks every question |
| Accommodation | HR can grant extra time (a retry grant of type "time") |

Question quality rules (also checked by an automated content lint): one correct idea, plausible distractors, no "all of the
above", no trick wording, reading level around grade 8, no patient data, rationale present, topic and module tag present,
no duplicate stems, at least 3 questions per module in the bank.

## Attestation

Shown after passing, before the certificate. Plain text of a **Confidentiality and HIPAA responsibility statement**
(counsel-approved), versioned; the person confirms by typing their name and ticking consent. Stored insert-only with the
statement version, time, IP and sign-in methods, like ELEVATE's policy acknowledgments.

## Certificate

- Reference `HC-YYYY-XXXXXX`; holder's name, course and version, track, issue date, **expiry date (12 months)**, ERS company
  name and the Privacy Officer's name and title as issuer.
- PDF drawn with `pdf-lib` (Helvetica; non-Latin text becomes "?", the same limitation as ELEVATE's other PDFs). The file's SHA-256
  is stored; the PDF is regenerated on request and checked against it.
- **Check page** `/verify`: enter the reference and the holder's full name; the answer is valid / expired / not found and the
  dates. Nothing is shown without both fields.
- Wording: "completion of ERS HIPAA training". HIPAA has no official certification; we never imply one.
- A certificate can be **revoked** by HR or the Privacy Officer with a reason (for example a finding of cheating); the check page
  then says revoked.
- Emailed copy: a link to the signed-in record and the PDF; no scores.

## Renewals and updates

- At 60 days before expiry the person's renewal assignment opens (Refresher). Reminders at 30 days, 7 days and the date.
- Missing the date: the certificate shows "expired", the person and lead and HR are told weekly; the person keeps working but
  the client-assignment readiness shows "HIPAA expired".
- **Version change:** HR marks a published version as "material". Affected people get an **update module** (just what changed
  plus 5 questions) with a due date, not a full retake. A non-material change creates no assignment.

## Micro-drills (release 3)

A two-minute scenario each quarter (phishing spotting, 5-point send check). They are nudges: a result is stored, nothing fails,
and only aggregate statistics are shown to HR.

## Weak-topic recap and course-improvement statistics

- The person sees topics they missed with links back to the lessons.
- HR sees, per question and per topic, how often it was missed and how long modules take, **only for groups of 5 or more**
  (smaller groups merged or hidden, as in ELEVATE analytics). No per-person ranking.
