import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 3: the Privacy Rule: using and sharing PHI. Version 2 (deeper). Grounded in 45 CFR 164.502 (general rules and minimum
// necessary), 164.506 (treatment, payment, operations), 164.508 (authorization, marketing, sale), 164.510 (agree or object),
// 164.512 (public interest and benefit), 164.514(h) (verification). All people and details are invented. Counsel reviews this.

export const m3: CourseModule = {
  key: "privacy",
  title: "The Privacy Rule: using and sharing patient information",
  summary: "When patient information may be used or shared, when a written authorization is needed, how the public-interest exceptions work, and how to share only the minimum.",
  estimatedMinutes: 20,
  tracks: ["full", "essentials", "refresher"],
  keyPoints: [
    "Use means working with information inside the organization; disclosure means giving it to someone outside; both need a valid reason.",
    "Treatment, payment and healthcare operations are permitted without asking the patient each time; most other purposes need a written authorization.",
    "Marketing with patient information and selling it generally need the patient's written authorization.",
    "The public-interest disclosures (police, courts, public health and others) are the client's decisions, never yours.",
    "Minimum necessary means the least information that does the job.",
    "Verify who is asking before you share anything.",
    "Use the ERS 5-point send check: who, what, why, where, how.",
  ],
  screens: [
    {
      id: "mindset",
      title: "The privacy mindset",
      blocks: [
        { type: "paragraph", text: "The Privacy Rule gives patients control over their information. Your job is not to decide what is safe to share. Your job is to use the information only for the task, and to share it only through the approved way." },
        { type: "callout", tone: "info", text: "A good test before any action: \"Would this patient be comfortable if they saw exactly what I am doing?\"" },
      ],
    },
    {
      id: "use-disclose-request",
      title: "Use, disclosure and request",
      blocks: [
        { type: "paragraph", text: "These three words mean different things, and the rules are different for each." },
        {
          type: "table",
          columns: ["Word", "What it is", "Example"],
          rows: [
            ["Use", "Working with information inside your organization to do your task", "Reading a claim to correct it"],
            ["Disclosure", "Giving or showing information to someone outside the organization", "Sending an invoice to a collection agency"],
            ["Request", "Asking another organization for patient information", "Asking a lab for a result"],
          ],
        },
        { type: "paragraph", text: "Each one needs a valid reason, and each one must be limited to what is needed." },
      ],
    },
    {
      id: "default",
      title: "The starting point: only what the rule allows",
      blocks: [
        { type: "paragraph", text: "The Privacy Rule works like a locked door. Patient information may be used and disclosed only in the ways the rule lists. Everything else needs the patient's written permission." },
        {
          type: "layers",
          title: "Three groups of reasons",
          items: [
            { label: "Always allowed", text: "To the patient, and to HHS when it investigates." },
            { label: "Allowed without a form", text: "Treatment, payment, healthcare operations, and a short list of public-interest and legal reasons." },
            { label: "Needs written authorization", text: "Almost everything else, including marketing and sale of the information." },
          ],
        },
      ],
    },
    {
      id: "tpo",
      title: "Treatment, payment and operations",
      blocks: [
        { type: "paragraph", text: "Covered entities may use and share information for **treatment**, **payment** and **healthcare operations** without asking the patient each time. Most of the work you do falls under these." },
        {
          type: "table",
          columns: ["Purpose", "What it covers", "Work you might do"],
          rows: [
            ["Treatment", "Providing, coordinating or managing a patient's care", "Scheduling a referral appointment"],
            ["Payment", "Billing, claims, eligibility checks, collection", "Verifying insurance coverage"],
            ["Operations", "Running the practice: quality review, training, audits", "Preparing records for an internal audit"],
          ],
        },
        { type: "callout", tone: "warning", text: "That permission belongs to the covered entity and reaches ERS only through the BAA. It does not make everything fair game: you work within your client's specific instructions." },
      ],
    },
    {
      id: "agree-or-object",
      title: "When the patient gets a chance to agree or object",
      blocks: [
        { type: "paragraph", text: "A few disclosures are allowed if the patient is told and does not object. These are the covered entity's decisions, made with the patient, not by a VA on the phone." },
        {
          type: "list",
          items: [
            "Telling visitors a patient's location in a facility, when the patient has not objected",
            "Sharing relevant information with a family member or friend involved in the patient's care or payment",
            "Notifying family in a disaster to help with care or location",
          ],
        },
        { type: "callout", tone: "tip", text: "If the patient is present and says no, the answer is no. If you do not know whether they agreed, you do not share: you take a message and pass it to the client." },
      ],
    },
    {
      id: "authorization",
      title: "When the patient's written permission is needed",
      blocks: [
        { type: "paragraph", text: "For anything outside treatment, payment, healthcare operations and the other purposes the rule permits, the patient must give a **written authorization**: a signed form that says what may be shared, with whom, and why." },
        {
          type: "table",
          caption: "What a valid authorization contains",
          columns: ["Element", "Why it is there"],
          rows: [
            ["A specific description of the information", "So everyone knows exactly what may be shared"],
            ["Who may share it, and who may receive it", "So it goes only to the named people"],
            ["The purpose", "So it is not used for something else"],
            ["An expiration date or event", "So it does not last forever"],
            ["Signature and date", "So it is the patient's own choice"],
            ["The right to revoke, in writing", "So the patient can change their mind"],
          ],
        },
        { type: "callout", tone: "warning", text: "You will never decide this yourself. Your client keeps the authorizations and decides. If a request is outside your task, route it to your lead or client contact." },
      ],
    },
    {
      id: "marketing",
      title: "Marketing and selling patient information",
      blocks: [
        { type: "paragraph", text: "**Marketing** means communicating about a product or service to encourage people to buy or use it. When a communication uses patient information for marketing, the patient generally must sign an authorization first. **Selling** patient information, receiving payment for it, also needs the patient's authorization." },
        {
          type: "compare",
          left: { title: "Usually fine", items: ["A reminder about the patient's own appointment", "A message about the clinic's own services as part of their care", "A face-to-face conversation about a product"], },
          right: { title: "Needs authorization", items: ["Using a patient list to promote another company's product", "Taking money from a company to send its offer to patients", "Posting a patient's photo or story on a website or social media"] },
        },
        { type: "callout", tone: "warning", text: "If you build or maintain a client's website, newsletter or social pages, this applies to you directly. A patient's story, photo or review is not yours to post without the client confirming a signed authorization." },
      ],
    },
    {
      id: "psychotherapy-notes",
      title: "Psychotherapy notes",
      blocks: [
        { type: "paragraph", text: "**Psychotherapy notes** are a counselor's own private notes about a counseling session, kept separate from the rest of the medical record. They get stronger protection: most uses and disclosures need a specific written authorization." },
        { type: "callout", tone: "info", text: "This is different from the ordinary mental health information in a chart, such as medications, session times, test results and diagnoses. You will not usually see psychotherapy notes, and if you do, do not copy, quote or forward them. Ask your lead." },
      ],
    },
    {
      id: "authorities",
      title: "When police, a court or an agency asks",
      blocks: [
        { type: "paragraph", text: "The law lets, and sometimes requires, a covered entity to share information without the patient's authorization in a defined list of situations:" },
        {
          type: "list",
          items: [
            "When another law requires it",
            "For public health activities, such as reporting certain diseases",
            "To report abuse, neglect or domestic violence, in the situations the rule describes",
            "For health oversight, such as an audit or license review",
            "In court and administrative proceedings, with an order, subpoena or similar process",
            "For certain law enforcement purposes, with limits",
            "To avert a serious and imminent threat to health or safety",
          ],
        },
        { type: "paragraph", text: "Those decisions are the client's, made with its own legal checks. A phone call is not proof of any of them." },
      ],
    },
    {
      id: "case-detective",
      title: "Worked case: the detective on the phone",
      blocks: [
        {
          type: "scenario",
          title: "A caller says he is a detective",
          prompt: "A man phones the clinic line, says he is a detective investigating a case, and asks for a patient's home address \"urgently\". He gives a badge number.",
          choices: [
            { text: "Give the address. Police have the right to it.", feedback: "You cannot verify him, and whether the clinic may share it is the client's decision.", best: false },
            { text: "Share nothing, take his contact details, and pass the request to your client contact straight away.", feedback: "Correct. The client verifies and decides. You route.", best: true },
            { text: "Confirm only whether the person is a patient.", feedback: "Confirming that someone is a patient is itself a disclosure.", best: false },
          ],
        },
        {
          type: "case",
          title: "A second look: the subpoena in the mail",
          scenario: "A letter arrives at the clinic from a law firm, with a document that looks like a subpoena asking for a patient's full chart. The office manager is out and the letter says it is due in three days.",
          question: "Who handles this, and what do you do with it?",
          answer: "The client's privacy contact or legal advisor handles it, because a subpoena alone may not be enough to release a chart without further steps. You do not copy, scan or send anything. Photograph nothing, note only that it arrived and when, and pass the original to your client contact the same day.",
        },
      ],
    },
    {
      id: "minimum-necessary",
      title: "Minimum necessary",
      blocks: [
        { type: "paragraph", text: "The **minimum necessary** rule means using, sharing or asking for only the least amount of information needed to do the job." },
        {
          type: "compare",
          left: { title: "Minimum necessary", items: ["Send the invoice number and amount", "Share only the dates needed to schedule", "Open the one record you were asked to update"] },
          right: { title: "Too much", items: ["Send the full chart to answer a billing question", "Copy the entire patient list \"to be safe\"", "Browse other patients on the same screen"] },
        },
      ],
    },
    {
      id: "exceptions",
      title: "Where minimum necessary does not apply",
      blocks: [
        { type: "paragraph", text: "The standard does not apply in a few places, because limiting the information would defeat the purpose:" },
        {
          type: "list",
          items: [
            "Disclosures to a provider for the patient's treatment",
            "Disclosures to the patient themselves",
            "Disclosures made under the patient's own authorization",
            "Disclosures to HHS for an investigation",
            "Disclosures the law requires",
          ],
        },
        { type: "callout", tone: "tip", text: "These exceptions are for your client to apply, not for you to decide. If you think one applies, ask your lead or client contact. Do not rely on your own reading." },
      ],
    },
    {
      id: "incidental",
      title: "Incidental disclosures: when it cannot be perfect",
      blocks: [
        { type: "paragraph", text: "The Privacy Rule does not demand that every possible exposure be eliminated. Some exposure comes with normal work: a name on a sign-in sheet, a conversation that someone nearby might hear, a screen that a visitor glances at. These are **incidental** and are allowed, but only if **reasonable safeguards** are in place and the information was limited to the minimum." },
        {
          type: "list",
          items: [
            "Keep the reason for a visit off any sheet others can read.",
            "Lower your voice, move away from others, or use a headset.",
            "Angle or lock your screen so passers-by cannot read it.",
            "If you could say it without a name, say it without a name.",
          ],
        },
        {
          type: "check",
          question: "An incidental disclosure is acceptable when:",
          options: [
            { text: "Reasonable safeguards were in place and only the minimum information was involved", correct: true, feedback: "Right. Safeguards and minimum necessary are what make it incidental." },
            { text: "Nobody complained", correct: false, feedback: "Complaints are not the test. Safeguards and minimum necessary are." },
            { text: "The person overhearing was a coworker", correct: false, feedback: "Who overhears is not the test either." },
          ],
        },
      ],
    },
    {
      id: "state-laws",
      title: "HIPAA is the minimum, not the maximum",
      blocks: [
        { type: "paragraph", text: "HIPAA is a federal floor. Where a state law gives patients **more** privacy protection, that stricter law can apply as well. Some kinds of information, such as mental health, substance use treatment or HIV records, often have extra rules." },
        {
          type: "list",
          items: [
            "Your client and ERS decide which rules apply to a task. Their instructions already reflect them.",
            "If a request involves sensitive records or something unusual, stop and ask.",
            "A rule being different in another state is a reason to ask, not a reason to guess.",
          ],
        },
        { type: "callout", tone: "tip", text: "Whichever rule is stricter is the one you follow." },
      ],
    },
    {
      id: "verify",
      title: "Know who you are talking to",
      blocks: [
        { type: "paragraph", text: "Before you share anything, you must be sure the person is allowed to receive it. HIPAA requires organizations to verify the identity and authority of people requesting information when they are not already known. A friendly voice, an official-looking email or an urgent tone is not proof." },
        {
          type: "steps",
          items: [
            { title: "Confirm who is asking", text: "Use your client's verification steps, not the details the caller gives you." },
            { title: "Confirm they are allowed", text: "Is this person on the approved list for this information?" },
            { title: "Share the minimum", text: "Only what answers the question." },
          ],
        },
      ],
    },
    {
      id: "five-point",
      title: "The ERS 5-point send check",
      blocks: [
        { type: "paragraph", text: "Before you send any patient information, ask five questions. If any answer is \"not sure\", do not send." },
        {
          type: "steps",
          items: [
            { title: "Who?", text: "Is the recipient the right, authorized person?" },
            { title: "What?", text: "Is it only the minimum information needed?" },
            { title: "Why?", text: "Is there a task-related reason?" },
            { title: "Where?", text: "Is the destination the approved system or address?" },
            { title: "How?", text: "Is the method approved and secure for this information?" },
          ],
        },
      ],
    },
    {
      id: "scenario-family",
      title: "Try it: the worried daughter",
      blocks: [
        {
          type: "scenario",
          title: "A call from a family member",
          prompt: "Someone calls the clinic line and says she is a patient's daughter. She is crying and asks for her mother's appointment details and what medication was prescribed.",
          choices: [
            { text: "Give her the details, because she is clearly upset and family.", feedback: "You cannot confirm she is allowed to receive them. Sympathy is not authorization.", best: false },
            { text: "Kindly explain you cannot share information, and follow the client's process for such requests, such as taking a message for the clinic.", feedback: "Correct. Stay kind, share nothing, and use the approved process.", best: true },
            { text: "Share only the appointment time, not the medication.", feedback: "Even \"just the time\" is PHI. Without confirmed permission you do not share it.", best: false },
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
            { term: "Use", meaning: "Working with patient information inside an organization to do a task." },
            { term: "Disclosure", meaning: "Giving or showing patient information to someone outside the organization." },
            { term: "Authorization", meaning: "The patient's signed permission for a specific use or disclosure." },
            { term: "Minimum necessary", meaning: "Using, sharing or requesting only the least information needed for the purpose." },
            { term: "Incidental disclosure", meaning: "Exposure that comes with normal work despite reasonable safeguards, and is allowed." },
            { term: "Verification", meaning: "Confirming a person's identity and authority before sharing information." },
          ],
        },
      ],
    },
  ],
};

export const q3: QuestionSeed[] = [
  q("privacy", "Use disclose request", "single", "Sending a patient's invoice to an outside collection agency is best described as:", ["A disclosure", "A use inside the organization", "A request", "A de-identification"], [0], "Giving information to someone outside the organization is a disclosure."),
  q("privacy", "Use disclose request", "single", "Asking another clinic to send you a patient's lab results is best described as:", ["A request", "A disclosure", "A use", "A breach"], [0], "Asking another organization for patient information is a request, and it also has to follow minimum necessary."),
  q("privacy", "Use disclose request", "single", "A team member reads a claim inside the client's billing system to fix a coding error. This is best described as:", ["A use", "A disclosure", "A request", "A sale"], [0], "Working with information inside the organization to do a task is a use."),
  q("privacy", "Starting point", "single", "Which statement best describes how the Privacy Rule treats patient information?", ["It may be used or disclosed only in the ways the rule allows, and otherwise needs the patient's written authorization", "It may be shared freely unless the patient objects", "It may be shared with anyone in healthcare", "It may be shared with anyone who asks politely"], [0], "The rule lists the permitted uses and disclosures, and requires written authorization for other uses."),
  q("privacy", "TPO", "multiple", "Which of these are covered entities generally permitted to do with PHI without asking the patient each time? Select all that apply.", ["Use it for treatment", "Use it to get paid for care", "Use it for healthcare operations such as quality review", "Use it to promote another company's product"], [0, 1, 2], "Treatment, payment and healthcare operations are permitted. Promoting an unrelated product is marketing and needs authorization."),
  q("privacy", "TPO", "single", "Verifying a patient's insurance coverage before an appointment is an example of:", ["Payment", "Marketing", "Research", "Fundraising"], [0], "Eligibility checks are part of payment activities."),
  q("privacy", "TPO", "single", "Your client's instructions limit you to billing tasks. A coworker asks you to pull appointment notes 'for treatment' on a patient you do not handle. What do you do?", ["Check with your lead or the client, because your task does not include that", "Pull the notes, since treatment is permitted", "Pull the notes and mention it afterward", "Send them to your coworker's personal email"], [0], "The permission belongs to the covered entity and reaches you only through the client's instructions for your task."),
  q("privacy", "Agree or object", "single", "A caller who says they are a patient's friend asks whether the patient is in the clinic today. What is the right approach?", ["Share nothing and follow the client's process for such requests", "Confirm it, because a friend is allowed to know", "Confirm it if the caller sounds worried", "Ask the caller to describe the patient and confirm if it matches"], [0], "Whether a visitor may be told is decided by the client and the patient's agreement. Without that, you share nothing."),
  q("privacy", "Authorization", "multiple", "Which of these are required parts of a valid authorization? Select all that apply.", ["A description of the information to be shared", "The purpose of the disclosure", "An expiration date or event", "The patient's favorite doctor"], [0, 1, 2], "A valid authorization names the information, the parties, the purpose, an expiration and a signature and date."),
  q("privacy", "Authorization", "true_false", "True or false: A patient can cancel an authorization they signed earlier by giving written notice.", ["True", "False"], [0], "A patient has the right to revoke an authorization in writing, and it then stops applying for future uses."),
  q("privacy", "Authorization", "single", "A friend of a patient asks you to send the patient's appointment history to a personal email address. What is the best response?", ["Do not send it, and route the request to your client contact", "Send it, because the friend is trusted", "Send it if the friend says the patient agreed", "Send only half of it"], [0], "Without a confirmed authorization or another permitted basis, you do not disclose, and you route the request."),
  q("privacy", "Marketing", "single", "A client asks you to add a patient's before-and-after photo and a thank-you note to its website. What do you need before you post it?", ["The client's confirmation that the patient signed an authorization", "Nothing, because the patient was happy", "Only the patient's first name removed", "The photo to be small"], [0], "Posting a patient's image or story is marketing or public disclosure and needs the patient's written authorization."),
  q("privacy", "Marketing", "single", "Which situation generally needs a patient's authorization?", ["Using patient information to promote another company's product and being paid for it", "A reminder about the patient's own appointment", "A bill sent to the patient for care they received", "A check on whether insurance covers a visit"], [0], "Using patient information to promote a third party's products, especially for payment, needs authorization."),
  q("privacy", "Marketing", "single", "A client's front-office wants a spreadsheet of all patients' email addresses sent to a bulk email service the client has never used. What do you do?", ["Stop and ask your lead, because the service may not be approved and the message may need authorization", "Send it, because email addresses are not sensitive", "Send only patients with long names", "Send it and mention it afterward"], [0], "A new vendor without an agreement and a marketing message may both be problems. Ask first."),
  q("privacy", "Psychotherapy notes", "single", "Which statement about psychotherapy notes is correct?", ["Most uses and disclosures need a specific written authorization", "They are shared as freely as any other part of the chart", "They can be posted to a team group chat", "They are the same as a patient's list of medications"], [0], "Psychotherapy notes are kept separate and get stronger protection."),
  q("privacy", "Authorities", "single", "A caller says he is from the police and asks you for a patient's address. What is the best response?", ["Take his details and route the request to the client without sharing anything", "Give the address if he sounds official", "Confirm the patient exists and share the address later", "Ask him to email you the request and send the address back"], [0], "Law enforcement requests are decided by the client, with verification. A phone call is not proof."),
  q("privacy", "Authorities", "multiple", "Which of these are situations where the law may permit a covered entity to share PHI without authorization? Select all that apply.", ["Public health reporting", "A valid court order", "Reporting suspected abuse as the law requires", "A friend asking out of curiosity"], [0, 1, 2], "Public health, legal process and abuse reporting are in the list of public-interest disclosures. Curiosity is not."),
  q("privacy", "Authorities", "single", "A letter arrives that appears to be a subpoena for a patient's chart. What is the right first step for a VA?", ["Pass it to the client's privacy contact the same day without copying or sending anything", "Scan and send the chart to the law firm", "Photograph it and post it to the team chat", "Throw it away"], [0], "Legal requests are handled by the client's privacy contact or counsel. The VA does not release records."),
  q("privacy", "Minimum necessary", "single", "A billing question needs the claim number and amount. What should you send?", ["Only the claim number and amount", "The full chart, so the other party has context", "The whole patient list", "A screenshot of the patient's record"], [0], "Minimum necessary means the smallest amount of information that answers the question."),
  q("privacy", "Minimum necessary", "true_false", "True or false: Minimum necessary means you should always send the whole record so nothing is missing.", ["True", "False"], [1], "The rule points the other way: use, share or request only what is needed."),
  q("privacy", "Minimum necessary", "multiple", "Minimum necessary does not apply to which of these? Select all that apply.", ["Disclosures to the patient themselves", "Disclosures to a provider for the patient's treatment", "Disclosures the law requires", "A routine request to a vendor for patient information"], [0, 1, 2], "The standard does not apply to treatment disclosures, disclosures to the patient, authorized disclosures, HHS investigations and required disclosures. Routine vendor requests are covered."),
  q("privacy", "Incidental", "single", "A name appears on a sign-in sheet at a front desk, with no reason for the visit. This is likely:", ["An incidental disclosure that is acceptable with reasonable safeguards", "A serious breach every time", "Marketing", "A sale of information"], [0], "Incidental exposure that follows reasonable safeguards and minimum necessary is allowed."),
  q("privacy", "Incidental", "single", "Which is a reasonable safeguard against incidental disclosure on a phone call?", ["Moving away from others and lowering your voice", "Speaking louder so the patient hears", "Putting the call on speaker in a shared room", "Reading the details twice"], [0], "Reasonable safeguards limit what others can overhear."),
  q("privacy", "State laws", "single", "A state law gives patients more privacy protection than HIPAA for a type of record. What applies?", ["The stricter protection can apply as well, so ask when unsure", "Only HIPAA applies in every case", "Neither applies", "Whichever is quicker to follow"], [0], "HIPAA is a federal floor. Stricter state laws can apply, and a VA asks rather than guesses."),
  q("privacy", "Verification", "single", "A caller who says she is a patient's employer asks about the patient's sick leave diagnosis. What should you do?", ["Share nothing and route the request, since an employer is not a permitted recipient without authorization", "Give the diagnosis if she names the patient", "Give a summary without the diagnosis name", "Confirm the patient has been in"], [0], "An employer has no general right to patient information. Without authorization, you do not share, and you route the request."),
  q("privacy", "Verification", "multiple", "Which of these are acceptable ways to confirm who is asking before sharing PHI? Select all that apply.", ["Using your client's verification steps", "Checking the person is on the approved list for that information", "Taking the caller's word because they know the patient's name", "Asking the caller to read back the number they dialed"], [0, 1], "Use the client's steps and the approved list. A caller knowing a name is not proof."),
  q("privacy", "5-point check", "multiple", "Which of these are part of the ERS 5-point send check? Select all that apply.", ["Who is the recipient and are they authorized", "What is the minimum needed", "Where and how it will be sent", "How fast it can be sent"], [0, 1, 2], "The five points are who, what, why, where and how. Speed is not one of them."),
  q("privacy", "Family", "single", "A caller says she is the patient's sister and asks what medication was prescribed. What is the right answer?", ["Kindly explain you cannot share and follow the client's process", "Give the name of the medication, since she is family", "Give only the dose", "Confirm the pharmacy name only"], [0], "Family is not automatic authorization. The client decides who may receive information."),
];
