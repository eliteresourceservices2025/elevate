import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 6: the Security Rule and the place you work. Version 2 (deeper); folds the former "protecting information where you
// work" module into the physical and technical safeguards. Grounded in 45 CFR 164.308 (administrative), 164.310 (physical), 164.312
// (technical) and 164.316 (documentation), HHS's Security Rule summary and the ONC guide, chapters 4 and 6. All people and details
// in examples are invented. Counsel reviews this before it is published.

export const m6: CourseModule = {
  key: "security",
  title: "The Security Rule: protecting electronic patient information",
  summary: "What the Security Rule protects, how its three kinds of safeguards fit together, what risk analysis is, and how it shapes your workstation, devices, sign-in and daily habits.",
  estimatedMinutes: 24,
  tracks: ["full"],
  keyPoints: [
    "The Security Rule protects the confidentiality, integrity and availability of electronic patient information.",
    "It asks for administrative, physical and technical safeguards, chosen after a risk analysis.",
    "Addressable does not mean optional: it means implement it, or document why and use an equal alternative.",
    "Your login is yours alone, and everything done with it is logged.",
    "Your workstation is part of the client's workplace, wherever it is.",
    "Use only approved systems, and keep extra copies of patient information from existing.",
    "A lost or stolen device is an incident: report it immediately.",
  ],
  screens: [
    {
      id: "why-separate",
      title: "Why there is a separate Security Rule",
      blocks: [
        { type: "paragraph", text: "The Privacy Rule says who may see information. It does not, by itself, stop someone from stealing a laptop, guessing a password or opening an infected email. The **Security Rule** fills that gap for **electronic** protected health information (ePHI): it requires safeguards so that the allowed uses are the only uses that happen." },
        { type: "callout", tone: "info", text: "The rule is deliberately flexible: it tells organizations what to achieve and lets them choose how, based on their size, their risks and the technology they use." },
      ],
    },
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
        { type: "paragraph", text: "The rule asks organizations to use three kinds of safeguards together, on top of the Privacy Rule's own reasonable safeguards for all PHI:" },
        {
          type: "layers",
          title: "Safeguards for electronic PHI",
          items: [
            { label: "Technical", text: "Unique logins, authentication, encryption, activity logs, automatic log-off." },
            { label: "Physical", text: "Protecting buildings, rooms, workstations and devices." },
            { label: "Administrative", text: "Policies, training, risk analysis, who gets access, how incidents are handled, sanctions." },
          ],
        },
        { type: "paragraph", text: "You are part of all three: you take the training (administrative), protect your workstation and devices (physical), and use the technical tools correctly." },
      ],
    },
    {
      id: "risk-analysis",
      title: "Risk analysis: how the safeguards are chosen",
      blocks: [
        { type: "paragraph", text: "The heart of the rule is a **risk analysis**: finding where ePHI is, what could go wrong with it, and how likely and how serious each risk is. The safeguards then follow the risks, and the work is repeated as things change." },
        {
          type: "steps",
          items: [
            { title: "Find the information", text: "Where is ePHI created, stored, sent and received?" },
            { title: "Find the risks", text: "What threats and weaknesses could expose, change or block it?" },
            { title: "Rate them", text: "How likely, and how harmful?" },
            { title: "Act and document", text: "Put safeguards in place and write down what was decided." },
            { title: "Review again", text: "When the work, the tools or the threats change." },
          ],
        },
        { type: "callout", tone: "tip", text: "You help the analysis by reporting what you see: a tool nobody approved, a shared account, a place where patient information piles up." },
      ],
    },
    {
      id: "required-addressable",
      title: "\"Required\" and \"addressable\"",
      blocks: [
        { type: "paragraph", text: "Some parts of the Security Rule are **required**. Others are **addressable**: the organization must put them in place, or document why not and use an equally effective alternative. Addressable does not mean optional." },
        {
          type: "compare",
          left: { title: "Required", items: ["Must be implemented as written", "Example: a data backup plan", "Example: a risk analysis"] },
          right: { title: "Addressable", items: ["Implement it, or", "Document why it is not reasonable and appropriate", "And use an equal alternative"] },
        },
        { type: "callout", tone: "tip", text: "For you the result is simple: the controls ERS and your client set up are not optional for you, whatever label the rule gives them." },
      ],
    },
    {
      id: "administrative",
      title: "Administrative safeguards in plain words",
      blocks: [
        {
          type: "table",
          caption: "What the rule asks of the organization",
          columns: ["Standard", "In plain words", "Where you meet it"],
          rows: [
            ["Security management", "Analyze risks, manage them, apply sanctions, review activity", "Sanctions, audit logs"],
            ["Assigned responsibility", "Someone is named responsible for security", "The Privacy and Security contact"],
            ["Workforce security", "Access is authorized, supervised and ended when work ends", "Your account and its closing"],
            ["Information access management", "People get only the access their role needs", "Role-based access"],
            ["Awareness and training", "Reminders, malware protection, log-in monitoring, password management", "This course"],
            ["Incident procedures", "Respond to and report security incidents", "Module 7"],
            ["Contingency plan", "Backups, disaster recovery, emergency operation", "Why you never delete records"],
          ],
        },
      ],
    },
    {
      id: "physical",
      title: "Physical safeguards and your workspace",
      blocks: [
        { type: "paragraph", text: "The rule requires policies on how a workstation that can reach patient information is **used**, and on the **physical safeguards** around it. Working from home does not lower the standard: for as long as patient information is on your screen, your workspace is part of the client's workplace." },
        {
          type: "list",
          items: [
            "Work in a space where others cannot see your screen or hear your calls.",
            "Position your screen away from windows and doorways.",
            "Keep family, roommates and visitors out of view of patient information.",
            "Lock your computer whenever you step away, even at home.",
            "Keep a tidy desk: no notes or printouts with patient details left out.",
          ],
        },
      ],
    },
    {
      id: "approved-systems",
      title: "Approved systems only",
      blocks: [
        { type: "paragraph", text: "Use only the systems, tools and accounts your client and ERS approved. A convenient tool is not an approved tool." },
        {
          type: "compare",
          left: { title: "Approved", items: ["The client's EHR or portal", "The email and chat your client set up", "Devices and software ERS or the client provided or approved"] },
          right: { title: "Not approved", items: ["Personal email or messaging apps", "Free file-sharing or notes apps", "AI chatbots and online converters that receive pasted patient information"] },
        },
        { type: "callout", tone: "warning", text: "Pasting patient information into a public AI tool, translator or converter is a disclosure to an unauthorized party." },
      ],
    },
    {
      id: "storing",
      title: "Saving, downloading, printing and photographing",
      blocks: [
        { type: "paragraph", text: "The safest place for patient information is where it already is: inside the client's system. Every extra copy is another place it can leak, and another thing the client cannot control." },
        {
          type: "list",
          items: [
            "Do not save patient information on your own computer unless your client allows it.",
            "Do not put it in personal cloud storage or notes apps.",
            "Do not print it at home, or photograph a screen, unless the client has told you how.",
            "Do not forward it to yourself to \"finish later\".",
          ],
        },
        { type: "callout", tone: "tip", text: "If you need to keep something to do your task, ask. The answer may be a safe place the client already has." },
      ],
    },
    {
      id: "devices-media",
      title: "Devices and media",
      blocks: [
        { type: "paragraph", text: "The rule has a standard for **device and media controls**: how devices and storage that hold ePHI are received, moved, reused and disposed of. At your desk, that means:" },
        {
          type: "list",
          items: [
            "Use only devices and storage your client or ERS approved.",
            "Never reuse or give away a device, drive or memory stick that held patient information without it being wiped the approved way.",
            "Do not take devices from the work area for repair or sale without asking.",
            "Never leave a work device unattended in a car, a cafe or a shared space.",
          ],
        },
      ],
    },
    {
      id: "lost-device",
      title: "Lost, stolen or shared devices",
      blocks: [
        { type: "paragraph", text: "A lost or stolen laptop, phone or drive that holds or could reach patient information is a **security incident** from the moment you notice. Encryption can reduce the risk, but whether anyone must be notified is the client's decision." },
        {
          type: "steps",
          items: [
            { title: "Report immediately", text: "Tell your lead and HR right away, even at night." },
            { title: "Say what it could reach", text: "Which accounts and systems were signed in." },
            { title: "Follow the instructions", text: "You may be asked to change passwords or sign out sessions." },
            { title: "Do not wait or search first", text: "Time matters more than recovering the device yourself." },
          ],
        },
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
        {
          type: "check",
          question: "You notice your login can open another team's patient files. What should you do?",
          options: [
            { text: "Do not open them, and tell your lead", correct: true, feedback: "Right. Extra access is a gap to be fixed, not a permission." },
            { text: "Look around once to see how the system works", correct: false, feedback: "Exploring is itself a violation." },
            { text: "Ignore it and tell nobody", correct: false, feedback: "Extra access should be reported so it can be removed." },
          ],
        },
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
            "Check a fax number or a link before you send, and confirm receipt if your client asks.",
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
      id: "rule-changing",
      title: "The Security Rule is being updated",
      blocks: [
        { type: "paragraph", text: "HHS announced a proposal for a stricter Security Rule in December 2024, and it was published for comment in January 2025. Among other things, it would make multi-factor authentication and encryption of electronic patient information required (with limited exceptions), remove the \"addressable\" category, and require written incident response plans that are tested." },
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
      id: "scenario-cafe",
      title: "Try it: the cafe",
      blocks: [
        {
          type: "scenario",
          title: "The internet is down at home",
          prompt: "Your home internet is out and a client deadline is two hours away. A nearby cafe has free Wi-Fi, and the only seat is at a table beside a window facing the street.",
          choices: [
            { text: "Work there and keep the screen dim.", feedback: "People nearby and through the window can still see the screen, and public Wi-Fi is not approved.", best: false },
            { text: "Tell your lead about the outage and ask for the approved way to continue, such as a secure hotspot or a handoff.", feedback: "Correct. Your lead and client can arrange a safe way, and the deadline is theirs to adjust.", best: true },
            { text: "Work there, but only on tasks with fewer patient names.", feedback: "Fewer names is still PHI in a place without safeguards.", best: false },
          ],
        },
      ],
    },
    {
      id: "play-safeguard-sorter",
      title: "Play: which kind of safeguard?",
      blocks: [
        { type: "paragraph", text: "The Security Rule groups its safeguards into three kinds. Sort each example the way this module does." },
        {
          type: "cards",
          title: "Safeguard sorter",
          prompt: "Is this an administrative, physical or technical safeguard?",
          groups: ["Administrative", "Physical", "Technical"],
          cards: [
            { text: "Training every team member on HIPAA", group: 0, feedback: "Policies, training and procedures are administrative safeguards." },
            { text: "A risk analysis that is repeated when things change", group: 0, feedback: "Finding and rating risks is the heart of the administrative safeguards." },
            { text: "Sanctions for breaking the rules", group: 0, feedback: "Sanctions sit under security management, an administrative safeguard." },
            { text: "Positioning your screen away from windows and doorways", group: 1, feedback: "Protecting workstations and the space around them is a physical safeguard." },
            { text: "Never leaving a work device unattended in a car", group: 1, feedback: "Device and media controls are physical safeguards." },
            { text: "Keeping patient printouts off a tidy desk", group: 1, feedback: "A tidy workspace is a physical safeguard." },
            { text: "A unique login for each person", group: 2, feedback: "Unique user identification is a technical safeguard." },
            { text: "A code from an app as a second sign-in step", group: 2, feedback: "Verifying who someone is, including multi-factor sign-in, is a technical safeguard." },
            { text: "Automatic log-off after a period of inactivity", group: 2, feedback: "Automatic log-off is a technical safeguard." },
          ],
        },
      ],
    },
    {
      id: "play-flexible-rule",
      title: "Play: a flexible rule, and spot the risk",
      blocks: [
        { type: "paragraph", text: "The Security Rule tells organizations what to achieve and lets them choose how. Flip the cards to see what shapes those choices." },
        {
          type: "flip",
          title: "What shapes the choices",
          cards: [
            { front: "Size and capabilities", back: "A large company and a small clinic may meet the same goal in different ways." },
            { front: "Technical setup", back: "The systems and tools in use change which safeguards fit." },
            { front: "Cost of the measures", back: "Cost is a fair thing to weigh, but it never excuses leaving a serious risk open." },
            { front: "How likely and how serious", back: "Bigger risks get stronger safeguards. This is what the risk analysis rates." },
          ],
        },
        {
          type: "spot",
          title: "Spot the risk",
          prompt: "A teammate describes a workday in a team chat. Tap the line that creates a security risk.",
          lines: [
            { speaker: "Teammate", text: "I started with the client's approved portal and signed in with my own login." },
            { speaker: "Teammate", text: "My home internet is slow, so I saved the day's patient list to my personal cloud drive to finish it tonight.", wrong: true },
            { speaker: "Lead", text: "Please don't. Leave it in the client's system and pick it up there tomorrow." },
            { speaker: "Teammate", text: "Got it. I'll delete my copy and report it so the client can check." },
          ],
          explanation: "A personal cloud drive is not approved, and every extra copy is another place the information can leak. The safest place for patient information is where it already is, and a copy made by mistake is reported.",
        },
      ],
    },
    {
      id: "check-the-desk",
      title: "Check the desk: what puts patient information at risk?",
      blocks: [
        {
          type: "hotspot",
          title: "A remote workstation at home",
          prompt: "A team member is about to start a shift. Tap everything on this setup that puts patient information at risk, then check.",
          items: [
            { label: "Sticky note", text: "A password written on the monitor", problem: true, why: "Anyone in the room can read and use it." },
            { label: "Screen", text: "Faces the window and the hallway", problem: true, why: "Visitors and passers-by can read what is on it." },
            { label: "Screen lock", text: "Locks after two minutes" },
            { label: "Wi-Fi", text: "Home network with a strong password" },
            { label: "Printer", text: "A printout of a client list left in the tray", problem: true, why: "Paper with patient information must not be left where others can see it." },
            { label: "Software", text: "Only the client's approved tools" },
          ],
          explanation: "Security is a set of habits: no written passwords, a screen nobody else can see, lock when you step away, nothing left on paper. Fix what you can and report what you cannot.",
        },
      ],
    },
    {
      id: "quick-round-security",
      title: "Quick round: the Security Rule",
      blocks: [
        {
          type: "game",
          title: "Security sprint",
          seconds: 20,
          rounds: [
            {
              question: "Which three goals does the Security Rule protect?",
              options: [
                { text: "Confidentiality, integrity and availability", correct: true, feedback: "Only the right people see it, it stays accurate, and it can be reached." },
                { text: "Cost, speed and style", correct: false, feedback: "Those are not the goals." },
                { text: "Billing, coding and claims", correct: false, feedback: "Those are business tasks, not security goals." },
              ],
            },
            {
              question: "What does \"addressable\" mean in the Security Rule?",
              options: [
                { text: "Implement it, or document why not and use an equal alternative", correct: true, feedback: "Addressable is not optional." },
                { text: "You can skip it", correct: false, feedback: "That is the common mistake." },
                { text: "Only for paper records", correct: false, feedback: "The rule is about electronic information." },
              ],
            },
            {
              question: "Your work laptop goes missing. What is the first move?",
              options: [
                { text: "Tell your lead and HR immediately", correct: true, feedback: "A lost device is an incident from the moment you notice." },
                { text: "Search for a day first", correct: false, feedback: "Time matters more than recovering it yourself." },
                { text: "Wait to see if it turns up", correct: false, feedback: "Waiting uses up the client's time." },
              ],
            },
            {
              question: "A coworker asks to borrow your login for an hour. You:",
              options: [
                { text: "Decline and help them reach support or your lead", correct: true, feedback: "Logins are personal, and your name goes on their actions." },
                { text: "Share it and change the password later", correct: false, feedback: "Sharing breaks access controls and audit logs." },
                { text: "Share it if they promise to be careful", correct: false, feedback: "A promise does not change whose name is in the log." },
              ],
            },
            {
              question: "The stricter Security Rule HHS proposed is:",
              options: [
                { text: "A proposal, and the current rule stays in effect", correct: true, feedback: "ERS updates this course when the rules change." },
                { text: "Already in effect", correct: false, feedback: "It has not been finished." },
                { text: "Cancelled forever", correct: false, feedback: "It is a proposal still under work." },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "terms",
      title: "Terms from this module",
      blocks: [
        {
          type: "glossary",
          terms: [
            { term: "Security Rule", meaning: "The HIPAA rule that requires safeguards for electronic protected health information." },
            { term: "Confidentiality, integrity, availability", meaning: "The three goals: only the right people see it, it stays accurate, and it can be reached when needed." },
            { term: "Risk analysis", meaning: "Finding where ePHI is, what could go wrong with it, and how serious each risk is." },
            { term: "Addressable", meaning: "A specification the organization implements, or documents why not and uses an equal alternative." },
            { term: "Unique user identification", meaning: "A login that belongs to one person, so every action can be traced." },
            { term: "Audit log", meaning: "A record of who accessed which information and when." },
            { term: "Multi-factor authentication", meaning: "Signing in with a second proof, such as a code from an app, in addition to a password." },
          ],
        },
      ],
    },
  ],
};

export const q6: QuestionSeed[] = [
  q("security", "CIA", "multiple", "Which three goals does the Security Rule protect? Select all that apply.", ["Confidentiality", "Integrity", "Availability", "Popularity"], [0, 1, 2], "The Security Rule protects the confidentiality, integrity and availability of electronic PHI."),
  q("security", "CIA", "single", "A ransomware attack locks a clinic's records so staff cannot open them. Which goal is most directly affected?", ["Availability", "Confidentiality", "Marketing", "Billing accuracy only"], [0], "Ransomware blocks access to information, which is a failure of availability."),
  q("security", "Scope", "single", "Which kind of information does the Security Rule apply to?", ["Electronic protected health information", "Only paper records", "Only spoken conversations", "Only information about doctors"], [0], "The Security Rule applies to ePHI. The Privacy Rule's reasonable safeguards cover PHI in other forms."),
  q("security", "Safeguards", "single", "A policy that requires staff to complete HIPAA training is an example of which kind of safeguard?", ["Administrative", "Physical", "Technical", "Financial"], [0], "Policies, training and procedures are administrative safeguards."),
  q("security", "Safeguards", "single", "Locking a door to the room that holds servers is an example of which kind of safeguard?", ["Physical", "Administrative", "Technical", "Legal"], [0], "Protecting rooms, buildings and equipment is a physical safeguard."),
  q("security", "Safeguards", "single", "A system that makes each user sign in with their own unique login is an example of which kind of safeguard?", ["Technical", "Physical", "Administrative", "Cosmetic"], [0], "Unique user identification and authentication are technical safeguards."),
  q("security", "Risk analysis", "single", "What is the purpose of a security risk analysis?", ["To find where ePHI is, what could go wrong, and how serious each risk is, so safeguards can be chosen", "To choose a new logo", "To count the number of employees", "To list patients by age"], [0], "A risk analysis identifies threats and weaknesses and guides the safeguards the organization puts in place."),
  q("security", "Risk analysis", "true_false", "True or false: A risk analysis is done once and never needs to be repeated.", ["True", "False"], [1], "It is repeated as the work, the tools or the threats change."),
  q("security", "Required and addressable", "single", "In the Security Rule, what does it mean when a specification is \"addressable\"?", ["The organization must implement it, or document why and use an equally effective alternative", "It is optional and can be ignored", "Only the IT team must read it", "It applies only to paper records"], [0], "Addressable is not optional. The organization implements it or documents an equivalent alternative."),
  q("security", "Required and addressable", "single", "A data backup plan is part of contingency planning. In the Security Rule it is:", ["Required", "Optional", "Only for hospitals", "Only for paper records"], [0], "A data backup plan is a required specification of the contingency plan standard."),
  q("security", "Workspace", "single", "You work from home. Which description fits your workspace best, for as long as patient information is on your screen?", ["Part of the client's workplace, with the same standard of care", "Private, so rules do not apply", "Exempt because you are in another country", "Exempt if you use a headset"], [0], "The standard follows the information. A home workspace must still be safe from others seeing or hearing patient information."),
  q("security", "Workspace", "multiple", "Which of these help protect a home workstation? Select all that apply.", ["Locking the screen when you step away", "Positioning the screen so others cannot read it", "Keeping printed patient details off the desk", "Leaving the screen unlocked for convenience"], [0, 1, 2], "Locking, positioning and tidiness are physical safeguards. Leaving the screen unlocked defeats them."),
  q("security", "Approved systems", "single", "A teammate suggests pasting a patient note into a free online AI tool to summarize it. What is the problem?", ["It sends patient information to an outside company that is not approved or bound by an agreement", "AI tools are always slow", "The tool might make a typing error", "There is no problem if it is a short note"], [0], "A public AI tool is an unapproved disclosure outside the chain of trust."),
  q("security", "Storing", "single", "You are halfway through a task and want to finish it tomorrow. Which is the right way to carry information over?", ["Leave it in the client's system and pick it up there", "Email it to yourself", "Save it to your personal cloud drive", "Take photos of the screen"], [0], "Information is safest where it already is. Extra copies are extra risk."),
  q("security", "Devices and media", "single", "An old work drive held patient files. You are about to give it to a relative. What should you do first?", ["Ask your lead, because it must be wiped or destroyed the approved way", "Delete the files and give it away", "Format it and give it away", "Give it away with the files hidden"], [0], "Media that held ePHI must be properly sanitized or destroyed before reuse or disposal."),
  q("security", "Lost device", "single", "You notice a work laptop is missing from your bag. What is the first thing to do?", ["Report it to your lead and HR immediately", "Search for a day before telling anyone", "Wait to see if it turns up", "Buy a replacement and say nothing"], [0], "A lost device is an incident from the moment you notice. Time matters."),
  q("security", "Lost device", "single", "A stolen work laptop had full-disk encryption. Who decides whether patients must be notified?", ["The client and ERS, after assessing it", "The person who lost it", "A coworker", "The thief"], [0], "Encryption can change the notification analysis, but that decision belongs to the organizations responsible."),
  q("security", "Credentials", "single", "A teammate's account is locked and a deadline is near. They ask to use your login for an hour. What do you do?", ["Decline, and help them reach support or your lead to fix their account", "Share it and change the password later", "Share it only if they promise not to open anything else", "Stay logged in and step away while they use it"], [0], "Logins are personal. Sharing puts your name on their actions and breaks access controls and audit logs."),
  q("security", "Passwords", "single", "Which is part of HIPAA's security awareness training for the workforce?", ["Password management: creating, changing and protecting passwords", "Choosing which patients to call", "Setting prices for services", "Writing marketing messages"], [0], "The security awareness and training standard includes password management, security reminders, malicious software and log-in monitoring."),
  q("security", "MFA", "single", "A sign-in asks you for a code from an authenticator app after your password. This is:", ["Multi-factor authentication, a second proof of identity", "A marketing pop-up", "A sign that the system is broken", "A reason to share the code with IT"], [0], "MFA adds a second proof, and the code is never shared with anyone."),
  q("security", "Audit logs", "true_false", "True or false: Access to patient records is logged, so looking at a record without a work reason can be found later.", ["True", "False"], [0], "Audit logs record who opened what and when, and are reviewed to detect misuse."),
  q("security", "Transmission", "single", "Which is an appropriate way to send patient information?", ["Through the secure channel your client approved", "By a personal text message", "Through a personal email account", "In a public group chat"], [0], "Use only approved, secure channels. Personal email, texts and consumer chat apps are not approved."),
  q("security", "Access ends with work", "single", "You see that a former teammate's account in a client system is still active. What should you do?", ["Leave it alone and report it to your lead and HR right away", "Use it, since it is still working", "Ignore it", "Delete the account yourself"], [0], "Access must end with the work (termination procedures). An account that should be closed but is still active needs to be reported, not used or fixed quietly."),
  q("security", "Integrity", "single", "While entering data you realize you selected the wrong patient. What should you do?", ["Stop, and tell your lead or client contact so it can be corrected properly", "Quietly delete the entry", "Change the patient's name to match", "Leave it and finish the batch"], [0], "Integrity matters: errors in the record can harm care and billing. Report so it is corrected through the proper process."),
  q("security", "The rule is changing", "true_false", "True or false: The stricter Security Rule that HHS proposed is already in effect, replacing the current rule.", ["True", "False"], [1], "It is a proposal. The current Security Rule remains in effect while HHS works on it."),
  q("security", "Public places", "single", "You need to finish a task and the only available place is a busy cafe. What is the best approach?", ["Ask your lead for an approved way to continue, such as another place or a handoff", "Work there with a privacy screen", "Work there on a public network", "Work there but speak quietly on calls"], [0], "Public places expose screens, conversations and networks, and are not approved places to work with patient information."),
  q("security", "Safeguards", "multiple", "Which of these are physical safeguards? Select all that apply.", ["Positioning your screen away from a window", "Never leaving a work device unattended in a car", "Keeping a tidy desk with no patient printouts out", "Requiring a unique login for each person"], [0, 1, 2], "Protecting rooms, workstations and devices is physical. A unique login is a technical safeguard."),
  q("security", "Safeguards", "single", "A policy that ends a former team member's access when their work ends is mainly an example of which kind of safeguard?", ["Administrative", "Physical", "Technical", "Cosmetic"], [0], "Workforce security and termination procedures are administrative safeguards, though the system enforces them."),
  q("security", "Flexibility", "single", "The Security Rule lets an organization choose its safeguards. What should the choice be based on?", ["Its risk analysis, size and technology, without leaving a serious risk open", "Whatever is cheapest", "Whatever the newest tool offers", "Whatever the IT team prefers"], [0], "The rule is flexible about how, not about whether. Cost can be weighed, but not at the price of a serious risk."),
  q("security", "Storing", "single", "You save a patient list to a personal cloud drive to finish it at home. A teammate tells you to stop. What is the best next step?", ["Delete the copy as instructed and report it so the client can check", "Leave it and hope no one notices", "Move it to a second personal folder", "Print it instead"], [0], "An unapproved copy is reported even when it is removed quickly, so the client can assess it."),
];
