# ELEVATE runbook: when something goes wrong

For HR, Super Admin and whoever looks after ELEVATE. Plain steps, no code. Nothing here needs the developer unless it says so.

**The rule that keeps people paid:** the ELEVATE clock is the only record of hours. If anything fails, the fix is always a **time correction** or a **bulk correction**, never "ignore it". Corrections add new records; nothing is ever edited or deleted.

---

## 1. Before a team starts using the clock (pilot checklist)

- [ ] **One pilot team**, one week, with ELEVATE and Jibble side by side. Compare at the end of the week.
- [ ] **Monitoring policy published** (counsel's text). Jibble screenshots, location and selfies stay off until it is.
- [ ] **Production is set up correctly:** the production host has `ELEVATE_ENV=production`, the Jibble keys, `CRON_SECRET` (at least 16 random characters) and the job service (Inngest) keys. **Only** production has `ELEVATE_ENV=production`: that is what stops a test copy from clocking real people in Jibble.
- [ ] **Jibble settings** (Jibble's own admin pages): turn **off** web/mobile clock-in for these people so only ELEVATE clocks them in; turn **off** auto clock-out and clock-in reminders; turn off geofence automation; keep screenshot blur on and the shortest screenshot retention; each person's schedule has an **unpaid break** (breaks come from the schedule).
- [ ] **Everyone matched:** Attendance > Jibble > "Match people by email now", then fix anyone listed as not matched.
- [ ] **Schedules set** for the pilot team (Attendance > Schedules). People with no schedule get no late, absent or extra-hours flags.
- [ ] **No IP ranges** during the pilot (they flag people on home internet). Add them later only where they help.
- [ ] **Team rule "Mirror the clock to Jibble"** switched on for the pilot team only (Attendance > Rules).
- [ ] **Train the VAs** (15 minutes): use only the ELEVATE clock; what the "Offline" banner means; how to ask for a correction; who to message if sign-in fails.
- [ ] **A test person** in Jibble (fake email) for trying things. Never test on a real VA.

## 2. HR's routine

**Every day:** open Attendance > **Health**. Green means everything is running. Red means read the list.
**Every Monday:** leads get a reminder to approve last week. **Every Wednesday:** HR gets who is still holding it up (Attendance > Hours export shows approved vs not approved by team). Chase those leads before payroll.
**Before each payroll:** Attendance > Hours export > check the green or amber box for the pay period, then download. Days that are not approved are left out and the box says how many.
**Monthly:** Attendance > Schedules > "Only people with no schedule"; check the Philippine holiday list (an unverified holiday can cause wrong "absent" flags); re-check who is not matched to Jibble.

"Absent (review)" is a flag to look at, not a decision. Check leave, holidays and the person's schedule before anyone acts on it.

## 3. ELEVATE is down or people cannot clock in

1. **Check** the ELEVATE address from your phone. Check Attendance > Health if you can reach it.
2. **Tell people** (Teams/Slack/email): "ELEVATE is down. Keep working. Do not clock in Jibble yourself. Write down your start time. We will fix your hours afterwards." Jibble keeps running on its own, so screenshots and its timestamps are the backup evidence.
3. **Ask the developer** or the host's status page what is wrong.
4. **When it is back:**
   - People who were clocked in stay clocked in (their session continues). Anyone who should have clocked out clocks out now, and asks for a correction for the real time (Attendance > Time correction, reason "ELEVATE outage").
   - For many people at once: **Attendance > Corrections > "File many corrections from a spreadsheet"** (HR). One row per missed event: `email,type,time`, times in the zone you pick. Jibble's timesheet export is a good source for the times. **A different HR admin** then approves the whole batch ("Approve all"). Rows that cannot be filed are listed with the reason.
5. **Short outages** (under an hour): usually not worth correcting minute by minute; agree a rule with the leads (for example "outages under 30 minutes are ignored") and tell them.

## 4. Someone cannot sign in

- **Forgot password:** "Forgot password" on the sign-in page.
- **Lost phone or new phone (authenticator code):** HR cannot reset this in ELEVATE. In the **Supabase dashboard** (Authentication > Users), open the person and remove their authenticator (MFA) factor; they set it up again at their next sign-in. If you cannot find the option, ask the developer (it is the admin call `auth.admin.mfa.deleteFactor`). Ask the person to confirm who they are first (video call or a known contact), and note it in your records.
- **Meanwhile:** their lead or HR files corrections for the time they could not clock (Attendance > Corrections > "File a correction for someone").
- **"Cannot reach ELEVATE: refresh, or sign in again"** in the header: the page lost its session. Refresh; sign in again if asked. Their clock session is safe on the server.

## 5. Jibble problems

| What you see | What it means | What to do |
|---|---|---|
| Jibble page: red banner "oldest waiting call has waited N minutes" | Jibble is slow or refusing calls. | Check "Recent calls" for the reason. Wait 30 minutes (the repair job fixes drift every 15 to 30 minutes). If it persists, **Pause sending** and message the developer. |
| HR notification "ELEVATE cannot sign in to Jibble" | The Jibble keys were changed, revoked, or the plan lapsed. | Check Jibble's API keys and plan. Put the new keys in the host settings. Then "Test connection". |
| HR notification "N people clocked in with no Jibble account" | These people worked without screenshots. | Match them (Jibble page) or add them in Jibble. Their days show "No screenshots". |
| "Jibble and ELEVATE totals differ" flag | The nightly comparison found more than 15 minutes of difference. | Look at that day. Usually someone also clocked in Jibble directly, or an outage. ELEVATE's hours stand. |
| A break did not stop screenshots | The person has no break on their Jibble schedule. ELEVATE then clocks them out of Jibble for the break instead (shown as "clock-out instead" in recent calls). | Add an unpaid break to their Jibble schedule. |
| Everything looks wrong after a long outage | Old queued calls would put Jibble in a wrong state. | **Pause**, then **Resume**. Calls older than 10 minutes are dropped and the repair job sets everyone's Jibble status right from ELEVATE. |

**Emergency stop:** Attendance > Jibble > **Pause sending to Jibble**. The ELEVATE clock keeps working; only the calls to Jibble stop.

## 5b. Recruiting problems

| What you see | What it means | What to do |
|---|---|---|
| An applicant says the apply form failed | The form allows 5 applications an hour per internet connection, a resume must be a PDF or DOCX up to 4 MB, and the privacy box must be ticked. | Ask them to try a smaller file or wait an hour; or add them yourself later. |
| Applicant emails (received, interview) are not arriving | The email service is not configured, or the applicant email cap for the day (default 20) is used up. They wait in the queue and go out when possible. | Check the email settings on the host; the Health page shows the "Applicant email sender" job. |
| Nothing is being deleted for old applicants | Retention is off until HR turns it on, on purpose. | Get counsel's approval of the periods, then switch it on in Recruiting > Applicant data retention. |
| A resume will not open | The link lasts 60 seconds. | Click "Open resume" again. |

## 5b2. Google Calendar problems

| What you see | What it means | What to do |
|---|---|---|
| Recruiting page: "Not set up on this server yet" | The Google credentials are not on the server. Interviews still work with emailed calendar files. | The developer adds GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (docs/SETUP.md 6b). |
| "Google stopped accepting the connection" or a warning after scheduling | The person removed access, or (External app in Testing mode) 7 days passed. The interview was still scheduled and invites went out by email. | Click Reconnect on the Recruiting page. To stop weekly reconnects, publish the Google app or use Google Workspace (Internal). |
| Google says "access blocked" or "app not verified" when connecting | The person is not an allowed Test user, or the redirect address does not match. | Add them as a Test user in Google Cloud, or check the redirect address. |
| A cancelled interview is still on someone's Google Calendar | Google could not remove it at that moment. | Delete the event in Google Calendar by hand. |

## 5b3. Offers and hiring problems

| What you see | What it means | What to do |
|---|---|---|
| "Offer made, but the email could not be sent" | The email service is not set up or refused the message. The offer exists and the applicant was not told. | Fix the email settings, then open the offer and click **Send link again**. |
| The applicant says the link is "not valid anymore" | It was replaced by a newer email, the offer was withdrawn, it expired, or it is more than 30 days old. | Click **Send link again** (a new link replaces any old one), or make a new offer. |
| The applicant did not get the 6-digit code | The code email may be in spam, or five codes were already sent this hour. | Ask them to check spam and wait a little; they can ask for a new code on the page. |
| The applicant cannot sign | They must read the document first, and (with a countersigner) it must be their turn. | Ask them to open the document with "Read the document". |
| "Hire" says there is no signed offer | The applicant has not signed. | Wait, resend, or hire with a written reason (for example signed on paper). The reason is recorded. |
| Hire says that work email already exists | That email already belongs to a person record. | Use a different work email, or open the existing record. |

## 5b4. Onboarding and offboarding problems

- **A new hire has no checklist.** The checklist is created when HR hires from the applicant page. Someone added by hand has none: no action is needed unless you want one, ask a developer.
- **A task will not tick by itself.** Only "ticked by hand" tasks can be ticked by people. The others close when ELEVATE sees the document, policy acknowledgment, account or signature (within 30 minutes, or when the page is opened). If the thing really is done outside ELEVATE, HR can skip it with a reason.
- **Access was not removed after the last working day.** Open the case: "Remove access now" does it immediately and repeats whatever step failed. If it says the person still has reports, reassign them first (People, their profile, Employment), then try again. The hourly job tries again by itself.
- **Someone was offboarded by mistake.** Before access is removed use "Cancel offboarding". After that, restore the person in People and ask a developer to re-enable the sign-in in the Supabase dashboard (Authentication, Users, the person, remove the ban).
- **Certificate of engagement.** Issue it from the offboarding page. It lists dates and role only. Every view is logged.

## 5b5. Review problems

- **A person has no review in a cycle.** The cycle covers people who were current when it was launched (not separated or archived). Someone added later is not added automatically: launch a small cycle for them with "Chosen people".
- **The wrong lead was given a review.** Open the review and use "Change reviewer" before the lead's review is written.
- **A month 3 or month 5 review did not open.** Check Reviews > Templates that early reviews are switched on, and that the person has a start date. People who started more than a month past their milestone are not back-filled: launch a cycle for them by hand.
- **A rating needs fixing after it was shared.** Shared reviews are frozen on purpose. Launch a new review, or ask a developer.
- **Nobody can calibrate my own review.** Another HR admin has to calibrate and share it.

## 5b6. People analytics problems

- **The Analytics page says "No snapshot yet".** The numbers are built each night at 2:50 AM Phoenix by the "Nightly People analytics summaries" job (Attendance, Health shows whether it ran). The first run builds about a year of history by itself. To build it now, run that function from the Inngest dashboard.
- **Numbers look a day behind.** Normal: the page shows data through yesterday (company time) and says so at the top. A missed night fixes itself: the next run rebuilds from the first missing day.
- **Something was corrected in the past and the charts still show the old number.** The last 7 days are rebuilt every night. For an older date, a developer runs `rebuildRange(from, to)` (src/modules/analytics/build.ts) for that range; running it twice gives the same result.
- **A client's assignment dates or client were corrected retroactively.** Check the person's extra-hours and training records, and any previously issued exports or approvals; they are not rewritten. Client evidence can reflect the corrected dates immediately, but issued certificates and training due dates are not automatically changed. Ask the developer to run `rebuildRange(from, to)` for the affected historical span through yesterday (company time). The rebuild widens the range to full weeks and months; it does not happen automatically for older dates. Never run a long rebuild while saving the assignment.
- **"fewer than 5" appears.** On purpose: a group or cell built from fewer than 5 people is never shown, to protect privacy (including in a team lead's view of a small team). Small teams and clients are combined under "Other". Do not work around it by exporting or by asking for a smaller group: the CSV carries the same hidden cells.
- **Who sees what.** HR and the Executive see everything company-wide (read-only), a team lead only everyone below them, a recruiter only hiring. Only HR downloads the CSV, and every download is logged (analytics.export).
- **Headcount looks wrong.** Headcount follows people's start and end dates and the dated team, client and manager history. Fix the person's dates in People; the next nightly run (or `rebuildRange`) picks it up.

## 5b7. Import from TalentHR problems

- **"Check the file" says a column is needed.** An import needs a work email, a first name and a last name column. Choose them in the column list.
- **Dates look wrong.** Pick the right date format on the upload screen (TalentHR uses month/day/year). Impossible dates are errors.
- **A row has an error.** Fix it in the export (or in TalentHR) and upload again, or tick "skip the rows with errors" to commit the rest. The preview names the field, never the value.
- **A supervisor was not linked.** The supervisor must be in the same file, and not terminated while the person is current. Fix the file or set the manager in People.
- **A second dry run shows "changed" for everyone.** That is expected if the first one used another date format or mapping. Compare the changed field names.
- **I want to undo an import.** Use Roll back on the import page: people it created are archived unless they have signed in or have activity. Re-uploading the same file restores them.
- **Real data:** only do real imports on the production system. Never upload a real export to a laptop or test copy.

## 5b7a. Reviewed schedules and client assignments from an attendance sheet

- **Do not rerun the old October importer.** It could create guessed employee/client records and change dated rows without a preview. If it was run earlier, preserve the audit and history; ask HR to reconcile actual records with the original source before any correction. Never delete people or rewrite clock events to tidy it up.
- A timesheet does **not** establish a person's identity, employment start date, scheduled weekdays, planned unpaid break, or agreed hours per week. HR must first review a mapping from exact sheet name/client pairs to existing active employee and client UUIDs and explicitly confirm a shift, first assignment date, effective date, weekday set, break length and optional hours per week. Store the sheet and mapping **outside the repository**, keep both private, and do not put real data in a local or test database. The mapping JSON has `entries`, each with `name`, `client`, `employeeId`, `employeeWorkEmail`, `clientId`, `clientName`, `assignmentStartDate`, `scheduleText`, `shift` (`effectiveFrom`, `startTime`, `endTime`, `zone`, `weekdays`, `breakMinutes`) and `hoursPerWeek` (number or null). Check the employee's work email and the client's actual name in ELEVATE independently before filling these fields; a timesheet name can be an alias. The importer verifies both identity fields against the selected records.
- The guarded CLI at `apps/elevate/scripts/bulk-import-schedules.ts` requires `ELEVATE_ENV=production`, `DATABASE_URL`, `EXPECTED_DB_HOST`, `EXPECTED_DB_NAME`, `EXPECTED_DB_PROJECT_REF`, and `--csv`, `--mapping`, `--as` (the email of an active HR/Super Admin). It accepts only a Supabase transaction-pooler URL on port 6543, rejects URL query overrides and uses certificate-verified TLS; independently verify the project reference and host against the approved production deployment before using the real sheet. Matching environment variables alone do not prove a database is production. Keep both private input files **outside the repository** (the CLI refuses paths inside it, including symlinks). Run from `apps/elevate` with `pnpm tsx scripts/bulk-import-schedules.ts --csv <private-path> --mapping <private-path> --as <hr-email>`. The default is a **read-only preview**. Review the project, counts, and digest with HR before considering changes. Never paste the database URL, input, mapping or screenshots of personal rows into chat or logs.
- Application requires a separate, explicitly approved `--apply confirm --digest <reviewed-digest>` with the same inputs and verified project/host. The CLI adds only unambiguous new assignments and schedules, in one transaction with audit and assignment history; it stops for another overlapping client assignment, existing clock events or attendance that new dates would affect, dated rows needing correction, or a start over seven days back. A changed preview digest means **stop**, preview and review again. The October 2026 sheet is historical once outside the seven-day window; use reviewed HR corrections in ELEVATE instead of bypassing that rule. After any apply, preview again and compare counts (zero proposed writes means the additions match). Assess any attendance approvals, exports and analytics affected by retroactive corrections separately.
- Tests use invented fixtures and the disposable local integration database only. The real sheet must never be used in tests, staged on a dev database or checked in. If the first run went to local Supabase, treat the real names there as a privacy incident to investigate under the team's data-handling procedure; don't silently delete them.

## 5b8. Pulling documents from TalentHR (API)

1. Import the people CSV first (Settings, Import from TalentHR) so people exist in ELEVATE. The pull only handles people whose work email matches.
2. On the production system, put the API key in `apps/elevate/.env.talenthr.local` (`TALENTHR_API_KEY=...`). Never paste it in chat or commit it.
3. Check the key: `pnpm talenthr:pull -- --probe`.
4. Try a few people: `pnpm talenthr:pull -- --as hr@yourcompany.com --dry-run --only a@x.com,b@x.com`, then the same without `--dry-run`.
5. Run it for everyone, then open the import's reconciliation: documents expected versus imported. Files that were too big, not an allowed type or failed to download show as mismatches: add them by hand in People > Documents, or fix and run the pull again (it skips what is done).
6. TalentHR leave history is archived as an encrypted file and is not loaded into ELEVATE. Active applicants ARE loaded into Recruiting: each TalentHR job with active applicants becomes a **closed** job in ELEVATE (reopen one to use it), with the applicants at the nearest stage and their resumes. No emails are sent to them. Closed, rejected and hired applicants stay only in the encrypted archive. Add `--no-applicants` to leave Recruiting alone.
7. Run these from the repository root with `pnpm talenthr:pull -- --probe` (the root forwards to the app), or from `apps/elevate`.

## 5c. Signing problems

| What you see | What it means | What to do |
|---|---|---|
| "Everyone has signed. The document is being sealed" for more than a few minutes | Sealing failed once (storage hiccup). A job retries every 30 minutes. | Wait up to 30 minutes and refresh. If it persists, check the Health page ("Sealing signed documents") and tell the developer. The signatures are safe. |
| Event log shows "Chain broken" | Someone changed the record directly in the database. | Do not use the document; tell the developer at once. |
| A signer cannot sign | They have not opened the document yet, it is not their turn (one-after-another order), it expired, or it was voided. | Ask them to open it first. Remind, or void and send again. |
| The person has no account | Signers must have an ELEVATE account. | Invite them first (Settings > Invitations). People outside the company are not supported yet. |
| Checking a signed PDF says "does not match" | The file was changed after sealing, or it is not the sealed copy (the unsigned original does not match). | Download the signed copy again from the document page. |

## 5d. Safe Voice problems

| What you see | What it means | What to do |
|---|---|---|
| A reporter says their code and passphrase "do not work" | Wrong or mistyped (the page gives the same message for a wrong code, a wrong passphrase and an unknown code, on purpose). Or they hit the rate limit (10 tries per code in 15 minutes). | Ask them to retype carefully (capitals, spaces and dashes do not matter) and to wait 15 minutes if they tried many times. **Nobody can look a code up or reset a passphrase**: they are stored only as keyed hashes and no one, the developer included, can recover them. If they are truly lost, the reporter can send a new report and mention the old one. |
| Every reporter is locked out at once | `SAFEVOICE_PEPPER` was changed or lost. | Restore the original value from the password manager and redeploy the Safe Voice project. Never change it. |
| The Safe Voice page says "not available right now" | `SAFEVOICE_DATABASE_URL` or `SAFEVOICE_PEPPER` is missing, or the role's password changed. | Check the Safe Voice project's environment variables and the `safevoice_app` password (SETUP section 14). |
| "Too many tries" for everyone in production | Upstash is not configured or unreachable (the app refuses requests rather than skip the limit). | Fix the Upstash variables on the Safe Voice project. |
| Safe Voice cases says "not connected" | `SAFEVOICE_HANDLER_DATABASE_URL` is not set on ELEVATE. | Add it (SETUP section 14c). |
| Reports wait and nobody is told | Nobody is designated as a handler (Super Admins get one warning a day), or the `safevoice-notify` job is late (Attendance > Health). | Designate handlers in Settings > Roles and access (tick Safe Voice handler). Check the job on the Health page. Notices are sent once an hour at most, on purpose. |
| A handler wants to know who a reporter is | They must not try. Nothing in the app can tell: no name, address, device or exact time is stored. | Do not ask the developer to look in logs or the database either; the design depends on there being nothing to find. Attachments have their hidden details removed, but words in the text or in a picture can still identify someone: ask the reporter, through the case, before acting on a detail. |
| A report mentions a client's patient | The warning on the form was missed. | Do not copy it elsewhere. Reply asking the reporter to describe the situation without patient details. Counsel decides about removing the text. |

Counts shown to the Executive hide any category with fewer than 5 reports. Handlers' actions (opening a case, replying, status changes, closing, opening an attachment) are audited with the case reference only, never with any text.

## 5e. Assets problems

| What you see | What it means | What to do |
|---|---|---|
| "That tag is already used by another item" | Tags are unique, whatever the letter case. | Pick the next free tag. A tag cannot be changed later because it is printed on the label; to fix a wrong one, archive the item and register it again. |
| A scanned QR shows "not found" | The person is not signed in as someone allowed to see that item (HR sees everything, a lead only items with their team, a person only their own), or the tag does not exist. | Sign in with the right account. Items are never shown to others, on purpose. Recruiters and Executives have no access. |
| A scanned QR opens a sign-in page | Scanning needs a signed-in session with the sign-in code. | Sign in, then scan again. |
| The QR code does not scan | The label was printed too small, or on the wrong site address (a code printed on a test site points at the test site). | Print again from the live site at 63 x 38 mm or larger. |
| "This item is already assigned" | One person holds it. | Open the item, record its return (condition and where it goes next), then assign it again. |
| "This item is in repair / lost / retired" | Those items cannot be handed out. | Mark an item back as in stock once repaired or found. A retired item is final: register a new one. |
| Someone has left but still shows items | The offboarding check "Equipment and assets returned" stays open until every item is returned. Access removal does not wait for it. | Record each return on the item's page (HR can do this after the person has left). If an item is gone, record the return with "Not recovered (lost)". |
| A wrong hand-over or return was recorded | History cannot be edited or deleted (it is a record). | Record a return and a new hand-over, and explain it in the note. Developers must never edit `talent.asset_assignments` by hand. |

Assets hold no prices or values. Item notes are for HR only: never put passwords, client names or patient information in them. Labels print from Assets > Print labels (or "Print this label" on an item); set margins to default and turn off headers and footers in the print window.

## 5f. HIPAA training problems (ELEVATE Learn)

- **"HIPAA training is not available yet" in ELEVATE:** `NEXT_PUBLIC_LEARN_URL` is missing on ELEVATE, or ELEVATE was not redeployed after setting it (docs/DEPLOY.md Part 5b).
- **Someone lands on "Your sign-in link expired":** open HIPAA training from ELEVATE again. If it repeats for everyone, check `NEXT_PUBLIC_ELEVATE_URL` on Learn and the Learn project's function logs for `handoff failed: <code>`.
- **Nobody is being assigned:** the course must be **published** (`pnpm learn:publish --publish --reviewer ... --counsel-date ...`); the `learn-assign` job does nothing until then. The Training status page and Attendance > Health show whether the job ran.
- **Someone is on the wrong track:** the track comes from their client assignments. A client marked "works with patient information" (People > Clients) puts its people on Full; others are Essentials. HR can assign a track by hand on Training status.
- **A person failed three times:** Training status > "More tries or time" gives more tries or exam minutes, with a reason (kept in the record).
- **A certificate is missing from Certificates:** it is recorded by the `learn-sync` job within 30 minutes; a person with an account but no people record waits until they have one.
- **A mistake in the course after publishing:** change the content, save and publish a new version (`pnpm learn:publish`), marking it `--material` only when people already trained must relearn it.
- **Turning Learn off:** remove `NEXT_PUBLIC_LEARN_URL` from ELEVATE and redeploy.

## 6. Deploying changes (developer)

- Deploy at the **Manila shift change**, not in the middle of a night shift (that is the US day, when most VAs are working). Check Attendance > Health before and after.
- A new environment needs the private bucket `recruiting-docs` (`pnpm storage:setup`) before the careers form can take resumes, and `signed-docs` before ELEVATE Sign can store documents.
- Database changes must be safe to run while people clock in (add columns and tables; never rename or drop in one step).
- A failed deploy is rolled back from the host's dashboard, and the Health tab confirms jobs are running again.
- The host's own scheduler calls `/api/cron/backstop` every 15 minutes (needs `CRON_SECRET`). If the job service (Inngest) is down, this still sends waiting Jibble calls, repairs Jibble and sends the health alert.

## 7. Data safety

- Clock events, corrections and approvals cannot be edited or deleted, even by the developer with database access (a database rule refuses).
- Restore test: once before go-live, restore the latest backup into a throwaway project and check the last week of clock events are there.
- Screenshots in Jibble can show client patient information: keep Jibble's blur on and retention short. ELEVATE never copies them.

## 8. Who to call

Fill in before go-live: developer, Jibble support, the host (Vercel), Supabase support, counsel.
