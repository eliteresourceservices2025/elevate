import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 5 (new in version 2): business associates, subcontractors and the agreement between them. Grounded in 45 CFR 160.103
// (business associate, subcontractor), 164.502(e) and 164.504(e) (the contract), 164.314(a) (security requirements in the contract)
// and 164.410 (a business associate's duty to notify). All people and details are invented. Counsel reviews this.

export const m5: CourseModule = {
  key: "associates",
  title: "Business associates and the agreements behind your work",
  summary: "What a business associate is, what the business associate agreement must contain, who is responsible for what, and why a careless vendor is everyone's problem.",
  estimatedMinutes: 8,
  tracks: ["full", "essentials"],
  keyPoints: [
    "A business associate performs functions for a covered entity that involve patient information.",
    "A business associate agreement is required before any patient information is shared.",
    "A business associate must bind its own subcontractors to the same limits.",
    "Since 2009, business associates are directly responsible for the Security Rule and answer to the government.",
    "A business associate must report a breach to the covered entity without unreasonable delay.",
    "Tools and vendors you use for client work are part of the chain and must be approved.",
  ],
  screens: [
    {
      id: "who",
      title: "Who is a business associate",
      blocks: [
        { type: "paragraph", text: "A **business associate** is a person or company that does something **on behalf of** a covered entity that involves patient information, and is not a member of that entity's own workforce." },
        {
          type: "list",
          items: [
            "Billing, claims processing and collections",
            "Data analysis, quality review and practice management",
            "Legal, accounting, consulting and accreditation services",
            "IT support, hosting, cloud storage and software that holds patient information",
            "Administrative support such as scheduling, transcription and virtual assistant services",
          ],
        },
        { type: "callout", tone: "info", text: "ERS is a business associate of many of its clients. The tools and vendors ERS uses to do that work can be business associates of ERS, which makes them subcontractors." },
      ],
    },
    {
      id: "required",
      title: "No agreement, no information",
      blocks: [
        { type: "paragraph", text: "A covered entity may share patient information with a business associate only after it has received written **satisfactory assurances** that the information will be safeguarded. In practice, that means a signed **business associate agreement**." },
        { type: "paragraph", text: "The same is true one step down the chain: when a business associate uses a subcontractor, they need an agreement too, containing the same restrictions." },
        { type: "callout", tone: "warning", text: "If you are asked to use a tool that has not been approved, the missing piece may be a contract. That is a reason to ask, even when the tool seems harmless." },
      ],
    },
    {
      id: "provisions",
      title: "What the agreement must contain",
      blocks: [
        { type: "paragraph", text: "A business associate agreement is not free-form. HIPAA lists what it must say. Here is the core, and what each item means for your work:" },
        {
          type: "table",
          caption: "Required provisions of a business associate agreement",
          columns: ["The business associate must...", "On the job, this means"],
          rows: [
            ["Use and disclose information only as the contract allows", "Stay within the task. No side uses."],
            ["Use appropriate safeguards and follow the Security Rule for electronic information", "Approved systems, strong sign-in, locked screens."],
            ["Report any use or disclosure the contract does not allow, including breaches", "Report quickly and truthfully."],
            ["Make sure subcontractors agree to the same restrictions", "Use only approved vendors and tools."],
            ["Help the client respond to patients' access, amendment and accounting requests", "Route requests the same day."],
            ["Make its records available to HHS for compliance reviews", "Keep records as instructed."],
            ["Return or destroy the information when the contract ends, if feasible", "Never keep copies."],
          ],
        },
      ],
    },
    {
      id: "termination",
      title: "When the agreement is broken",
      blocks: [
        { type: "paragraph", text: "The agreement must let the covered entity **end the contract** if the business associate violates a material term. A client that learns a vendor has been careless is not just upset: the law expects it to act." },
        {
          type: "steps",
          items: [
            { title: "The client learns of a problem", text: "From a report, an audit or a patient complaint." },
            { title: "It must act", text: "Work with the associate to cure it, or end the contract." },
            { title: "The consequence lands on people", text: "ERS may lose the client, and the team loses the work." },
          ],
        },
        { type: "callout", tone: "tip", text: "Fast, honest reporting is how an incident stays a problem to solve instead of a reason to end a contract." },
      ],
    },
    {
      id: "direct-responsibility",
      title: "Business associates answer directly",
      blocks: [
        { type: "paragraph", text: "Before 2009, a business associate answered mainly to the covered entity through the contract. Since the HITECH Act and the 2013 Omnibus Rule, business associates and their subcontractors are **directly liable** for complying with the Security Rule and for certain parts of the Privacy Rule." },
        {
          type: "layers",
          title: "Who answers to whom",
          items: [
            { label: "HHS and the Department of Justice", text: "Can act directly against covered entities and business associates." },
            { label: "The covered entity", text: "Answers to HHS, and to its patients." },
            { label: "The business associate", text: "Answers to HHS and to the covered entity under the agreement." },
            { label: "Subcontractors", text: "Answer to the business associate, and directly under the rules." },
          ],
        },
      ],
    },
    {
      id: "case-vendor",
      title: "Worked case: the careless vendor",
      blocks: [
        {
          type: "case",
          title: "A scheduling tool without a contract",
          scenario: "A VA team lead finds a scheduling app that is cheaper and easier than the one the client approved. She starts using it for a clinic's appointments, planning to tell the client later. Three months on, the app's database is exposed online and appointment lists, with patient names and visit reasons, can be seen by anyone.",
          question: "What went wrong, and who is affected?",
          answer: "The app was used without an agreement, so nothing bound it to safeguard the information, to limit its use or to report the exposure. The clinic never approved it, so it could not assess the risk. The exposure is a breach of unsecured information that the clinic must now handle, patients may have to be told, and ERS and the team lead answer for using an unapproved vendor. A short question at the start would have prevented all of it.",
        },
      ],
    },
    {
      id: "notify",
      title: "A business associate's duty to tell",
      blocks: [
        { type: "paragraph", text: "When a business associate discovers a breach of unsecured information, it must notify the covered entity **without unreasonable delay and no later than 60 days** after discovery. Many contracts require much faster, sometimes within days." },
        { type: "paragraph", text: "That duty depends on you. A breach is considered discovered when anyone in the workforce knows, or with reasonable care would have known, so a day you wait can use up the client's time." },
        { type: "callout", tone: "warning", text: "Do not wait to be sure. Reporting a possible incident internally the same day is how ERS meets its own deadline." },
      ],
    },
    {
      id: "where-work",
      title: "Where and how you work is part of the contract",
      blocks: [
        { type: "paragraph", text: "Client agreements, and sometimes payer rules, can say where information may be stored and from where work may be done, and which systems may be used. The agreement, not your preference, decides." },
        {
          type: "list",
          items: [
            "Work only from the places and devices the client and ERS approved.",
            "Never move client work to your own account, storage or tools.",
            "If a client's rule seems impractical, raise it with your lead; do not work around it.",
          ],
        },
      ],
    },
    {
      id: "check-vendor",
      title: "Quick check",
      blocks: [
        {
          type: "check",
          question: "A client's office manager asks you to forward appointment lists to her personal email so she can work at home. What is the best response?",
          options: [
            { text: "Politely decline and ask your lead for the approved way to give her access", correct: true, feedback: "Right. Personal email is outside the approved chain, and the office manager's request does not change that." },
            { text: "Send it, because she is the client", correct: false, feedback: "The client's own staff can still break the client's rules. The approved systems are the rule." },
            { text: "Send it with the names removed", correct: false, feedback: "Appointment dates and times can still identify patients, and the channel is still unapproved." },
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
            { term: "Business associate", meaning: "A person or company that does work for a covered entity involving patient information." },
            { term: "Business associate agreement", meaning: "The written contract that sets how a business associate may use and must protect patient information." },
            { term: "Subcontractor", meaning: "A business associate's own vendor that handles patient information to help with the work." },
            { term: "Satisfactory assurances", meaning: "The covered entity's required written promise from the business associate that it will safeguard information." },
            { term: "Unsecured PHI", meaning: "PHI that is not rendered unusable or unreadable to others, for example by approved encryption." },
          ],
        },
      ],
    },
  ],
};

