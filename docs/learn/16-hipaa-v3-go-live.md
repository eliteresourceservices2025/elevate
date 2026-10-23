# 16. HIPAA and Cybersecurity version 3: go-live checklist

HR signed off on 23 October 2026. This is the order for putting it live, and what to check first. Nothing here has been run against production.

## What changes for people

- The HIPAA course gets a new module (State laws), games and quizzes in every module, and an animated recap video per module in the owner's voice, with optional subtitles.
- **A material update.** People whose certificate is still valid are NOT asked to retake the course. The nightly assignment run gives each of them a short update (due in 30 days) that shows **only the screens that are new or changed** since the version they were certified on, then up to 5 questions from the modules those screens belong to. Their certificate keeps its dates; finishing records their acceptance and issues no new certificate.
- People with an open assignment, an expired certificate or no certificate get the current course as usual.
- **No version numbers are shown to people.** "My training record" (Learn) and "My data" (ELEVATE, page and PDF) show one line per course with the latest certificate copy only. Versions stay in the database as evidence for HR and the privacy team, and in the Course studio.

## Order (the database goes first)

1. **Counsel**: confirm the open items in `docs/learn/08-source-check.md` ("Version 3: state laws"): California breach clocks (15 business days for licensed clinics, 30 calendar days for other businesses), the Texas lines, 42 CFR Part 2, whether HIPAA covered entities are exempt from the California general law. Keep the counsel date.
2. **Is HIPAA `studio_managed` in production?** If it is, `pnpm learn:publish` refuses it and the update must go through the Course studio (the Studio cannot edit calls; HIPAA has none).
3. **Back up**, then run `pnpm db:migrate` against production: migration 0099 only adds a column and two functions and replaces `learn.complete_module`; it is safe before the new code is live. Deploy ELEVATE and Learn **after** it, never before (the new Learn code calls the new functions).
4. **Deploy** ELEVATE and Learn (one release). The recap videos live in `apps/learn/media/recaps` and are served only to signed-in people; check the folder is in the deployment (`outputFileTracingIncludes` in `apps/learn/next.config.ts`).
5. **Publish**: `pnpm learn:publish --publish --material --reviewer <email> --counsel-date <date>` (or the Studio). The course already has an assignment rule, so it is not paused. The nightly job then creates the updates.
6. **Check production has Upstash** (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on the Learn host). Without them Learn refuses every player call on purpose (fail closed): screens, reading time and finishing would all say "Too many requests".
7. **Check as a person and as HR**: open "My training record" and "My data" (no versions); open an update (only the new screens, a shorter reading time, no new certificate afterwards); play one recap with subtitles; try Next on a quiz without answering (it stays off).

## Still open

- The lofi music track is git-ignored: keep the licensed file somewhere safe so the videos can be rebuilt (`audio/cs/bgm.mp3`).
- The update's exam and screens have been tested in the database and in unit tests, but not yet walked through in a browser with a real old-version certificate holder: do that once on a staging copy.
- **Cybersecurity v3 is ready for the same release** (committed 23 October 2026): games in all ten modules, a "verify through a second channel" screen, the HHS five threats activity, ten animated recaps with subtitles, a material update (people with a valid certificate get only the new screens). Publish it the same way: `pnpm learn:publish --course cybersecurity --publish --material --reviewer <email> --counsel-date <date>`. Counsel: confirm the HHS five-threats wording (see the source check).
