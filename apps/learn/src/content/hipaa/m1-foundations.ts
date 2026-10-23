import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 1: why HIPAA exists, who it covers, and where ERS and the person fit. Version 2 of the course (deeper, case-based).
// Original text for ERS, grounded in HHS/OCR public guidance and the ONC privacy and security guide. All people and details in
// examples are invented. Counsel or the Privacy Officer reviews this before it is published.

export const m1: CourseModule = {
  key: "foundations",
  title: "HIPAA foundations and your role at ERS",
  summary: "Why HIPAA exists, the three rules and how they fit together, who it covers, and where ERS and you sit in the chain that protects patient information.",
  estimatedMinutes: 18,
  tracks: ["full", "essentials", "refresher"],
  keyPoints: [
    "HIPAA exists so people can trust that their health information is used for their care and not for anything else.",
    "Three rules matter at work: the Privacy Rule, the Security Rule and the Breach Notification Rule.",
    "Covered entities hold patient information; business associates and their subcontractors handle it for them; you are part of ERS's workforce.",
    "A chain of agreements carries the same protections from the clinic to the last person who touches the information.",
    "Being able to open information is not the same as being allowed to use it.",
    "When you are not sure, stop, do not share, and ask your lead.",
    "ERS runs a privacy and security program, and training is one required part of it.",
  ],
  screens: [
    {
      id: "welcome",
      title: "Why this training matters",
      blocks: [
        { type: "paragraph", text: "Many ERS clients are doctors' offices, clinics, billing companies and other healthcare organizations. When you work for them, you may see information about real patients: who they are, what is wrong with them, and what they owe." },
        { type: "paragraph", text: "That information belongs to the patient. A United States law called **HIPAA** sets how it must be protected, and it applies to you from your first day of work." },
        { type: "callout", tone: "info", title: "How this course works", text: "Every lesson explains the rule, why it exists, and what it looks like in a normal workday. Short worked cases let you think before you see the answer. Your progress is saved, so you can stop and come back." },
      ],
    },
    {
      id: "problem",
      title: "The problem HIPAA solved",
      blocks: [
        { type: "paragraph", text: "Before HIPAA, there was no national standard for who could see a person's health records or what they could do with them. Records moved on paper and, increasingly, by computer, and the protection a patient had depended on where they lived and who held the file." },
        { type: "paragraph", text: "Two things made that a growing problem. First, health information is among the most sensitive information a person has: it can affect their job, their insurance, their relationships and how they are treated. Second, the healthcare system needs that information to move quickly between doctors, labs and insurers, or care suffers." },
        { type: "callout", tone: "tip", title: "The balance", text: "HIPAA does not try to stop information from moving. It tries to make sure it moves only for the right reasons, to the right people, with the right protection." },
      ],
    },
    {
      id: "what-is-hipaa",
      title: "What HIPAA is, and who enforces it",
      blocks: [
        { type: "paragraph", text: "HIPAA is the Health Insurance Portability and Accountability Act, a United States federal law passed in 1996. Its rules about health information are written and enforced by the U.S. Department of Health and Human Services (HHS), through its **Office for Civil Rights (OCR)**." },
        { type: "paragraph", text: "ERS is in the Philippines, but the work you do for U.S. clients falls under these rules through the contracts ERS signs. A client's patients are protected the same way whether the work is done across the street or across the world." },
        { type: "callout", tone: "info", text: "HIPAA is also the floor, not the ceiling. Some state laws and client rules ask for more, and when they do, the stricter rule is the one you follow." },
      ],
    },
    {
      id: "three-rules",
      title: "The three rules and how they fit",
      blocks: [
        { type: "paragraph", text: "Three HIPAA rules matter most in daily work. Think of them as three questions:" },
        {
          type: "layers",
          title: "Three rules, three questions",
          items: [
            { label: "Privacy Rule", text: "Who may use or share health information, for what reasons, and what rights does the patient have over it?" },
            { label: "Security Rule", text: "How must information held or sent electronically be kept safe from the people who should not have it?" },
            { label: "Breach Notification Rule", text: "When information is exposed anyway, who must be told, and by when?" },
          ],
        },
        { type: "paragraph", text: "They work together. The Privacy Rule decides what is allowed. The Security Rule protects electronic information so only the allowed things happen. The Breach Notification Rule says what to do when something goes wrong." },
      ],
    },
    {
      id: "who-is-who",
      title: "Who is who: covered entities and business associates",
      blocks: [
        { type: "paragraph", text: "HIPAA does not apply to everyone who ever sees health information. It applies to specific kinds of organizations, and to the people who work for them." },
        {
          type: "table",
          caption: "The labels you will hear",
          columns: ["Label", "What it means", "Example"],
          rows: [
            ["Covered entity", "A health plan, a healthcare clearinghouse, or a healthcare provider that sends certain transactions electronically", "A clinic that bills insurance"],
            ["Business associate", "A company that does work for a covered entity and handles patient information while doing it", "A billing company, or ERS"],
            ["Subcontractor", "A company a business associate uses to do part of that work", "A cloud service the billing company uses"],
            ["Workforce member", "A person whose work is under the organization's direct control, paid or not", "An ERS team member, including contractors"],
          ],
        },
        { type: "callout", tone: "tip", text: "Depending on the client, ERS is a business associate or a subcontractor. Either way, the same protections follow the information to you." },
      ],
    },
    {
      id: "chain-of-trust",
      title: "The chain of trust",
      blocks: [
        { type: "paragraph", text: "A clinic cannot simply hand patient information to a vendor and hope for the best. The law builds a chain: every organization that handles the information signs an agreement promising to protect it, and must make the next organization in the chain promise the same." },
        {
          type: "steps",
          items: [
            { title: "The clinic or plan", text: "The covered entity that first holds the information." },
            { title: "ERS", text: "A business associate, bound by its agreement with the client." },
            { title: "Anyone ERS uses", text: "Subcontractors, tools and vendors, bound by the same promise." },
            { title: "You", text: "A member of ERS's workforce, bound by ERS's rules." },
          ],
        },
        { type: "callout", tone: "info", text: "The chain only holds if every link does. A rule your client gives you is not the client's own preference: it is the promise that came down the chain, and you are the last link." },
      ],
    },
    {
      id: "case-chain",
      title: "Worked case: the helpful tool",
      blocks: [
        {
          type: "case",
          title: "A free transcription tool",
          scenario: "You are asked to type up a recorded voicemail from a clinic's patient line. The clinic's approved dictation tool is slow, so you find a free online transcription site that does it in seconds. You are about to upload the audio.",
          question: "Why is this a problem, even though the site seems harmless?",
          answer: "The site is not in the chain. ERS has no agreement with it, so nothing binds it to protect the recording, to limit what it does with it, or to tell anyone if it leaks. Uploading the audio is a disclosure to an outside company the client never approved. Use only the tool your client approved, and ask your lead if it is too slow.",
        },
      ],
    },
    {
      id: "access-not-authorization",
      title: "Access is not permission",
      blocks: [
        { type: "paragraph", text: "Your login may open a whole patient list. That does not mean you may look at every record. You may use information only for the task you were given." },
        {
          type: "compare",
          left: { title: "Allowed", items: ["Opening a record to complete the task your client assigned", "Using the approved system the client set up", "Sharing only with people your client named for that task"] },
          right: { title: "Not allowed", items: ["Looking up a neighbor, friend or celebrity", "Copying records to your own phone or email", "Telling anyone about a patient, even \"just a little\""] },
        },
        { type: "callout", tone: "warning", text: "Looking at records out of curiosity is a privacy violation, even if you never tell anyone and even if the system let you in. Access is logged, and logs are reviewed." },
      ],
    },
    {
      id: "baa",
      title: "The agreement sets the rules",
      blocks: [
        { type: "paragraph", text: "ERS and each client sign a **business associate agreement (BAA)**. It says what ERS may do with patient information, what safeguards are required, and how problems must be reported. You will study its contents in Module 5." },
        { type: "paragraph", text: "You do not need to read the contract. You do need to follow the instructions your lead and your client give you, because they come from it." },
        {
          type: "check",
          question: "Where do you find out what you may do with a client's patient information?",
          options: [
            { text: "In your client's instructions and ERS's rules, as explained by your lead", correct: true, feedback: "Right. Those are the rules that apply to your daily work." },
            { text: "Whatever the system lets you open", correct: false, feedback: "Being able to open something does not make it allowed." },
            { text: "Whatever a coworker says is usually fine", correct: false, feedback: "Habits spread, but they are not rules. Ask your lead." },
          ],
        },
      ],
    },
    {
      id: "program",
      title: "How ERS keeps this program running",
      blocks: [
        { type: "paragraph", text: "Following HIPAA is not only about individuals. Organizations must run a privacy and security program, and ERS does. You will see its parts in your daily work:" },
        {
          type: "list",
          items: [
            "**A named privacy contact**: the Privacy Officer, who owns the rules and answers questions.",
            "**Written policies and agreements**: ERS's policies, and each client's business associate agreement.",
            "**Risk checks**: regular reviews of where information could be exposed, and fixes.",
            "**Training**: HIPAA requires every workforce member to be trained, and ERS repeats it on a schedule.",
            "**Sanctions and reporting**: consequences for breaking the rules, and a way to report problems.",
            "**Records**: policy and training records are kept for six years.",
          ],
        },
        { type: "callout", tone: "tip", text: "You are not expected to run the program. Your part is to follow it, ask when unsure, and report problems." },
      ],
    },
    {
      id: "timeline",
      title: "How HIPAA grew up",
      blocks: [
        { type: "paragraph", text: "HIPAA did not arrive all at once. The steps explain why ERS, a business associate, is held to the rules directly:" },
        {
          type: "timeline",
          title: "From 1996 to today",
          items: [
            { when: "1996", text: "HIPAA becomes federal law." },
            { when: "2003", text: "Organizations must comply with the Privacy Rule, which governs how information is used and shared." },
            { when: "2009", text: "The HITECH Act makes business associates directly responsible for the Security Rule and strengthens enforcement." },
            { when: "2013", text: "The Omnibus Rule folds HITECH into the HIPAA rules and adds detail on business associates and breach notification." },
          ],
        },
        { type: "callout", tone: "info", text: "Since 2009, ERS answers to the government for its own compliance, not only to its clients." },
      ],
    },
    {
      id: "consequences",
      title: "Why it matters to you",
      blocks: [
        { type: "paragraph", text: "Mistakes happen, and ERS wants to hear about them quickly (more on that in Module 7). Deliberately misusing information is different." },
        {
          type: "list",
          items: [
            "Civil penalties are enforced by HHS's Office for Civil Rights and can fall on organizations, and in some cases on individuals.",
            "Knowingly misusing patient information is a crime the Department of Justice prosecutes: up to 1 year in prison, 5 with false pretenses, 10 if for gain or harm.",
            "ERS has sanctions for breaking its privacy and security rules, up to ending your engagement.",
            "Clients can end their contract with ERS, which affects every teammate.",
          ],
        },
        { type: "callout", tone: "info", text: "ERS does not punish good-faith reports, and HIPAA prohibits retaliating against people who file a complaint about a possible violation. Speak up." },
      ],
    },
    {
      id: "scenario-familiar-name",
      title: "Try it: the familiar name",
      blocks: [
        {
          type: "scenario",
          title: "A name you know",
          prompt: "While doing your assigned task you see a patient name that matches your cousin's. Your login shows the full chart, and nobody would ever know.",
          choices: [
            { text: "Open the chart to check whether it is really your cousin.", feedback: "That would be curiosity, not your task. Looking is a violation even if nobody finds out.", best: false },
            { text: "Finish only the task you were assigned and do not open anything extra.", feedback: "Correct. Use only what the task needs.", best: true },
            { text: "Mention it to a friend so they can check on your cousin.", feedback: "Telling anyone about a patient is a disclosure. It is never okay.", best: false },
          ],
        },
      ],
    },
    {
      id: "when-unsure",
      title: "The safest default",
      blocks: [
        { type: "paragraph", text: "You will sometimes meet a situation nobody trained you for. There is one move that is always right:" },
        {
          type: "steps",
          items: [
            { title: "Stop", text: "Do not send, open, copy or say anything yet." },
            { title: "Do not share", text: "Keep the information where it is." },
            { title: "Ask", text: "Ask your team lead or your client contact for the approved way." },
          ],
        },
        { type: "callout", tone: "tip", text: "Asking is never a mistake. A question costs a few minutes. A wrong disclosure cannot be taken back." },
      ],
    },
    {
      id: "sort-who-is-who",
      title: "Quick sort: who is who?",
      blocks: [
        { type: "paragraph", text: "Swipe through these one at a time and decide where each one sits in the chain." },
        {
          type: "cards",
          title: "Covered entity or business associate?",
          prompt: "Where does each one sit?",
          groups: ["Covered entity", "Business associate or subcontractor"],
          cards: [
            { text: "A clinic that bills insurance electronically", group: 0, feedback: "A provider that sends certain transactions electronically is a covered entity." },
            { text: "A health plan", group: 0, feedback: "Health plans are covered entities." },
            { text: "A healthcare clearinghouse", group: 0, feedback: "Clearinghouses are covered entities too." },
            { text: "ERS, doing billing work for a clinic", group: 1, feedback: "ERS handles patient information while doing work for a covered entity, so it is a business associate." },
            { text: "A cloud service the billing company uses", group: 1, feedback: "A company a business associate uses for part of its work is a subcontractor." },
            { text: "A medical billing company that works for a clinic", group: 1, feedback: "It handles patient information for a covered entity, so it is a business associate." },
          ],
        },
      ],
    },
    {
      id: "keys-to-success",
      title: "What keeps the chain strong",
      blocks: [
        { type: "paragraph", text: "Rules on paper do not protect anyone by themselves. Three things make them work in daily life:" },
        {
          type: "layers",
          title: "Three keys",
          items: [
            { label: "Education", text: "Everyone knows the rules and why they exist. That is this course." },
            { label: "Commitment", text: "Everyone does their part, even when nobody is watching." },
            { label: "Culture", text: "Asking and reporting feel normal, and nobody is punished for a good-faith report." },
          ],
        },
        {
          type: "spot",
          title: "Spot the weak link",
          prompt: "A team chat after a small mistake. Tap the line that works against a good culture.",
          lines: [
            { speaker: "Team member", text: "I sent a file to the wrong teammate by mistake. I told my lead right away." },
            { speaker: "Lead", text: "Thanks for telling me. Let's fix it and note what happened." },
            { speaker: "Coworker", text: "You should not have said anything. If nobody reports it, it never happened.", wrong: true },
            { speaker: "Lead", text: "Please keep reporting. Fast reports limit the damage." },
          ],
          explanation: "Staying quiet is the weak link. ERS wants to hear about mistakes quickly, does not punish good-faith reports, and HIPAA bars retaliation against people who raise concerns.",
        },
      ],
    },
    {
      id: "foundations-round",
      title: "Quick round: foundations",
      blocks: [
        {
          type: "game",
          title: "Foundations sprint",
          seconds: 20,
          rounds: [
            {
              question: "Which rule decides who may use or share health information?",
              options: [
                { text: "The Privacy Rule", correct: true, feedback: "Yes. It sets who may use or share it and for what reasons." },
                { text: "The Security Rule", correct: false, feedback: "That one protects electronic information." },
                { text: "The Breach Notification Rule", correct: false, feedback: "That one covers what to do after an exposure." },
              ],
            },
            {
              question: "A clinic that bills insurance electronically is a...",
              options: [
                { text: "Covered entity", correct: true, feedback: "Right." },
                { text: "Business associate", correct: false, feedback: "A business associate works for a covered entity." },
                { text: "Subcontractor", correct: false, feedback: "A subcontractor works for a business associate." },
              ],
            },
            {
              question: "Your login opens every chart. When may you open one?",
              options: [
                { text: "Only when your task needs it", correct: true, feedback: "Access is not permission." },
                { text: "When you are curious and nobody will know", correct: false, feedback: "Access is logged, and curiosity is a violation." },
                { text: "When a friend asks", correct: false, feedback: "That is a disclosure." },
              ],
            },
            {
              question: "A free site would speed up a task, but ERS has no agreement with it. What now?",
              options: [
                { text: "Do not send patient information to it", correct: true, feedback: "It is outside the chain of trust." },
                { text: "Use it if the site looks professional", correct: false, feedback: "Looks do not bind anyone." },
                { text: "Use it and delete the file afterward", correct: false, feedback: "The disclosure already happened." },
              ],
            },
            {
              question: "You are not sure something is allowed. First move?",
              options: [
                { text: "Stop, do not share, and ask your lead", correct: true, feedback: "Asking is never a mistake." },
                { text: "Do it fast and mention it later", correct: false, feedback: "A wrong disclosure cannot be taken back." },
                { text: "Ask a friend in healthcare", correct: false, feedback: "Your lead or client contact is the right source." },
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
            { term: "HIPAA", meaning: "The 1996 U.S. law whose rules protect the privacy and security of health information." },
            { term: "OCR", meaning: "The Office for Civil Rights at HHS, which enforces the HIPAA rules." },
            { term: "Covered entity", meaning: "A health plan, a healthcare clearinghouse, or a healthcare provider that sends certain transactions electronically." },
            { term: "Business associate", meaning: "A company that handles patient information while doing work for a covered entity." },
            { term: "Subcontractor", meaning: "A company that a business associate uses to do part of its work." },
            { term: "Workforce member", meaning: "A person under an organization's direct control, paid or not." },
            { term: "BAA", meaning: "Business associate agreement: the contract that sets what a business associate may do with patient information." },
          ],
        },
      ],
    },
  ],
};

export const q1: QuestionSeed[] = [
  q("foundations", "What HIPAA is", "single", "Which three rules of HIPAA matter most for day-to-day work at ERS?", ["Privacy Rule, Security Rule and Breach Notification Rule", "Billing Rule, Coding Rule and Claims Rule", "Hiring Rule, Pay Rule and Leave Rule", "Marketing Rule, Sales Rule and Contract Rule"], [0], "HIPAA's Privacy, Security and Breach Notification Rules set how health information is used, kept safe and handled when exposed."),
  q("foundations", "Three rules", "single", "Which rule mainly decides who may use or share health information and for what reasons?", ["The Privacy Rule", "The Security Rule", "The Breach Notification Rule", "The Enforcement Rule"], [0], "The Privacy Rule sets who may use or share health information and gives patients rights over it. The Security Rule protects electronic information, and the Breach Notification Rule covers exposures."),
  q("foundations", "Three rules", "single", "Which rule focuses on keeping electronic health information safe from people who should not have it?", ["The Security Rule", "The Privacy Rule", "The Marketing Rule", "The Patient Rights Rule"], [0], "The Security Rule requires safeguards for electronic protected health information."),
  q("foundations", "Who enforces", "single", "Which part of the U.S. government enforces the HIPAA Privacy, Security and Breach Notification Rules?", ["The Office for Civil Rights at HHS", "The Internal Revenue Service", "The Federal Communications Commission", "The Department of Education"], [0], "HHS enforces the rules through its Office for Civil Rights, and the Department of Justice handles criminal cases."),
  q("foundations", "Who is who", "single", "A medical billing company hires ERS to help with its work, and ERS team members will see patient billing records. In HIPAA terms, ERS is most likely acting as:", ["A business associate or subcontractor", "A patient", "A government regulator", "A news organization"], [0], "A company that handles patient information while doing work for a covered entity is a business associate (or a subcontractor of one)."),
  q("foundations", "Who is who", "multiple", "Which of these can be a covered entity? Select all that apply.", ["A health plan", "A doctor's office that bills insurance electronically", "A healthcare clearinghouse", "A person who is a patient"], [0, 1, 2], "Covered entities are health plans, clearinghouses and providers who bill electronically. A patient is the person the information is about."),
  q("foundations", "Who is who", "single", "What is a subcontractor in HIPAA terms?", ["A company that a business associate uses to do part of its work with patient information", "A patient's relative who helps with paperwork", "A government inspector", "The clinic that hires the business associate"], [0], "A subcontractor is a company a business associate uses, and it is bound by the same protections."),
  q("foundations", "Workforce", "single", "Who counts as a member of an organization's workforce?", ["People under its direct control, paid or not, including contractors", "Only people on the payroll", "Only managers", "Only people who work in the same building"], [0], "Workforce includes employees, volunteers, trainees and contractors under the organization's direct control, whether or not they are paid."),
  q("foundations", "Chain of trust", "single", "What does the chain of trust mean?", ["Each organization that handles the information is bound by an agreement and must bind the next one", "Only the clinic is responsible for the information", "Patients are responsible for their own information", "The information is protected only inside the clinic's building"], [0], "The protections travel with the information through agreements, link by link."),
  q("foundations", "Chain of trust", "single", "You find a free website that would make a task faster, but ERS has no agreement with it. What does the chain of trust tell you?", ["Do not send patient information to it, because nothing binds it to protect the data", "It is fine if the site looks professional", "It is fine if you delete the file afterward", "It is fine if the patient's name is removed from the file name"], [0], "A tool outside the chain has made no promise to protect the information, so sending it there is an unapproved disclosure."),
  q("foundations", "Access is not permission", "single", "Your login lets you open every patient chart in the system. When may you open a chart?", ["Only when your assigned task needs it", "Whenever you are curious, if you do not tell anyone", "When a friend asks you to check someone", "When the system is quiet"], [0], "Use is limited to what your task needs. The ability to open a record is not permission."),
  q("foundations", "Access is not permission", "true_false", "True or false: If nobody can ever find out, it is acceptable to look up a coworker's patient record out of curiosity.", ["True", "False"], [1], "Looking without a work reason is a privacy violation whether or not anyone notices. Access is logged and reviewed."),
  q("foundations", "The agreement sets the rules", "single", "What does a business associate agreement (BAA) do?", ["Sets what the business associate may do with patient information and what safeguards it must use", "Lists the salaries of the client's staff", "Replaces the need for training", "Lets the team share patient information freely among themselves"], [0], "A BAA is the contract that sets the permitted uses, the required safeguards and the reporting duties for the information."),
  q("foundations", "Client rules", "single", "ERS's rules and your client's instructions differ on how to send a file. What do you do?", ["Follow the stricter rule and ask your lead if you are unsure", "Follow the one that is quicker", "Follow whichever you saw a coworker use", "Ignore both and use your own method"], [0], "When two sets of rules apply and differ, the stricter one protects the information. Ask your lead when unsure."),
  q("foundations", "When unsure", "single", "You are asked to do something with patient information that you have never done and are not sure is allowed. What is the best first step?", ["Stop and ask your team lead or client contact", "Do it quickly so the task is not late", "Do it, then mention it afterward", "Ask a friend who works in healthcare"], [0], "When unsure, stop, do not share, and ask. A short question is always cheaper than a wrong disclosure."),
  q("foundations", "Compliance program", "multiple", "Which of these are part of the privacy and security program ERS runs? Select all that apply.", ["Training for the workforce", "Written policies and client agreements", "Sanctions for people who break the rules", "Letting each person decide their own rules"], [0, 1, 2], "A program has training, written policies and agreements, sanctions, risk checks and records. Individuals do not set their own rules."),
  q("foundations", "History", "single", "What did the 2009 HITECH Act change for companies like ERS?", ["It made business associates directly responsible for the Security Rule and strengthened enforcement", "It ended the Privacy Rule", "It made HIPAA apply only to hospitals", "It removed penalties for small companies"], [0], "HITECH extended the Security Rule requirements directly to business associates and increased enforcement."),
  q("foundations", "Reporting", "true_false", "True or false: ERS will punish you for reporting a possible privacy incident you noticed, even if it turns out to be nothing.", ["True", "False"], [1], "ERS does not punish good-faith reports, and fast reporting is how problems are limited."),
  q("foundations", "Culture", "single", "A coworker says nobody should report a small mistake because 'if nobody reports it, it never happened'. What is the right response?", ["Report it anyway: fast reports limit the damage, and good-faith reports are not punished", "Agree, since small mistakes do not matter", "Wait a week to see whether anyone notices", "Delete the evidence first"], [0], "A good culture makes reporting normal. ERS does not punish good-faith reports."),
  q("foundations", "Culture", "multiple", "Which of these help keep the chain of protection strong? Select all that apply.", ["Education for everyone who handles information", "Commitment to follow the rules when nobody is watching", "A culture where asking and reporting feel normal", "Keeping quiet about mistakes"], [0, 1, 2], "Education, commitment and culture keep rules working in daily life. Staying quiet weakens them."),
  q("foundations", "Who is who", "single", "A cloud service is used by a billing company to store part of the clinic's billing files. In HIPAA terms the cloud service is most likely:", ["A subcontractor", "A covered entity", "A patient", "A regulator"], [0], "A company a business associate uses to do part of its work is a subcontractor, bound by the same protections."),
  q("foundations", "Who is who", "true_false", "True or false: A health plan is a covered entity.", ["True", "False"], [0], "Health plans, clearinghouses and providers who send certain transactions electronically are covered entities."),
  q("foundations", "Consequences", "multiple", "Which of these can follow a deliberate privacy violation? Select all that apply.", ["Penalties for the organization", "Criminal penalties for knowingly misusing patient information", "ERS sanctions, up to ending the engagement", "A bonus for finding the record first"], [0, 1, 2], "HIPAA has civil and criminal penalties, and ERS applies sanctions. Nothing rewards misuse."),
];
