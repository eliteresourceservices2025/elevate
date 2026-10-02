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
| Jibble page: red banner "oldest waiting call has waited N minutes" | Jibble is slow or refusing calls. | Check "Recent calls" for the reason. Wait 10 minutes (the repair job fixes drift every 10 minutes). If it persists, **Pause sending** and message the developer. |
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

## 5c. Signing problems

| What you see | What it means | What to do |
|---|---|---|
| "Everyone has signed. The document is being sealed" for more than a few minutes | Sealing failed once (storage hiccup). A job retries every 5 minutes. | Wait 5 minutes and refresh. If it persists, check the Health page ("Sealing signed documents") and tell the developer. The signatures are safe. |
| Event log shows "Chain broken" | Someone changed the record directly in the database. | Do not use the document; tell the developer at once. |
| A signer cannot sign | They have not opened the document yet, it is not their turn (one-after-another order), it expired, or it was voided. | Ask them to open it first. Remind, or void and send again. |
| The person has no account | Signers must have an ELEVATE account. | Invite them first (Settings > Invitations). People outside the company are not supported yet. |
| Checking a signed PDF says "does not match" | The file was changed after sealing, or it is not the sealed copy (the unsigned original does not match). | Download the signed copy again from the document page. |

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
