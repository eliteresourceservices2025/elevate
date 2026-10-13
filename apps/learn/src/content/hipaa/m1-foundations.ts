import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 1: HIPAA foundations and ERS's role. Original text for ERS, grounded in HHS/OCR public guidance. All people and details
// in examples are invented. Counsel or the Privacy Officer reviews this before it is published.

export const m1: CourseModule = {
  key: "foundations",
  title: "HIPAA foundations and your role at ERS",
  summary: "What HIPAA is, who it applies to, where ERS and you fit, and the one habit that keeps you safe: when unsure, stop and ask.",
  estimatedMinutes: 13,
  tracks: ["full", "essentials", "refresher"],
  keyPoints: [
    "HIPAA protects the privacy and security of people's health information.",
    "ERS works for clients who are covered by HIPAA, and ERS and its team follow the same rules through contracts called business associate agreements.",
    "Being able to open information is not the same as being allowed to use it.",
    "Use or share only what your job and your client's rules allow.",
    "When you are not sure, stop, do not share, and ask your lead.",
    "ERS runs a privacy and security program, and training is one required part of it.",
    "Every organization in the chain from the clinic to ERS is bound by the same agreement, and so are you.",
  ],
  screens: [
    {
      id: "welcome",
      title: "Why this training matters",
      blocks: [
        { type: "paragraph", text: "Many ERS clients are doctors' offices, clinics, billing companies and other healthcare organizations. When you work for them, you may see information about real patients: who they are, what is wrong with them, and what they owe." },
        { type: "paragraph", text: "That information belongs to the patient. A law called **HIPAA** says how it must be protected, and it applies to you as soon as you start work." },
        { type: "callout", tone: "info", title: "Good news", text: "You do not need to be a lawyer. You need a few clear habits, and this course teaches them in about 80 minutes. Your progress is saved, so you can stop and come back." },
      ],
    },
    {
      id: "what-is-hipaa",
      title: "What HIPAA is",
      blocks: [
        { type: "paragraph", text: "HIPAA is the Health Insurance Portability and Accountability Act, a United States federal law from 1996. The parts that matter most to you are three rules:" },
        {
          type: "steps",
          items: [
            { title: "Privacy Rule", text: "Who may use or share health information, and when." },
            { title: "Security Rule", text: "How electronic health information must be kept safe." },
            { title: "Breach Notification Rule", text: "What must happen when health information is exposed." },
          ],
        },
        { type: "paragraph", text: "The U.S. Department of Health and Human Services (HHS) enforces HIPAA through its Office for Civil Rights. Even though ERS is in the Philippines, the work you do for U.S. clients falls under these rules through the contracts ERS signs." },
      ],
    },
    {
      id: "who-is-who",
      title: "Who is who",
      blocks: [
        { type: "paragraph", text: "HIPAA uses a few labels. Here they are in plain words:" },
        {
          type: "list",
          items: [
            "**Covered entity**: a health plan, a healthcare clearinghouse, or a healthcare provider that bills electronically. Most of our clients are covered entities.",
            "**Business associate**: a company that does work for a covered entity and handles patient information while doing it.",
            "**Subcontractor**: a company that a business associate uses to do part of that work.",
            "**Workforce member**: people whose work is under the organization's direct control, paid by it or not, including contractors like you.",
          ],
        },
        { type: "callout", tone: "tip", text: "Depending on the client, ERS is a business associate or a subcontractor. Either way, the same protections follow the information to you." },
      ],
    },
    {
      id: "chain-of-trust",
      title: "The chain of trust",
      blocks: [
        { type: "paragraph", text: "A clinic cannot simply hand patient information to a vendor. The law builds a chain: every organization that handles the information signs an agreement promising to protect it, and must make the next organization in the chain promise the same." },
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
      id: "where-ers-fits",
      title: "Where ERS and you fit",
      blocks: [
        { type: "paragraph", text: "Picture a chain. The patient trusts the clinic. The clinic trusts a company like ERS to help. ERS trusts you to handle the information carefully." },
        {
          type: "steps",
          items: [
            { title: "Patient", text: "Trusts the healthcare provider with their information." },
            { title: "Client", text: "The provider or organization that hires ERS." },
            { title: "ERS", text: "Signs a business associate agreement with the client." },
            { title: "You", text: "Follow ERS's rules and your client's rules every day." },
          ],
        },
        { type: "paragraph", text: "Each client also has its own approved systems, tools and instructions. **Client rules and ERS rules both apply. If they differ, follow the stricter one.**" },
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
        { type: "callout", tone: "warning", text: "Looking at records out of curiosity is a privacy violation, even if you never tell anyone and even if the system let you in." },
      ],
    },
    {
      id: "rules-and-baa",
      title: "The agreement sets the rules",
      blocks: [
        { type: "paragraph", text: "ERS and each client sign a **business associate agreement (BAA)**. It says what ERS may do with patient information, what safeguards are required, and how problems must be reported." },
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
      id: "baa-asks",
      title: "What the agreement asks of ERS",
      blocks: [
        { type: "paragraph", text: "A business associate agreement is specific. Among other things, it requires the business associate to:" },
        {
          type: "list",
          items: [
            "Use patient information only for the purposes the contract allows",
            "Protect it with appropriate safeguards, including for electronic information",
            "Report any use or disclosure the contract does not allow, including breaches",
            "Make sure its own subcontractors agree to the same limits",
            "Help the client respond to patients' requests to see or correct their records",
            "Open its records to HHS when asked, and return or destroy the information when the contract ends",
          ],
        },
        { type: "callout", tone: "tip", text: "Each item is something you do in a normal day: stay within the task, use approved tools, report problems, never keep copies." },
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
            "**Training**: HIPAA requires every workforce member to be trained, and ERS repeats it every year.",
            "**Sanctions and reporting**: consequences for breaking the rules, and a way to report problems.",
            "**Records**: ERS keeps its policy and training records for six years.",
          ],
        },
        { type: "callout", tone: "tip", text: "You are not expected to run the program. Your part is to follow it, ask when unsure, and report problems." },
      ],
    },
    {
      id: "timeline",
      title: "How HIPAA grew up",
      blocks: [
        { type: "paragraph", text: "HIPAA did not arrive all at once. Knowing the steps explains why ERS, a business associate, is held to the rules directly:" },
        {
          type: "steps",
          items: [
            { title: "1996", text: "HIPAA becomes federal law." },
            { title: "2003", text: "Organizations must comply with the Privacy Rule, which governs how information is used and shared." },
            { title: "2009", text: "The HITECH Act makes business associates directly responsible for the Security Rule and strengthens enforcement." },
            { title: "2013", text: "The Omnibus Rule folds HITECH into the HIPAA rules and adds detail on business associates and breach notification." },
          ],
        },
        { type: "callout", tone: "info", text: "Since 2009, ERS answers to the government for its own compliance, not only to its clients." },
      ],
    },
    {
      id: "consequences",
      title: "Why it matters to you",
      blocks: [
        { type: "paragraph", text: "Mistakes happen, and ERS wants to hear about them quickly (more on that in Module 6). Deliberately misusing information is different." },
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
  ],
};

export const q1: QuestionSeed[] = [
  q("foundations", "What HIPAA is", "single", "Which three rules of HIPAA matter most for day-to-day work at ERS?", ["Privacy Rule, Security Rule and Breach Notification Rule", "Billing Rule, Coding Rule and Claims Rule", "Hiring Rule, Pay Rule and Leave Rule", "Marketing Rule, Sales Rule and Contract Rule"], [0], "HIPAA's Privacy, Security and Breach Notification Rules set how health information is used, kept safe and handled when exposed."),
  q("foundations", "Who is who", "single", "A medical billing company hires ERS to help with its work, and ERS team members will see patient billing records. In HIPAA terms, ERS is most likely acting as:", ["A business associate or subcontractor", "A patient", "A government regulator", "A news organization"], [0], "A company that handles patient information while doing work for a covered entity is a business associate (or a subcontractor of one)."),
  q("foundations", "Who is who", "multiple", "Which of these can be a covered entity? Select all that apply.", ["A health plan", "A doctor's office that bills insurance electronically", "A healthcare clearinghouse", "A person who is a patient"], [0, 1, 2], "Covered entities are health plans, clearinghouses and providers who bill electronically. A patient is the person the information is about."),
  q("foundations", "Access is not permission", "single", "Your login lets you open every patient chart in the system. When may you open a chart?", ["Only when your assigned task needs it", "Whenever you are curious, if you do not tell anyone", "When a friend asks you to check someone", "When the system is quiet"], [0], "Use is limited to what your task needs. The ability to open a record is not permission."),
  q("foundations", "Access is not permission", "true_false", "True or false: If nobody can ever find out, it is acceptable to look up a coworker's patient record out of curiosity.", ["True", "False"], [1], "Looking without a work reason is a privacy violation whether or not anyone notices. Access is logged and reviewed."),
  q("foundations", "The agreement sets the rules", "single", "What does a business associate agreement (BAA) do?", ["Sets what the business associate may do with patient information and what safeguards it must use", "Lists the salaries of the client's staff", "Replaces the need for training", "Lets the team share patient information freely among themselves"], [0], "A BAA is the contract that sets the permitted uses, the required safeguards and the reporting duties for the information."),
  q("foundations", "Client rules", "single", "ERS's rules and your client's instructions differ on how to send a file. What do you do?", ["Follow the stricter rule and ask your lead if you are unsure", "Follow the one that is quicker", "Follow whichever you saw a coworker use", "Ignore both and use your own method"], [0], "When two sets of rules apply and differ, the stricter one protects the information. Ask your lead when unsure."),
  q("foundations", "When unsure", "single", "You are asked to do something with patient information that you have never done and are not sure is allowed. What is the best first step?", ["Stop and ask your team lead or client contact", "Do it quickly so the task is not late", "Do it, then mention it afterward", "Ask a friend who works in healthcare"], [0], "When unsure, stop, do not share, and ask. A short question is always cheaper than a wrong disclosure."),
  q("foundations", "Compliance program", "multiple", "Which of these are part of the privacy and security program ERS runs? Select all that apply.", ["Training for the workforce", "Written policies and client agreements", "Sanctions for people who break the rules", "Letting each person decide their own rules"], [0, 1, 2], "A program has training, written policies and agreements, sanctions, risk checks and records. Individuals do not set their own rules."),
  q("foundations", "Reporting", "true_false", "True or false: ERS will punish you for reporting a possible privacy incident you noticed, even if it turns out to be nothing.", ["True", "False"], [1], "ERS does not punish good-faith reports, and fast reporting is how problems are limited."),
  q("foundations", "Consequences", "multiple", "Which of these can follow a deliberate privacy violation? Select all that apply.", ["Penalties for the organization", "Criminal penalties for knowingly misusing patient information", "ERS sanctions, up to ending the engagement", "A bonus for finding the record first"], [0, 1, 2], "HIPAA has civil and criminal penalties, and ERS applies sanctions. Nothing rewards misuse."),
];
