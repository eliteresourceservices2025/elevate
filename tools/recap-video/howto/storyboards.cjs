// The how-to videos for the Help center. One entry = one video; `id` is the guide's file name, and the guide's header says `video: <id>`.
//   S(picture, part, caption, say)
//   picture  "<guide>/<file>" of a screenshot in apps/elevate/content/help/assets (taken by `pnpm help:shots`)
//   part     the name of a target in tests/help/shots.ts (its place comes from assets/_boxes.json), or null to show the picture
//   caption  what appears on screen: short, an instruction
//   say      what the voice says: plain, short sentences, the real names of buttons. Write "H R", not "HR", only where the voice needs it
//            (build.cjs spells out the common ones).
// Keep each video under about two minutes.
const S = (image, focus, caption, say) => ({ image, focus, caption, say });

module.exports = [
  {
    id: "invite-a-person",
    title: "Invite a new person to ELEVATE",
    subtitle: "Send an invitation so a new person can sign up.",
    outroSay: "If they do not get the email, ask them to look in their spam folder. Or tell them to click Accept an invite on the sign in page, and type the same email address.",
    steps: [
      S("invite-a-person/01-invitations", null, "Settings, then Invitations", "To invite someone, click Settings in the left menu. Then click Invitations."),
      S("invite-a-person/01-invitations", "email box", "Type their email address", "Type the person's email in the box called Invite by email. It must be the exact address they will use to sign up."),
      S("invite-a-person/01-invitations", "Invite button", "Click Invite", "Click the Invite button. A green message appears, and Elevate emails them the sign up link."),
      S("invite-a-person/01-invitations", "list", "Check the list", "The person now shows in the list. Pending means they have not signed up yet. Accepted means they have. An invitation lasts seven days, so send a new one if it runs out."),
    ],
  },
  {
    id: "add-or-edit-a-person",
    title: "Add or edit a person",
    subtitle: "Create someone's record and change it later.",
    outroSay: "To change a record later, open the person's profile, edit the tab you need, and save. Every change is saved in the History tab.",
    steps: [
      S("add-or-edit-a-person/01-add-person", null, "People, then Add person", "Click People in the left menu. Then click Add person."),
      S("add-or-edit-a-person/01-add-person", "name", "Fill in the name", "Type the legal first name and last name. The preferred name is the one shown in the directory."),
      S("add-or-edit-a-person/01-add-person", "work email", "Use their sign-in email", "Type their work email. It must be the email they will use to sign in. Their account then links to this record by itself."),
      S("add-or-edit-a-person/01-add-person", "manager", "Choose manager and team", "Choose the manager and the team from the lists. Pick a name from the list. Do not type a new one."),
      S("add-or-edit-a-person/01-add-person", "Add person button", "Click Add person", "Click Add person. If Elevate says Possible duplicate, check the People list first, because the person may already exist. Government I D numbers and bank details are added later on the profile, where they are encrypted."),
    ],
  },
  {
    id: "set-who-reports-to-whom",
    title: "Set who reports to whom",
    subtitle: "Change a manager, team or attendance lead.",
    outroSay: "Elevate keeps the old assignment in the person's history, and it will not allow two people to report to each other.",
    steps: [
      S("set-who-reports-to-whom/01-employment-tab", null, "Open the Employment tab", "Open the person's profile from People. Then click the Employment tab."),
      S("set-who-reports-to-whom/01-employment-tab", "reporting", "Find Reporting", "Scroll to Reporting. Here you choose the manager and the team, and set the date the change starts. The date must be today or earlier."),
      S("set-who-reports-to-whom/01-employment-tab", "attendance lead", "Optional attendance lead", "Some people report their time to a lead who is not their manager. Set that lead here. They handle time matters only, like hours, corrections and time off. They must hold the Team Lead role to approve."),
      S("set-who-reports-to-whom/01-employment-tab", "reporting", "Before a manager leaves", "Before a manager leaves, use New manager. It moves everyone who reports to them in one step. A person who still has reports cannot be archived."),
    ],
  },
  {
    id: "start-onboarding",
    title: "Start onboarding for a new hire",
    subtitle: "Give a new person a checklist and follow it.",
    outroSay: "When every required task is done, click Complete onboarding. The person then becomes active. If something was done outside Elevate, H R can use Complete anyway and write a reason.",
    steps: [
      S("start-onboarding/01-onboarding-page", "list", "The Onboarding page", "Click Onboarding in the left menu. People you hire through Recruiting get their checklist by themselves."),
      S("start-onboarding/01-onboarding-page", "Start onboarding button", "Click Start onboarding", "For someone you added under People, click Start onboarding at the top right."),
      S("start-onboarding/02-start-dialog", "people list", "Tick the people", "Tick one person or many. Use the search box to find them."),
      S("start-onboarding/02-start-dialog", "start date", "Choose the start date", "Set the start date. Task due dates count from this day. If people already have their own start date, you can untick the box to use yours."),
      S("start-onboarding/02-start-dialog", "start button", "Click Start onboarding", "Click the start button at the bottom."),
      S("start-onboarding/03-case", "first task", "Follow the checklist", "Open the person's case. Each task shows who owns it: H R, their lead, or the person."),
      S("start-onboarding/03-case", "automatic", "Some tasks tick themselves", "Some tasks say Elevate ticks this when it is done. You do not need to do anything for those."),
      S("start-onboarding/03-case", "Mark done", "Tick your tasks", "For a task you own, click Mark done. If a task is not needed, click Skip and say why."),
    ],
  },
  {
    id: "offboard-someone",
    title: "Offboard someone who is leaving",
    subtitle: "Handover, equipment, final hours and removing access.",
    outroSay: "You can cancel an offboarding until access is removed. Record equipment returns in Assets, and approve and export the final hours.",
    steps: [
      S("offboard-someone/02-start-dialog", null, "Start an offboarding", "Click Offboarding in the left menu. Then click Start an offboarding. Someone who still has people reporting to them cannot be offboarded. Move their reports first."),
      S("offboard-someone/02-start-dialog", "people list", "Tick the person", "Tick the person who is leaving. Then set the last working day and the reason for leaving."),
      S("offboard-someone/03-case", "first task", "Follow the checklist", "The case shows the checklist: turnover notes, an exit interview, the lead's confirmation, equipment, and the final hours."),
      S("offboard-someone/03-case", "exit interview", "The exit interview is private", "The exit interview is a short private form. Only H R can read the answers."),
      S("offboard-someone/03-case", "Remove access now", "Access is removed for you", "Access is removed by itself when the last working day ends. To do it sooner, click Remove access now."),
      S("offboard-someone/03-case", "certificate", "Certificate, if asked", "If the person asks for one, click Issue certificate of engagement. It shows dates and role only."),
    ],
  },
  {
    id: "post-a-job",
    title: "Post a job opening and edit the careers page",
    subtitle: "Create a job, publish it and close it when it is filled.",
    outroSay: "Applicants apply on the public careers page. You see them in the job's pipeline.",
    steps: [
      S("post-a-job/02-new-job", "job title", "Start with the title", "Click Recruiting, then New job. Type a job title."),
      S("post-a-job/02-new-job", "description", "Write the description", "Write the description. Applicants read it on the public careers page."),
      S("post-a-job/02-new-job", "pay note", "Keep pay to what is agreed", "The pay note is free text. Only write what was agreed. We hire independent contractors, so do not promise benefits."),
      S("post-a-job/02-new-job", "create button", "Create the draft", "Click Create job as a draft. It stays hidden until you publish it."),
      S("post-a-job/04-job-pipeline", "Close job", "Publish, then close", "When the text is ready, click Publish job. When the role is filled, click Close job."),
      S("post-a-job/03-careers-page", "introduction", "Edit the careers page", "The careers page has its own title, introduction and banner picture. Use a picture of the team or the work. Never use a client or a patient."),
    ],
  },
  {
    id: "review-applications",
    title: "Review applications and move them along",
    subtitle: "Read an application, change its stage and close it.",
    outroSay: "A closed application can be reopened. Never write client or patient information in notes.",
    steps: [
      S("review-applications/01-pipeline", "Applied column", "Each job has a pipeline", "Open a job from Recruiting. You see a column for each stage, from Applied to Hired."),
      S("review-applications/01-pipeline", "Move to menu", "Move an applicant", "Drag a card to another column, or use the Move to menu on the card."),
      S("review-applications/02-applicant", "applicant details", "Open an application", "Click a name to read their details, resume, notes and history."),
      S("review-applications/02-applicant", "Move to", "Change the stage", "Use Move to to change the stage. You can add a note. Every move is saved in their history."),
      S("review-applications/02-applicant", "Close this application", "Close it when not moving forward", "If they are not moving forward, close the application and write an internal reason. If the job allows it, you can send a polite email. It never includes your notes."),
    ],
  },
  {
    id: "send-an-offer",
    title: "Send an offer and track signing",
    subtitle: "Prepare an offer letter and send it for signature.",
    outroSay: "You can resend the link or withdraw the offer. Once the offer is signed, H R can hire the person.",
    steps: [
      S("send-an-offer/01-offer-templates", "merge fields", "Start from a template", "An offer is a letter. Start with an offer template. Fields like the name, start date and role fill in by themselves."),
      S("send-an-offer/02-offer-panel", "stage", "The applicant must be at Offer", "The applicant must be at the Offer stage before you can make an offer."),
      S("send-an-offer/02-offer-panel", "Make an offer", "Open Make an offer", "On their page, open Make an offer."),
      S("send-an-offer/02-offer-panel", "template", "Fill in the details", "Choose the template. Then fill in the role and the start date."),
      S("send-an-offer/02-offer-panel", "pay note", "Pay is only a note", "Pay is only a free text note. Elevate does not store or work out pay."),
      S("send-an-offer/02-offer-panel", "countersigner", "Send and follow it", "Preview the letter, then send it. The applicant signs online, with an emailed link and a six digit code. The status shows Sent, and then Signed."),
    ],
  },
  {
    id: "approve-weekly-hours",
    title: "Approve weekly hours",
    subtitle: "Check each person's week so it can be exported.",
    outroSay: "You can never approve your own hours. Approved hours are what H R exports for payroll. Elevate never works out pay.",
    steps: [
      S("approve-weekly-hours/01-hours-review", "week", "Open Hours review", "Click Hours review in the left menu. It starts on last week. Use Previous and Next to change the week."),
      S("approve-weekly-hours/01-hours-review", "table", "Read each week", "Each row shows the scheduled, worked and extra time, and any flags."),
      S("approve-weekly-hours/02-approve-week", "late flag", "Check the flags first", "Look at flags like Late, Left early or Absent first. Ask the person if you are not sure."),
      S("approve-weekly-hours/02-approve-week", "Approve week", "Approve the week", "Then click Approve week on the person's row."),
      S("approve-weekly-hours/01-hours-review", "Approve everyone", "Approve the clean weeks", "Or click Approve everyone without flags. People with flags are left for you to check."),
    ],
  },
  {
    id: "decide-a-time-off-request",
    title: "Decide a time-off request",
    subtitle: "Approve or decline a request for a day off.",
    outroSay: "A request that is still waiting can be cancelled by the person. Days off here are prize days that H R awards. They are not paid leave.",
    steps: [
      S("decide-a-time-off-request/01-time-off", "Approvals tab", "Open Approvals", "Click Time off in the left menu. Then open the Approvals tab."),
      S("decide-a-time-off-request/02-approvals", "first request", "Read the request", "Each card shows the person, the date and the type of day off."),
      S("decide-a-time-off-request/02-approvals", "status", "The lead first, then HR", "The person's lead decides first. Then H R gives the final decision."),
      S("decide-a-time-off-request/02-approvals", "Approve", "Approve", "Click Approve to accept the request."),
      S("decide-a-time-off-request/02-approvals", "note box", "Decline with a note", "To decline, type a note first. Then click Decline."),
      S("decide-a-time-off-request/01-time-off", "Calendar tab", "Check the calendar", "Use the Calendar tab to see who else is away before you decide."),
    ],
  },
  {
    id: "decide-extra-hours",
    title: "Decide an extra-hours request",
    subtitle: "Review work beyond the schedule.",
    outroSay: "Nobody decides their own request. Elevate labels hours and never works out pay.",
    steps: [
      S("decide-extra-hours/02-requests-to-review", null, "Open Extra hours", "Click Extra hours in the left menu. Work beyond the schedule needs the client's O K and a lead's approval before it counts."),
      S("decide-extra-hours/02-requests-to-review", "Requests to review", "Requests to review", "Leads and H R see the requests to review at the top of the page."),
      S("decide-extra-hours/02-requests-to-review", "queue request", "Check the proof", "Read the client, the time window, the reason, and the screenshot of the client's approval."),
      S("decide-extra-hours/02-requests-to-review", "Approve", "Approve or decline", "Then click Approve or Decline. You may change the time window when you approve."),
      S("decide-extra-hours/02-requests-to-review", "file form", "When the client asks", "If the client asked for extra hours, file it with this form. The person then has to confirm it."),
    ],
  },
  {
    id: "export-hours-for-payroll",
    title: "Export hours for payroll",
    subtitle: "Download approved hours for a pay period.",
    outroSay: "Elevate shows hours only. It never works out pay. Keep the file where payroll keeps its files.",
    steps: [
      S("export-hours-for-payroll/01-hours-export", null, "Attendance, Hours export", "Click Attendance in the left menu. Then open the Hours export tab."),
      S("export-hours-for-payroll/01-hours-export", "progress note", "Check what is approved", "Read the note first. It tells you how many days are not approved yet. Those days are left out of the file."),
      S("export-hours-for-payroll/01-hours-export", "pay period", "Choose the pay period", "Choose the pay period."),
      S("export-hours-for-payroll/01-hours-export", "daily", "Download", "Click Download daily detail for a row per day. Or click Download per person summary for the totals."),
      S("export-hours-for-payroll/01-hours-export", "include box", "Unapproved days", "Only tick this box if you need days that are not approved. Their numbers are not final."),
      S("export-hours-for-payroll/01-hours-export", "pay periods", "Change the periods", "Under How pay periods are cut, you can change to weekly, every two weeks, or monthly."),
    ],
  },
  {
    id: "set-and-import-schedules",
    title: "Set and import schedules",
    subtitle: "Give people shifts, one by one or from the attendance sheet.",
    outroSay: "A person with no schedule gets no late or absent flags. The import never reads worked hours. Elevate is the only source of hours.",
    steps: [
      S("set-and-import-schedules/01-schedules", "people", "Open Schedules", "Click Schedules in the left menu. Everyone sees their own. H R and Super Admin set them."),
      S("set-and-import-schedules/01-schedules", "Set a schedule", "Tick people, then Set a schedule", "Tick the people. Then open Set a schedule. Choose when the shift starts and ends, the working days, the unpaid break, and the start date."),
      S("set-and-import-schedules/01-schedules", "in Manila", "Shown in Manila time too", "Times show in the schedule's time zone, and also in Manila time."),
      S("set-and-import-schedules/02-import-schedules", "upload", "To set many at once", "To set many at once, go to Settings, then Import schedules and clients. Upload the attendance sheet."),
      S("set-and-import-schedules/02-import-schedules", "file types", "CSV or Excel","It can be a C S V or an Excel file, up to two megabytes. Never include client or patient information."),
      S("set-and-import-schedules/02-import-schedules", "earlier uploads", "Read the preview", "Read the preview. Anything Elevate is not sure about goes to a person, with the reason. Then choose the rows to apply."),
    ],
  },
  {
    id: "send-a-document-to-sign",
    title: "Send a document to sign",
    subtitle: "Use ELEVATE Sign to get a document signed online.",
    outroSay: "While you are practicing, tick Mark as test. Then the document can be archived and deleted later.",
    steps: [
      S("send-a-document-to-sign/01-signing", "tabs", "Open Signing", "Click Signing in the left menu. The tabs show the documents to sign, all documents, and templates."),
      S("send-a-document-to-sign/02-send-a-document", "the document", "Choose the document", "To send a new one, choose how it starts. You can write or paste it, upload a P D F, or use a template or a ready made document."),
      S("send-a-document-to-sign/02-send-a-document", "who signs", "Choose who signs", "Under Who signs, add the people. They need an Elevate account. You can add a whole team, or the people assigned to a client."),
      S("send-a-document-to-sign/02-send-a-document", "signing order", "Set the order", "Choose whether everyone signs at the same time, or one after another."),
      S("send-a-document-to-sign/02-send-a-document", "send button", "Send for signature", "Click Send for signature. When everyone has signed, Elevate seals the document and adds a certificate."),
    ],
  },
];
