# 17. Customer Service & Family Support Certification: go-live and client add-ons

HR approved the course and, as the HR Director said, it goes to production once it is tested (no staging pilot). It is tested in code (unit,
real-database and browser checks) and in the build. Nothing here has been run against production.

## What goes live

- 11 modules (about 3 hours) and a practicum: a **graded mock call** and a **final exam** (88-question bank, 25 per try, 85%), each passed
  separately at 85%, 3 tries each, certificate valid **24 months**. The call is on the course page; see `14-mock-call.md`.
- 19 optional lesson videos (cloned voice, burned-in subtitles) and 495 read-aloud clips (callers and exam). Files live in
  `apps/learn/media/recaps` and `apps/learn/media/voice`, served only to a signed-in person; `outputFileTracingIncludes` in
  `apps/learn/next.config.ts` carries both folders into the deployment.
- Module cards with pictures on the course page; "My training record" shows one line per course with the certificate and no version numbers.

## Order (the database goes first)

1. **Counsel** reviews Module 5 (Confidentiality) and Module 6 (Healthcare) and gives a date; HR and the Privacy Officer have read the rest.
   Review packet: `pnpm learn:export` writes the whole course with the answer key to `docs/learn/review` (private; do not share outside review).
2. **Back up**, then `pnpm db:migrate` on production: migrations **0097** (call tables) and **0098** (call functions and guards), plus anything
   newer not yet applied (0099 for HIPAA version 3). They only add tables, functions and guards; apply them **before** the new code is live.
3. **Deploy ELEVATE and Learn together** (one release). Check the two media folders are in the deployment and that Learn has
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (without them Learn refuses every player call on purpose).
4. **Publish:** `pnpm learn:publish --course customer-service --publish --reviewer <email> --counsel-date <date>`. A first publication starts
   **paused**, so nobody is assigned yet. The studio refuses to edit this course (it has a graded call): content changes go through the repository.
5. **Choose who gets it** in ELEVATE > Training status > Customer service > Automatic assignment (everyone, chosen teams, or paused).
   It takes effect at the next nightly run. Reminders go out at 30 days, 7 days and the due date.
6. **Privacy notice:** the wording is updated (`docs/policies/privacy-notice.md` and the public Privacy policy page). Publishing the notice is
   permanent and makes everyone accept it again, so publish it **once**, after counsel's review. Do not publish it against a shared dev database.
7. **Check as a person:** open the course, play a video and a read-aloud clip, try Next on a quiz without answering (it stays off), take the mock call
   and the exam, and download the certificate (do not delete your test certificate: it is real evidence; ask HR to revoke it if unwanted).

## Client add-on modules (HR writes them in the Course studio)

The baseline course teaches the ERS rules and says to follow **the client's own steps**. Each client that needs it gets an add-on in
**Course studio > New client add-on** (the scaffold has three placeholder screens and a five-question quiz; placeholders block publishing). It is
assigned automatically to people on that client. Collect these from each client before writing:

- **Who may we talk to, and how do we check?** The identity-check steps (what to ask, what must match the record), who is an authorized contact,
  and what to say when someone is not.
- **Emergency protocol:** the exact wording for a possible emergency, who to alert and how (lead, client on-call line), and what to record. Never a
  clinical instruction of our own.
- **Escalation:** who takes a supervisor request or a complaint, the hours, the hand-off summary they expect, and the time frames we may quote.
- **Routing:** where refill, records, results and billing requests go, and the reply time the clinic uses for each.
- **Wording to use and avoid:** greetings, hold and transfer phrases, anything the client forbids saying.
- **Records:** what the call note must contain and where it is kept. No patient information in any example: invented people only.

Keep it short (one module, about 10 minutes, five or more quiz questions). Counsel reads anything that touches confidentiality or health calls.

## Still open

- The lofi music track is git-ignored: keep the licensed file safe so the videos can be rebuilt (`tools/recap-video/audio/cs/bgm.mp3`).
- The caller and exam voices were made on a CPU-only computer with a voice engine that varies pitch and pace but cannot act emotions; someone should
  listen to a sample of the clips before go-live (`14-mock-call.md`).
