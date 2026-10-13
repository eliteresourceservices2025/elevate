# 01 Product and decisions

## Why

ERS provides VAs to US healthcare clients. As a business associate's subcontractor chain, ERS must train its workforce on HIPAA
and be able to **prove** it: who was trained, when, on which version of the course, and when it expires. Higher-ups asked for a
training system inside the ELEVATE family so the whole organization can be trained and tracked in one place.

## Users

| Person | Needs |
| --- | --- |
| Learner (every employee and VA) | A clear path, saved progress, a fair exam, a certificate, quick reference afterwards |
| Team lead | To know who on the team is current or overdue, without seeing scores |
| HR Admin / Super Admin | Assignments, deadlines, reports, evidence for clients, retries, content |
| Privacy Officer (designated person, flag like Safe Voice's handler flag) | Content accuracy, incident reports, escalations |
| Client (indirect) | Proof of workforce training on request |
| Counsel | Review of course text, attestation, retention and wording |

## Scope

**In:** course player, exam, attestation, certificate and public check page, assignments and deadlines, renewals and refresher,
client add-on modules, admin content studio with versioning, HR reports, client evidence report, reminders, incident report form,
My HIPAA record and quick cards, weak-topic statistics, micro-drills, update modules, motion graphics or narrated slides where a
topic really needs a visual.

**Out (for now, deliberately):** webcam or screen proctoring (privacy), pay or hours calculation from training time, per-person
performance scoring, other courses (the app is built to hold them later), a public catalog, marketing pages, accounts for
people outside ERS, SCORM import/export, gamification and leaderboards.

## Decisions made with the owner

1. **Separate app, same ELEVATE sign-in.** `apps/learn`, own Vercel project, own subdomain; ELEVATE accounts and MFA; completion is
   tied to a real person.
2. **Name and address:** ELEVATE Learn at `learn.eliteresourceservices.com`. HIPAA is the first course, so later courses need no
   rename.
3. **Audience:** everyone, with role-based tracks. Overdue is flagged to the lead and HR; it never blocks sign-in or work.
4. **Deadlines:** new hires 30 days from start; renew every 12 months. Reminders at 30 days, 7 days and the due date.
5. **Content:** versioned in the app and edited by HR, Super Admin and the Privacy Officer; a published version is frozen.
   Original text drafted from public HHS/OCR guidance, **reviewed by counsel or the privacy officer before launch**.
6. **Lesson style:** short screens, scenarios and per-module checks; motion graphics or narrated slides only for topics that need
   them.
7. **Pacing:** modules in order, server-measured minimum time per module, an "are you still there?" prompt.
8. **Exam:** server-graded, **15 questions** drawn from a larger bank, **80% to pass** (matching the organization's existing
   course), 3 tries, review between tries, HR can grant more.
8b. **HIPAA only:** the HIPAA course covers HIPAA. General cybersecurity basics (phishing, passwords, home network) are a
   separate course for the organization.
9. **Visibility:** the person and HR see scores; leads see only passed / not yet.
10. **Ending:** responsibility attestation (insert-only), PDF certificate with a public check page, email copy of the certificate.
11. **Client add-ons:** a short module attached to people assigned to a given client.
12. **Incidents:** a real incident report form that notifies HR and the designated Privacy Officer.
13. **Training time:** recorded separately for HR; never flows to pay.
14. **ELEVATE links:** HIPAA certificate in Certificates, HR reporting, reminders, onboarding checklist task, client-assignment
    readiness warning (never a block), client audit evidence report, public certificate check page.
15. **Extras:** annual refresher, My HIPAA record and quick-reference cards, weak-topic recap and course-improvement statistics,
    micro-drills and version-change update modules.
16. **Retention:** results and attestations kept 6 years; per-question answers kept 12 months.
17. **Phasing:** three releases (see `07-rollout-and-operations.md`).
18. **Sign-in handoff** instead of a shared cookie (see `02-architecture.md`: a shared cookie would reach Safe Voice).

## Principles

- **Evidence over decoration.** Every completion must be explainable later: person, course version, time spent, exam attempt,
  attestation, certificate reference.
- **Fair and private.** Training is learning, not surveillance. No scores to leads, no scores in notifications or emails, no
  rankings.
- **Plain language.** Lessons are written for VAs working from home, not for lawyers.
- **Never block the work.** Overdue training warns people; it does not lock the clock, sign-in or client work. (Counsel may
  revisit.)
- **No patient data anywhere.** Scenarios use invented people and obviously fake details; free-text boxes warn against real
  patient information.
- **Boring technology.** Same stack as ELEVATE and Safe Voice; no new paid service; no new dependency without the owner's OK.
