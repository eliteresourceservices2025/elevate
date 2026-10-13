import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 4: the HIPAA Security Rule, from a workforce member's side. HIPAA only: everyday cybersecurity habits (phishing, home
// network, updates) are in the separate Cybersecurity course. Version 2 of the course. Invented examples only.
// Verified against 45 CFR 164.308, 164.310, 164.312 and HHS's Security Rule summary and NPRM pages (docs/learn/08-source-check.md).

export const m4: CourseModule = {
  key: "security",
  title: "The Security Rule: protecting electronic patient information",
  summary: "What HIPAA requires to keep electronic patient information confidential, accurate and available, and your part in it.",
  estimatedMinutes: 13,
  tracks: ["full"],
  keyPoints: [
    "The Security Rule protects the confidentiality, integrity and availability of electronic patient information (ePHI).",
    "Safeguards are administrative, physical and technical, and you are part of all three.",
    "Your own login and password, and multi-factor sign-in where it is used, are how access is controlled and traced.",
    "Activity in systems is recorded, and logging off or locking your screen is part of the rule's habits.",
    "The Security Rule is being updated. ERS and its clients already work the way the proposal points.",
  ],
  screens: [
    {
      id: "cia",
      title: "What security protects",
      blocks: [
        { type: "paragraph", text: "The Security Rule is about keeping **electronic** patient information safe. It protects three things:" },
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
            "**Administrative**: policies, training, risk analysis, who gets access, how incidents are handled, sanctions.",
            "**Physical**: protecting buildings, rooms, workstations and devices.",
            "**Technical**: unique logins, authentication, encryption, activity logs, automatic log-off.",
          ],
        },
        { type: "paragraph", text: "You are part of all three: you take the training (administrative), protect your workstation and devices (physical), and use the technical tools correctly." },
      ],
    },
    {
      id: "required-addressable",
      title: "\"Required\" and \"addressable\"",
      blocks: [
        { type: "paragraph", text: "Some parts of the Security Rule are **required**. Others are **addressable**: the organization must put them in place, or document why and use an equally effective alternative. Addressable does not mean optional." },
        { type: "callout", tone: "tip", text: "For you the result is simple: the controls ERS and your client set up are not optional for you, whatever label the rule gives them." },
      ],
    },
    {
      id: "access",
      title: "Your login is yours alone",
      blocks: [
        { type: "paragraph", text: "The rule requires every user to have a **unique user identification**, so each action in a system can be tracked to a person. If you share your login, your name is on whatever someone else does." },
        {
          type: "compare",
          left: { title: "Do", items: ["Use your own unique login", "Keep passwords private", "Use multi-factor sign-in every time it is offered", "Sign out when your work is done"] },
          right: { title: "Do not", items: ["Share a password with a teammate", "Let anyone use your session", "Write passwords on a sticky note", "Reuse your work password elsewhere"] },
        },
      ],
    },
    {
      id: "passwords-mfa",
      title: "Passwords and multi-factor sign-in",
      blocks: [
        { type: "paragraph", text: "HIPAA's security awareness training includes **password management**: creating, changing and protecting passwords. The rule also requires systems to **verify that a person is who they say they are**." },
        { type: "paragraph", text: "**Multi-factor authentication (MFA)** adds a second proof, such as a code from an app. The current rule does not name MFA, but ERS and most clients require it, and HHS has proposed making it required." },
        { type: "callout", tone: "tip", text: "If a system asks you for a second step, that is the safeguard doing its job. Never share a code with anyone." },
      ],
    },
    {
      id: "least-privilege",
      title: "Access by role, and logging off",
      blocks: [
        { type: "paragraph", text: "**Access** is limited to what each person's job needs, and it **ends when their work ends**: the rule calls for termination procedures so a former team member's accounts are closed. **Automatic log-off** ends a session after a period of inactivity so a forgotten screen does not stay open." },
        { type: "paragraph", text: "Do not disable, work around or extend these controls. If they get in the way of your work, tell your lead so the right fix can be made." },
      ],
    },
    {
      id: "audit",
      title: "Everything is logged",
      blocks: [
        { type: "paragraph", text: "Systems keep **audit logs**: who opened which record and when. The rule requires organizations to record and examine this activity. Clients and ERS review it. This is how inappropriate access, curiosity and mistakes are found." },
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
        { type: "paragraph", text: "**Transmission security** means information is protected while it travels over a network. Use only the channels your client approved: their secure portal, encrypted email, or the system they set up." },
        {
          type: "list",
          items: [
            "Do not use personal email, text messages or consumer chat apps for patient information.",
            "Check the address twice before sending.",
            "Attach only what is needed, and never more than the minimum.",
          ],
        },
      ],
    },
    {
      id: "integrity-availability",
      title: "Keeping information accurate and available",
      blocks: [
        { type: "paragraph", text: "**Integrity** means protecting information from being changed or destroyed improperly. Be careful when you edit or enter data: a wrong date or a wrong patient can cause real harm to care and billing." },
        { type: "paragraph", text: "**Availability** means people can reach the information when they need it. Backups and recovery plans exist so it can be restored after a virus, a crash or a disaster, and a data backup plan is a required part of contingency planning. Do not delete records, turn off backups or install tools unless you have been told to. If something stops working, report it." },
      ],
    },
    {
      id: "awareness",
      title: "What HIPAA expects you to be trained on",
      blocks: [
        { type: "paragraph", text: "The rule's security awareness and training standard names four things a workforce is trained on:" },
        {
          type: "steps",
          items: [
            { title: "Security reminders", text: "Periodic updates on security." },
            { title: "Protection from malicious software", text: "Recognizing and reporting it." },
            { title: "Log-in monitoring", text: "Reporting unusual sign-in activity." },
            { title: "Password management", text: "Creating, changing and protecting passwords." },
          ],
        },
        { type: "callout", tone: "info", text: "Everyday cybersecurity skills, such as spotting phishing messages, are taught in ERS's separate Cybersecurity course. If you see something that looks like an attack, report it straight away. Module 6 explains how." },
      ],
    },
    {
      id: "rule-changing",
      title: "The Security Rule is being updated",
      blocks: [
        { type: "paragraph", text: "In December 2024 HHS proposed a stricter Security Rule. Among other things, it would make multi-factor authentication and encryption of electronic patient information required (with limited exceptions), remove the \"addressable\" category, and require written incident response plans that are tested." },
        { type: "paragraph", text: "It is a **proposal**. The current rule stays in effect until HHS finishes its work. ERS and its clients already use many of these practices, so your daily habits do not change." },
        { type: "callout", tone: "tip", text: "ERS updates this course when the rules change. Always follow the version in front of you and your client's instructions." },
      ],
    },
    {
      id: "scenario-old-account",
      title: "Try it: the account that should have closed",
      blocks: [
        {
          type: "scenario",
          title: "A former teammate is still in the system",
          prompt: "A teammate left ERS a month ago. While working in a client's system you notice their account is still active and was used yesterday.",
          choices: [
            { text: "Ignore it. Someone else will have noticed.", feedback: "An account that should have ended and is still in use is a serious gap. Report it.", best: false },
            { text: "Do not use or touch it, and tell your lead and HR straight away.", feedback: "Correct. Access must end with the work, and a possibly misused account is a security incident.", best: true },
            { text: "Use the account yourself to check what it can open.", feedback: "That would be using someone else's login, which is itself a violation.", best: false },
          ],
        },
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
  q("security", "CIA", "multiple", "Which three goals does the Security Rule protect? Select all that apply.", ["Confidentiality", "Integrity", "Availability", "Popularity"], [0, 1, 2], "The Security Rule protects the confidentiality, integrity and availability of electronic PHI."),
  q("security", "CIA", "single", "A ransomware attack locks a clinic's records so staff cannot open them. Which goal is most directly affected?", ["Availability", "Confidentiality", "Marketing", "Billing accuracy only"], [0], "Ransomware blocks access to information, which is a failure of availability."),
  q("security", "Safeguards", "single", "A policy that requires staff to complete HIPAA training is an example of which kind of safeguard?", ["Administrative", "Physical", "Technical", "Financial"], [0], "Policies, training and procedures are administrative safeguards."),
  q("security", "Safeguards", "single", "Locking a door to the room that holds servers is an example of which kind of safeguard?", ["Physical", "Administrative", "Technical", "Legal"], [0], "Protecting rooms, buildings and equipment is a physical safeguard."),
  q("security", "Safeguards", "single", "A system that makes each user sign in with their own unique login is an example of which kind of safeguard?", ["Technical", "Physical", "Administrative", "Cosmetic"], [0], "Unique user identification and authentication are technical safeguards."),
  q("security", "Required and addressable", "single", "In the Security Rule, what does it mean when a specification is \"addressable\"?", ["The organization must implement it, or document why and use an equally effective alternative", "It is optional and can be ignored", "Only the IT team must read it", "It applies only to paper records"], [0], "Addressable is not optional. The organization implements it or documents an equivalent alternative."),
  q("security", "Credentials", "single", "A teammate's account is locked and a deadline is near. They ask to use your login for an hour. What do you do?", ["Decline, and help them reach support or your lead to fix their account", "Share it and change the password later", "Share it only if they promise not to open anything else", "Stay logged in and step away while they use it"], [0], "Logins are personal. Sharing puts your name on their actions and breaks access controls and audit logs."),
  q("security", "Passwords", "single", "Which is part of HIPAA's security awareness training for the workforce?", ["Password management: creating, changing and protecting passwords", "Choosing which patients to call", "Setting prices for services", "Writing marketing messages"], [0], "The security awareness and training standard includes password management, security reminders, malicious software and log-in monitoring."),
  q("security", "Audit logs", "true_false", "True or false: Access to patient records is logged, so looking at a record without a work reason can be found later.", ["True", "False"], [0], "Audit logs record who opened what and when, and are reviewed to detect misuse."),
  q("security", "Transmission", "single", "Which is an appropriate way to send patient information?", ["Through the secure channel your client approved", "By a personal text message", "Through a personal email account", "In a public group chat"], [0], "Use only approved, secure channels. Personal email, texts and consumer chat apps are not approved."),
  q("security", "Access ends with work", "single", "You see that a former teammate's account in a client system is still active. What should you do?", ["Leave it alone and report it to your lead and HR right away", "Use it, since it is still working", "Ignore it", "Delete the account yourself"], [0], "Access must end with the work (termination procedures). An account that should be closed but is still active needs to be reported, not used or fixed quietly."),
  q("security", "The rule is changing", "true_false", "True or false: The stricter Security Rule that HHS proposed is already in effect, replacing the current rule.", ["True", "False"], [1], "It is a proposal. The current Security Rule remains in effect while HHS works on it."),
];
