import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 4: the Security Rule and safeguards. Invented examples only.

export const m4: CourseModule = {
  key: "security",
  title: "The Security Rule and safeguards",
  summary: "How electronic patient information is kept confidential, accurate and available, and the everyday habits that make it work.",
  estimatedMinutes: 12,
  tracks: ["full"],
  keyPoints: [
    "Security protects three things: confidentiality, integrity and availability.",
    "Safeguards come in three kinds: administrative, physical and technical.",
    "Use your own login, a strong password and multi-factor authentication. Never share them.",
    "Lock your screen every time you step away.",
    "If something looks wrong with a system, report it. Do not try to fix it quietly.",
  ],
  screens: [
    {
      id: "cia",
      title: "What security protects",
      blocks: [
        { type: "paragraph", text: "The Security Rule is about keeping electronic patient information safe. It protects three things:" },
        {
          type: "steps",
          items: [
            { title: "Confidentiality", text: "Only the right people can see it." },
            { title: "Integrity", text: "It is accurate and has not been changed by mistake or on purpose." },
            { title: "Availability", text: "The people who need it can get to it when they need it." },
          ],
        },
        { type: "callout", tone: "info", text: "A ransomware attack that locks a clinic out of its records is a security incident even if no one reads a single record." },
      ],
    },
    {
      id: "three-safeguards",
      title: "Three kinds of safeguards",
      blocks: [
        { type: "paragraph", text: "The rule asks organizations to use three kinds of safeguards together:" },
        {
          type: "list",
          items: [
            "**Administrative**: policies, training, risk checks, who gets access, how incidents are handled.",
            "**Physical**: protecting buildings, rooms, computers and devices.",
            "**Technical**: passwords, multi-factor sign-in, encryption, activity logs, automatic log-off.",
          ],
        },
        { type: "paragraph", text: "You are part of all three: you take the training (administrative), protect your workspace and devices (physical), and use the technical tools correctly." },
      ],
    },
    {
      id: "access",
      title: "Your login is yours alone",
      blocks: [
        { type: "paragraph", text: "Every action in a system is recorded against a user. If you share your login, your name is on whatever someone else does." },
        {
          type: "compare",
          left: { title: "Do", items: ["Use your own unique login", "Keep passwords private and long", "Use multi-factor authentication every time", "Sign out when your work is done"] },
          right: { title: "Do not", items: ["Share a password with a teammate", "Let anyone use your session", "Write passwords on a sticky note", "Reuse your work password on other sites"] },
        },
      ],
    },
    {
      id: "passwords",
      title: "Strong passwords and MFA",
      blocks: [
        { type: "paragraph", text: "A long passphrase of several unrelated words is stronger and easier to remember than a short complex password. Use a password manager if your client allows one." },
        { type: "paragraph", text: "**Multi-factor authentication (MFA)** adds a second proof, such as a code from an app. It greatly reduces the chance that a stolen password alone is enough to get in." },
        { type: "callout", tone: "warning", title: "Unexpected prompts", text: "If you get an MFA prompt you did not start, deny it and report it. Someone may be trying to sign in as you." },
      ],
    },
    {
      id: "least-privilege",
      title: "Least privilege and auto log-off",
      blocks: [
        { type: "paragraph", text: "**Least privilege** means each person gets only the access their job needs. **Automatic log-off** signs a session out after a short idle time so a forgotten screen does not stay open." },
        { type: "paragraph", text: "Do not disable, work around or extend these controls. If they get in the way of your work, tell your lead so the right fix can be made." },
      ],
    },
    {
      id: "audit",
      title: "Everything is logged",
      blocks: [
        { type: "paragraph", text: "Systems keep **audit logs**: who opened which record and when. Clients and ERS review them. This is how inappropriate access, curiosity and mistakes are found." },
        {
          type: "check",
          question: "Why does it matter that audit logs exist?",
          options: [
            { text: "They record who accessed what, so misuse can be found", correct: true, feedback: "Right. Logs are how organizations notice and investigate problems." },
            { text: "They let you hide your activity", correct: false, feedback: "Logs do the opposite." },
            { text: "They are only for IT staff and do not matter to you", correct: false, feedback: "They record your actions too." },
          ],
        },
      ],
    },
    {
      id: "transmission",
      title: "Sending information safely",
      blocks: [
        { type: "paragraph", text: "**Transmission security** means information is protected while it travels. Use only the channels your client approved: their secure portal, encrypted email, or the system they set up." },
        {
          type: "list",
          items: [
            "Do not use personal email, text messages or consumer chat apps for patient information.",
            "Check the address twice before sending.",
            "Attach only what is needed, and never include more than the minimum.",
          ],
        },
      ],
    },
    {
      id: "integrity-availability",
      title: "Keeping information accurate and available",
      blocks: [
        { type: "paragraph", text: "Be careful when you edit or enter data. A wrong date or a wrong patient can cause real harm to care and billing." },
        { type: "paragraph", text: "Do not delete records, turn off backups or install tools unless you have been told to. If something stops working, report it so availability can be restored." },
        { type: "callout", tone: "tip", text: "Double-check the patient and the field before you save. Fixing a wrong entry later is harder than getting it right the first time." },
      ],
    },
    {
      id: "scenario-shared-login",
      title: "Try it: the shared login",
      blocks: [
        {
          type: "scenario",
          title: "A teammate asks to use your login",
          prompt: "A teammate's account is not working and a deadline is close. They ask to use your login \"just for an hour\".",
          choices: [
            { text: "Share it for the hour and change the password afterward.", feedback: "Everything they do will be recorded as you, and the access was not approved for them.", best: false },
            { text: "Say no, help them contact the client's support or your lead to fix their account, and keep your login private.", feedback: "Correct. Each person uses their own account, and access problems go to support.", best: true },
            { text: "Log in, then walk away and let them use your open session.", feedback: "That is the same as sharing your login, and it also leaves the screen unattended.", best: false },
          ],
        },
      ],
    },
  ],
};

