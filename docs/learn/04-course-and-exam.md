# 04 Course and exam

## Tracks

| Track | Who | Modules | Exam |
| --- | --- | --- | --- |
| **Full** | People assigned to a client flagged "handles patient information" and anyone whose job touches client data | All 7 modules + any client add-ons | 15 questions |
| **Essentials** | Internal staff with no client data (finance, HR, recruiting, leadership) | Modules 1, 2, 3 and 6: foundations, PHI, privacy, incidents | 15 questions |
| **Refresher** | Anyone renewing within 60 days before or after expiry | The same four modules (a changed-modules recap comes with release 3) | 15 questions |

Pass mark for every track: **80%**, with 15 questions, to match the organization's existing HIPAA course. The track is resolved
by ELEVATE from the person's client assignments (a new `core.clients.handles_phi` setting HR maintains); a person can be moved
by hand with a reason.

**This course is about HIPAA only.** General cybersecurity habits (phishing and social engineering, passwords and sign-in codes,
updates, home network, public Wi-Fi) are a separate course for the organization, "Cybersecurity basics for the ERS team"
(`apps/learn/src/content/cybersecurity`, 8 modules, its own 15-question exam at 80%, sources in `09-cybersecurity-sources.md`). HIPAA's own requirement that a workforce
is trained on malicious software and password management is covered in Module 4 in HIPAA terms, with a pointer to that course.

## Core curriculum (7 modules, about 80 minutes; version 2)

Original text, drafted from HHS/OCR public guidance and the regulations (every claim is traced in `08-source-check.md`), with the
topic coverage compared against the organization's HIPAA course. Nothing is copied from another course.

| # | Module | Learning goals (plain language) | Min. time |
| --- | --- | --- | --- |
| 1 | HIPAA foundations and ERS's role | What HIPAA is and how it grew; who is who (covered entity, business associate, subcontractor, workforce); the chain of trust and what the business associate agreement asks; where ERS and a VA sit; how ERS runs its program; why "I can see it" is not "I may use it"; who enforces and what happens | 13 |
| 2 | PHI, ePHI and identifiers | What counts, the 18 identifier families, context, screenshots, paper and spoken PHI, de-identification limits (including file names and photo details) | 10 |
| 3 | Privacy Rule and minimum necessary | Use vs disclosure vs request, treatment/payment/operations, written authorization, when police, courts or agencies ask, minimum necessary, incidental disclosures, patient rights, state laws as a floor, the ERS 5-point send check | 15 |
| 4 | The Security Rule | Confidentiality, integrity and availability; administrative, physical and technical safeguards; required vs addressable; unique logins, passwords and multi-factor sign-in, access that ends with the work, audit logs, transmission, backups; what HIPAA trains the workforce on; the proposed update | 13 |
| 5 | Protecting patient information where you work | Workstation use and security, approved systems only, saving/printing/photographing, devices and media (disposal and reuse), lost devices, working away from your usual space | 9 |
| 6 | Privacy and security incidents | What an incident is and what usually goes wrong, breach and the presumption, why speed matters, what to do and not do, encryption, no retaliation | 9 |
| 7 | Scenario lab | Mixed, realistic situations that combine the modules; readiness check | 10 |

Minimum time per module is **40% of the estimate** (lowered from 60% on 2026-10-13: a fast reader was kept waiting) (rounded), enforced on the server; the player shows the estimate, not the
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
| Questions | 15 on every track, spread across the track's modules, unseen questions first |
| Pass mark | 80% (matches the organization's existing course) |
| Time limit | **None.** People take the exam at their own pace (a course can still set one by adding `minutes` to its exam configuration; the database then enforces it) |
| Tries | 3, then HR grants more (reason required; counted in `retry_grants`). The existing course allows unlimited tries; ours caps at 3 so a person must go back to the lessons between tries |
| Wait after a failed try | 1 hour, and the missed topics' modules must be reopened |
| Question types | Single answer, multiple answers (all or nothing), true/false, scenario best-answer |
| Bank size | 83 built across the 7 modules (the Essentials pool is 51), each tagged by topic and module, each with a rationale. A lint test (`apps/learn/src/content/content.test.ts`) checks every question of every course |
| Accommodation | HR can grant extra time (a retry grant of type "time") |

Question quality rules (also checked by an automated content lint): one correct idea, plausible distractors, no "all of the
above", no trick wording, reading level around grade 8, no patient data, rationale present, topic and module tag present,
no duplicate stems, at least 3 questions per module in the bank.

## Attestation

Shown after passing, before the certificate. Plain text of a **Confidentiality and HIPAA responsibility statement**
(counsel-approved), versioned; the person confirms by typing their name and ticking consent. Stored insert-only with the
statement version, time, IP and sign-in methods, like ELEVATE's policy acknowledgments.

## Certificate

- Reference `ERSHC-YYYY-XXXXXX` (HIPAA) or `ERSCSC-YYYY-XXXXXX` (Cybersecurity basics; other courses `ERSLN-`; migration 0058); holder's name, course and version, track, issue date, **expiry date (12 months)**, ERS company
  name and the Privacy Officer's name and title as issuer.
- PDF drawn with `pdf-lib` (Helvetica; non-Latin text becomes "?", the same limitation as ELEVATE's other PDFs). The file's SHA-256
  is stored; the PDF is regenerated on request and checked against it.
- **Check page** `/verify`: enter the reference and the holder's full name; the answer is valid / expired / not found and the
  dates. Nothing is shown without both fields.
- Wording: "completion of ERS HIPAA training". HIPAA has no official certification; we never imply one.
- A certificate can be **revoked** by HR or the Privacy Officer with a reason (for example a finding of cheating); the check page
  then says revoked.
- **PDF certificate:** drawn with `pdf-lib` (`certificate-pdf.ts`, A4 landscape, ERS purple and gold, holder, course, issued and valid-until dates, reference, the verify address, and a line that this is ERS training completion, not an official certification). The Download PDF button on the certificate page calls `/api/certificate/<assignment id>` (own certificate only, `no-store`, revoked certificates refused). The renderer file exists in two places (Learn and ELEVATE) and a test checks they are identical.
- **Emailed copy:** when `learn-sync` records the certificate in Certificates it queues one email (kind `invite`, dedupe key `learn-certificate:<id>`, sent within the daily budget) with the PDF attached (base64; `EmailAttachment.base64`). The email text says only that the certificate is attached; no scores, no course content.

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
