# ELEVATE Learn: HIPAA training (planning set)

ELEVATE Learn is the learning app for Elite Resource Services (ERS). Its first course is **HIPAA Privacy, Security & Awareness
training** for the whole organization, with a fuller path for Virtual Assistants (VAs) assigned to healthcare clients.

It is a separate app in the monorepo (`apps/learn`, like `apps/safe-voice`), deployed as its own Vercel project at
`learn.eliteresourceservices.com`. People use their ELEVATE account; the training record lives in a `learn` schema in the same
Postgres database and is read by ELEVATE for reports, reminders and certificates.

> Status: **planning approved, nothing built except the empty app scaffold.** The sample file `ELITE-HIPAA-PORTAL.html` was used
> only to learn what topics the owner has in mind. Nothing was copied from it: it keeps progress in the browser, ships its exam
> answers in the page, and uses a shared password, so it cannot serve as a training record.

## Documents

| File | What it answers |
| --- | --- |
| [01-product-and-decisions.md](01-product-and-decisions.md) | Why, who, what is in and out, every decision made with the owner |
| [02-architecture.md](02-architecture.md) | How the app, ELEVATE and the database fit together; sign-in handoff; jobs; hosting |
| [03-data-and-security.md](03-data-and-security.md) | Tables, roles, append-only evidence, threats and how each is handled, privacy, retention |
| [04-course-and-exam.md](04-course-and-exam.md) | Curriculum, tracks, lesson format, pacing rules, exam engine, certificate, renewals |
| [05-ux-and-ui.md](05-ux-and-ui.md) | Journeys, screens, copy rules, accessibility, brand, empty and error states |
| [06-testing-and-review.md](06-testing-and-review.md) | Test layers, security and content review, launch gates, definition of done |
| [07-rollout-and-operations.md](07-rollout-and-operations.md) | Three releases, ELEVATE-side work, environment, pilot, runbook, cost, open items |
| [09-cybersecurity-sources.md](09-cybersecurity-sources.md) | The separate Cybersecurity basics course: its sources (CISA, FTC and three training lists) and what each topic maps to |
| [08-source-check.md](08-source-check.md) | **Review packet:** every factual claim in the course with its HHS or regulation source, what was corrected, coverage against the paid course, open items for counsel |

## One-page summary

- **Who:** every ERS workforce member. HIPAA only (cybersecurity basics are a separate course). Two tracks: **Full** (healthcare-client VAs and anyone handling client data) and
  **Essentials** (internal staff with no client data).
- **How long:** new people finish within **30 days** of starting; everyone renews every **12 months** (a shorter refresher).
- **What:** short lessons, scenarios and checks per module, in order, with a server-measured minimum time; a final exam of 15
  randomized questions, **80% to pass, 3 tries, no time limit**; a responsibility attestation; a PDF certificate with a public check page.
- **Who sees what:** the person and HR (and the designated Privacy Officer) see scores; a team lead sees only "passed" or "not yet".
- **Links to ELEVATE:** the HIPAA certificate appears in ELEVATE's Certificates (with its existing expiry reminders), onboarding
  checklist task, client-assignment readiness warning, HR compliance reports, client audit evidence report, reminders by
  notification and email, and a real privacy-incident report form.
- **Never:** patient data in the course or the answers, pay or hours computed from training, scores used as a performance signal,
  third-party trackers, webcam proctoring.
