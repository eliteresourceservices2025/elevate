# 05 UX and UI

## Principles

1. **One next step.** The home page always shows what to do now (continue module 4, take the exam, you are current until X).
2. **Calm and fair.** No countdown on lessons, no red alarms for being human. There is no timer anywhere: the exam has no time limit, so people can think.
3. **Save everything.** The person can leave at any time and return to the same screen, on a phone or a laptop.
4. **Plain words.** Sentence case, short sentences, no legal terms without a one-line explanation.
5. **Accessible by default** (below).
6. **Same family as ELEVATE.** ERS purple `#6C1ABA` with gold `#E2BE2B` as accent, Source Sans 3 and Inter, light and dark
   themes following the device setting. Learn is lighter and more spacious than the HR app: one column, big type, generous
   spacing.

## Journeys

**New hire.** Account created → onboarding checklist shows "Complete HIPAA training (due in 30 days)" → click **HIPAA
training** (ELEVATE menu or the task) → handoff → home → modules in order → exam → attestation → certificate → ELEVATE shows
the certificate and the task ticks itself.

**Returning learner.** Reminder (in-app, email) → one click opens Learn at the right place → refresher → exam → new
certificate with a later end date.

**Lead.** Dashboard "needs attention" count in ELEVATE → team training status page (passed / not yet / overdue) → nudge.

**HR.** ELEVATE "Training" page: assignments, due and overdue by team and client, retries, evidence report, content studio link.

**Privacy Officer.** Studio (review and publish content), incident inbox in ELEVATE, results for follow-up.

## Learner screens (Learn)

| Screen | Content |
| --- | --- |
| Home | Status card (current / due / overdue, expiry), "Continue" button, module list with checkmarks and time, certificate and record links |
| Module player | Progress bar (screens), content area, "Continue" bar, glossary and notes drawer, exit and save, key points card at the end |
| Knowledge check | Question, options, immediate feedback with reason, retry allowed |
| Exam start | What to expect (questions, time, tries, rules, a note about fairness and honesty), "Start exam" |
| Exam | One question per screen, flag for review, question map, timer, autosave, submit confirmation with unanswered count |
| Result | Pass or not yet, score, topics to review with links, next try time, "talk to HR" if tries are used |
| Attestation | Statement, name and consent |
| Certificate | PDF preview, download, email me a copy, verify link |
| My HIPAA record | Certificates, course versions, dates, training time, download of the record PDF |
| Quick cards | One-page do and don't cards (5-point send check, phishing checklist, remote workspace) |
| Studio (admins) | Course, versions, modules, questions, preview as learner, publish with checklist |

## Studio (content editing)

- A block editor (not a free HTML box): add a block, fill its fields, reorder, preview as learner, see the reading time.
- A publish checklist: every module has a minimum time, every question has rationale and topic, bank coverage by module,
  reading-level check, "reviewed by" field (Privacy Officer), counsel approval date.
- Versions: draft, published, retired; "material change" switch; diff of what changed from the last version.
- Unsaved-changes guard like the rest of ELEVATE.

## Copy rules

- Address the person as "you". Say "VA" or "team member", not "workforce member", except in the attestation.
- Never shame or threaten. "You haven't finished yet" not "You failed to comply".
- Errors say what happened and what to do next ("Your answers were saved. Refresh to continue.").
- Reminders name the course and the date, never a score.

## Accessibility (WCAG 2.2 AA target)

- Full keyboard use, visible focus, skip link, logical headings, landmarks.
- Contrast 4.5:1 (gold is for fills and accents, not text on white).
- Every non-text item has a text alternative; every video has captions and a transcript; motion respects reduced-motion.
- Exam timer is announced politely at set points, can be reviewed with a screen reader, and HR can grant extra time.
- Touch targets at least 44 px; works from 360 px wide; no horizontal scrolling.
- Text can be resized to 200% without loss; no content depends on colour alone.
- Each release runs an automated check (axe) and a manual keyboard and screen-reader pass.

## Low-bandwidth and device reality

Many learners work on home connections in the Philippines. Pages are light (no third-party scripts, fonts self-hosted),
videos are optional and lazily loaded, progress saves in small requests, and a lost connection shows "saved up to here" and
resumes without losing the exam answers entered so far (they are stored locally until they sync, then discarded; exam
**time still comes from the server**).

## Empty, loading and error states

- First visit: a welcome explaining the 3 steps, how long it takes and that progress saves.
- No assignment: "You have no training assigned" with the way to ask HR.
- Offline: "You are offline. Your progress is saved up to here."
- Handoff failed or expired: "Your sign-in link expired. Open HIPAA training from ELEVATE again."
- Exam in progress elsewhere: "You have an exam open on another device. Continue it here?"
