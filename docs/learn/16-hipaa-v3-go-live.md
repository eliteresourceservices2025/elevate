# 16. Learn release: HIPAA v3, Cybersecurity v3 and Customer Service together

Decided 2026-10-23 by the owner (acting as counsel with the HR Director's go-signal): all three trainings go to **production together**, with no staging
pilot. Counsel review date **2026-10-23**, reviewer **eliteresourceservices2025@gmail.com** (this must be an ELEVATE account with that exact email, or
the publish command stops). Nothing here has been run against production yet. The Customer Service details are in `17-customer-service-go-live.md`.

## What changes for people

- **HIPAA** gets a new module (State laws), games and quizzes in every module, and an animated recap video per module in the owner's voice with
  optional subtitles. **Cybersecurity** gets games in every module, a "verify through a second channel" screen, the HHS five threats activity and ten
  animated recaps. **Customer Service** is the new course (11 modules, graded mock call, exam, certificate valid 24 months).
- **Both HIPAA and Cybersecurity v3 are material updates.** People whose certificate is still valid are not asked to retake anything. The nightly
  assignment run gives each of them a short update (due in 30 days) that shows **only the screens that are new or changed** since the version they
  were certified on, then up to 5 questions. Their certificate keeps its dates; finishing records their acceptance and issues no new certificate.
- **No version numbers are shown to people.** "My training record" (Learn) and "My data" (ELEVATE, page and PDF) show one line per course with the latest
  certificate copy. Versions stay in the database as evidence for HR and the privacy team.
- **Next stays off** until every quiz, game or sort on a slide is answered (answered, not necessarily right).
- **The Course studio no longer holds the three core courses** (migration 0100, `CODE_MANAGED_COURSES` in `studio-service.ts`). They are written in the
  repository and published with the command below. Client add-ons are still written in the studio. To bring a core course back, remove its slug from
  that list. Migration 0100 clears the "studio managed" flag on them and **discards any studio draft** of them (a draft was never live; published versions
  are untouched). If HR had an unpublished studio draft of HIPAA or Cybersecurity that matters, copy it out before migrating.

## Order (the database goes first)

1. **Back up**, then `pnpm db:migrate` on production (the owner has applied it once and will run it again to be sure). New since the last deploy: **0097, 0098**
   (mock call), **0099** (updates by screen), **0100** (core courses out of the studio). They only add or replace functions, add one column and tidy
   studio flags and drafts; apply them **before** the new code is live.
2. **Deploy ELEVATE and Learn together** (one release, straight to production). Check the media folders are in the deployment
   (`apps/learn/media/recaps` and `media/voice`, carried by `outputFileTracingIncludes` in `apps/learn/next.config.ts`). Production has the Upstash
   settings, which Learn needs (without them it refuses every player call on purpose).
3. **Publish, only after the deploy is live.** Publishing before the new Learn code is live would put version 3 in front of the old player, which does not know
   the new blocks. In the PowerShell window with the production `DATABASE_URL_DIRECT` typed in (never saved in a file; see `10-production-deployment.md`):
   ```
   pnpm learn:publish --course hipaa --publish --material --reviewer eliteresourceservices2025@gmail.com --counsel-date 2026-10-23
   pnpm learn:publish --course cybersecurity --publish --material --reviewer eliteresourceservices2025@gmail.com --counsel-date 2026-10-23
   pnpm learn:publish --course customer-service --publish --reviewer eliteresourceservices2025@gmail.com --counsel-date 2026-10-23
   ```
   HIPAA and Cybersecurity already have an assignment rule, so they are not paused and the nightly job creates the updates. Customer Service starts
   **paused** (nobody assigned); assign by hand, as `17-customer-service-go-live.md` says.
4. **Check in production** (the owner will): the Course studio no longer lists HIPAA or Cybersecurity; "My training record" and "My data" show no versions;
   open an update (only the new screens, a shorter reading time, no new certificate afterwards); play a recap with subtitles; try Next on a quiz without
   answering (it stays off); take the Customer Service mock call and exam. Also take a last look at the **official California text** (Legislature's site) of
   Health & Safety Code §1280.15 and Civil Code §1798.82, and re-check the Security Rule update's status (still only a proposal on the last check).

## Counsel items (the owner is counsel)

Confirmed against primary text on 2026-10-23, recorded in `08-source-check.md` (State laws and Cybersecurity v3 tables). Still for the reviewer to keep in
mind: the HHS five-threats wording (summary of the 2023 guidance), the "stricter rule wins" teaching shorthand, 42 CFR Part 2 wording, and the items carried from
version 2 in the same file.

## Still open

- **The music track** is now kept in the project: `tools/recap-video/assets/music/` (committed, with a README on its licence). Videos can be rebuilt from it.
- The update flow (screens recorded, finishing, the 5-question exam, acceptance) is covered by database tests but was not walked through in a browser
  with a real old-version certificate holder (a local app without Upstash refuses player calls). The owner's production check in step 4 covers it.
- The Customer Service voices were made on a CPU-only computer; someone should listen to a sample before go-live (`14-mock-call.md`).