export const q5: QuestionSeed[] = [
  q("associates", "Who", "single", "Which of these is most likely a business associate of a clinic?", ["A company that handles the clinic's billing and sees patient records", "A patient who pays a bill", "A delivery driver who drops off supplies", "A visitor to the waiting room"], [0], "A business associate does work for a covered entity that involves patient information."),
  q("associates", "Who", "multiple", "Which of these functions can make a company a business associate when it handles patient information? Select all that apply.", ["Claims processing and billing", "Cloud hosting of patient files", "Transcription or virtual assistant services", "Delivering a clinic's mail with no access to its contents"], [0, 1, 2], "Billing, hosting and administrative support involve patient information. A courier who only moves sealed mail does not use it."),
  q("associates", "Agreement", "single", "When must a business associate agreement be in place?", ["Before patient information is shared with the business associate", "After the first problem", "Only if the vendor asks for it", "Only if the vendor is outside the United States"], [0], "The covered entity must receive satisfactory assurances, in a written agreement, before sharing information."),
  q("associates", "Agreement", "true_false", "True or false: A signed business associate agreement is optional when a vendor's tool is free.", ["True", "False"], [1], "Price does not matter. If a tool handles patient information, an agreement is needed."),
  q("associates", "Provisions", "multiple", "Which of these must a business associate agreement require of the business associate? Select all that apply.", ["Report breaches and other unauthorized uses", "Make sure its subcontractors agree to the same restrictions", "Return or destroy the information at the end of the contract if feasible", "Share information with anyone who asks"], [0, 1, 2], "Reporting, subcontractor flow-down and return or destruction are required terms. Sharing with anyone who asks is the opposite."),
  q("associates", "Provisions", "single", "Why must a business associate agreement make subcontractors agree to the same limits?", ["So the protection follows the information down the chain", "So the clinic can avoid responsibility", "So the vendor can charge more", "So it is easier to share"], [0], "The chain of trust only works if every link is bound by the same restrictions."),
  q("associates", "Termination", "single", "A business associate seriously violates its agreement. What must the agreement allow the covered entity to do?", ["End the contract", "Ignore it", "Fine the patient", "Take the associate's computers"], [0], "The agreement must allow termination if the business associate violates a material term."),
  q("associates", "Direct liability", "single", "Since the HITECH Act and the Omnibus Rule, business associates are:", ["Directly liable for complying with the Security Rule and certain parts of the Privacy Rule", "Responsible only to their clients", "Exempt if they are small", "Exempt if they are outside the United States"], [0], "Business associates and their subcontractors are directly liable to HHS for the Security Rule and applicable Privacy Rule provisions."),
  q("associates", "Notification", "single", "A business associate discovers a breach of unsecured PHI. By when must it notify the covered entity at the latest?", ["Without unreasonable delay and no later than 60 days after discovery", "Within one year", "At the end of the contract", "Only if the patient asks"], [0], "A business associate must notify the covered entity without unreasonable delay and no later than 60 days after discovery. Contracts often require sooner."),
  q("associates", "Discovery", "single", "When is a breach treated as discovered by a business associate?", ["On the first day any workforce member knows of it, or would have known with reasonable care", "Only when the report is filed", "Only when the patient calls", "When the contract ends"], [0], "Knowledge of any workforce member, or what reasonable diligence would have revealed, starts the clock."),
  q("associates", "Vendors", "single", "You find a free tool that would make a client task faster. What must be true before you use it with patient information?", ["It is approved by ERS and the client, with an agreement in place", "It looks professional", "Other teams use it", "It does not ask for a login"], [0], "A tool that handles patient information must be approved and covered by an agreement."),
  q("associates", "Vendors", "single", "A client's staff member asks you to forward patient information to their personal email 'just this once'. What do you do?", ["Decline politely and ask your lead for the approved way", "Forward it, because they are the client", "Forward it with the subject line left blank", "Forward only part of it"], [0], "Personal email is outside approved systems. A client's staff can ask, but the approved systems are the rule."),
  q("associates", "Where you work", "single", "Your client's agreement limits where work can be done from. A new place would be more convenient. What do you do?", ["Follow the agreement and raise the idea with your lead", "Work from the convenient place anyway", "Work there and say nothing", "Move the work to a personal account"], [0], "The agreement decides where and how the work is done."),
];
