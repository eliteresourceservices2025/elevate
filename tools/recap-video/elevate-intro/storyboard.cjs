// The ELEVATE introduction video: what it is, then a tour of the features. Wording is the owner-approved script (script.md), split
// into one on-screen step per picture.
//   S(label, image, focus, caption, say)
//   label    the small tag at the top left of the step
//   image    "<guide>/<file>" of a fake-data screenshot in apps/elevate/content/help/assets, or { panel } for a drawn panel
//   focus    a target name from assets/_boxes.json, an explicit box { x, y, w, h } in picture pixels, or null
//   caption  what is shown on screen (written normally: HIPAA)
//   say      what the voice says, spelled the way it is pronounced (HIPAA is written "Heepa", the way the company says it)
// Narration rule: the voice says "ELITE Resource Services", never "ERS" (build.cjs fails if a standalone ERS appears anywhere).
const S = (label, image, focus, caption, say) => ({ label, image, focus, caption, say });

module.exports = {
  id: "elevate-intro",
  title: "Welcome to ELEVATE",
  subtitle: "Your home at ELITE Resource Services",
  introSay: "Welcome to ELEVATE, the home for everyone at ELITE Resource Services.",
  outroSay: "That is ELEVATE. Built for you, by ELITE Resource Services. Welcome aboard.",
  steps: [
    S("Welcome", "find-your-way-around/01-menu", null, "One place for your work life", "Your schedule, your time, your documents, your training and your questions all live in one place. This short tour shows you what is here."),
    S("Sign in", { panel: { icon: "lock", lines: ["Sign in with your password", "Then enter the code from your authenticator app", "Takes a few seconds. Keeps everyone safe."] } }, null, "Signing in is secure", "First, signing in. ELEVATE asks for a security code from your authenticator app each time. It takes a few seconds, and it keeps your information, and our clients' trust, safe."),
    S("Time clock", "clock-in-and-out/01-clock", "clock button", "Clock in, take breaks, clock out", "Next, the time clock. Clock in when you start, take your breaks, and clock out when you finish. ELEVATE keeps your hours, so there is one clear record."),
    S("Time clock", "clock-in-and-out/02-my-time", null, "Forgot to clock out? Ask for a correction", "Forgot to clock out? Ask for a time correction, and your lead will review it."),
    S("Schedules", "see-your-schedule/01-schedule", "in Manila", "Your shifts, in two time zones", "Schedules show your shifts in your client's time zone and in Manila time."),
    S("Time off", "request-time-off/01-prize-days", "Request time off", "Ask for time off", "You can ask for time off."),
    S("Extra hours", "ask-for-extra-hours/01-ask-extra-hours", "client", "Ask for extra hours", "And ask for extra hours when a client needs more of you, all with a clear answer from your lead."),
    S("Documents", "upload-your-documents/01-documents", "folder", "Your files, private, in folders", "Documents keeps your files in one private place, in folders you choose. When something needs your signature, ELEVATE Sign walks you through it."),
    S("Announcements", "acknowledge-announcements-and-policies/01-announcements", "needs ack", "News, policies and videos", "Announcements bring company news, policies and now videos right to you. When something needs your acknowledgment, you will see a reminder until it is done."),
    S("Your profile", "update-your-profile/01-profile", "about me", "Your details", "Your profile holds your details."),
    S("My data", "see-what-elevate-holds-about-you/01-my-data", "ask HR", "See what we keep about you", "My data shows exactly what we keep about you, and lets you ask for a correction."),
    S("Training", "take-your-training/01-my-training", "open button", "HIPAA and Cybersecurity basics", "Training happens in ELEVATE Learn: Heepa and Cybersecurity basics, with short videos, an exam and a certificate you can download."),
    S("Speak up", "report-something-anonymously/01-send-a-report", "about", "Safe Voice: completely anonymous", "Need to speak up? Safe Voice lets you raise a concern completely anonymously."),
    S("Speak up", "report-a-privacy-concern/01-incidents", "report button", "Report a privacy mistake", "If you spot a privacy mistake, report it in privacy incidents."),
    S("Support", "ask-for-help/01-contact-support", null, "Contact support is one click away", "And if something in ELEVATE is not working, Contact support is one click away."),
    S("Help center", "find-your-way-around/01-menu", { x: 8, y: 940, w: 242, h: 48 }, "Step by step guides, with videos", "The Help center has step by step guides with pictures and videos for everything you just saw."),
    S("What's new", { panel: { icon: "sparkle", lines: ["What's new", "Every release, with its version", "Watch the video for each update"] } }, null, "What's new tells you every update", "And the What's new page tells you each time ELEVATE gets better."),
  ],
};