export const q4: QuestionSeed[] = [
  q("security", "CIA", "multiple", "Which three goals does the Security Rule protect? Select all that apply.", ["Confidentiality", "Integrity", "Availability", "Popularity"], [0, 1, 2], "The Security Rule protects confidentiality, integrity and availability of electronic PHI."),
  q("security", "CIA", "single", "A ransomware attack locks a clinic's records so staff cannot open them. Which goal is most directly affected?", ["Availability", "Confidentiality", "Marketing", "Billing accuracy only"], [0], "Ransomware blocks access to information, which is a failure of availability."),
  q("security", "Safeguards", "single", "A policy that requires staff to complete HIPAA training is an example of which kind of safeguard?", ["Administrative", "Physical", "Technical", "Financial"], [0], "Policies, training and procedures are administrative safeguards."),
  q("security", "Safeguards", "single", "Locking a door to the room that holds servers is an example of which kind of safeguard?", ["Physical", "Administrative", "Technical", "Legal"], [0], "Protecting rooms, buildings and equipment is a physical safeguard."),
  q("security", "Safeguards", "single", "Multi-factor authentication is an example of which kind of safeguard?", ["Technical", "Physical", "Administrative", "Cosmetic"], [0], "MFA is a technical safeguard that verifies the identity of a person signing in."),
  q("security", "Credentials", "single", "A teammate's account is locked and a deadline is near. They ask to use your login for an hour. What do you do?", ["Decline, and help them reach support or your lead to fix their account", "Share it and change the password later", "Share it only if they promise not to open anything else", "Stay logged in and step away while they use it"], [0], "Logins are personal. Sharing puts your name on their actions and breaks access controls."),
  q("security", "Passwords", "single", "Which is the strongest choice for a password?", ["A long passphrase of several unrelated words", "Your birth date", "The word \"Password1!\"", "Your pet's name"], [0], "Length and unpredictability matter most. A long passphrase of unrelated words is both strong and memorable."),
  q("security", "MFA", "single", "You receive a multi-factor sign-in prompt on your phone that you did not start. What should you do?", ["Deny it and report it to your lead right away", "Approve it to make the prompts stop", "Ignore it and keep working", "Approve it, then change your password tomorrow"], [0], "An unexpected prompt may mean someone has your password. Deny it and report it."),
  q("security", "Audit logs", "true_false", "True or false: Access to patient records is logged, so looking at a record without a work reason can be found later.", ["True", "False"], [0], "Audit logs record who opened what and when, and are reviewed to detect misuse."),
  q("security", "Transmission", "single", "Which is an appropriate way to send patient information?", ["Through the secure channel your client approved", "By a personal text message", "Through a personal email account", "In a public group chat"], [0], "Use only approved, secure channels. Personal email, texts and consumer chat apps are not approved."),
];
