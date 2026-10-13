import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 3: the Privacy Rule and minimum necessary. Invented examples only.

export const m3: CourseModule = {
  key: "privacy",
  title: "The Privacy Rule and minimum necessary",
  summary: "When patient information may be used or shared, how to keep to the minimum needed, and the ERS 5-point send check.",
  estimatedMinutes: 13,
  tracks: ["full", "essentials", "refresher"],
  keyPoints: [
    "Using, disclosing and requesting information are three different actions.",
    "Use only the minimum information needed for the task.",
    "Access is by role: you see what your job needs, nothing more.",
    "Before you send: Who, What, Why, Where, How.",
    "Verify who is asking before you share anything.",
    "Anything beyond the permitted purposes needs the patient's written authorization, and the client decides that.",
    "HIPAA is the minimum: a stricter state law or client rule can apply as well.",
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
          type: "list",
          items: [
            "**Use**: working with information inside your organization to do your task.",
            "**Disclosure**: giving or showing information to someone outside, for example a vendor, a family member or another office.",
            "**Request**: asking another organization for patient information.",
          ],
        },
        { type: "paragraph", text: "Each one needs a valid reason, and each one must be limited to what is needed." },
      ],
    },
    {
      id: "tpo",
      title: "Treatment, payment and operations",
      blocks: [
        { type: "paragraph", text: "Covered entities may use and share information for **treatment**, **payment** and **healthcare operations** without asking the patient each time. Most of the work you do falls under these." },
        { type: "paragraph", text: "That permission belongs to the covered entity and is passed to ERS only through the BAA. It does not make everything fair game. You work within your client's specific instructions." },
        {
          type: "callout",
          tone: "warning",
          text: "Anything outside your task, such as marketing, a favor for a friend, research, or sharing with a family member, is a different question. Stop and ask.",
        },
      ],
    },
    {
      id: "authorization",
      title: "When the patient's written permission is needed",
      blocks: [
        { type: "paragraph", text: "For anything outside treatment, payment, healthcare operations and the other purposes the rule permits, the patient must give a **written authorization**: a signed form that says what may be shared, with whom, and why." },
        {
          type: "list",
          items: [
            "Marketing messages that use patient information",
            "Sharing information with an employer or an outside company for its own purposes",
            "Most uses of psychotherapy notes",
            "Selling patient information (generally not allowed without authorization)",
          ],
        },
        { type: "callout", tone: "warning", text: "You will never decide this yourself. Your client keeps the authorizations and decides. If a request is outside your task, route it to your lead or client contact." },
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
        { type: "paragraph", text: "There are a few exceptions, for example sharing for a patient's treatment between providers, giving the patient their own information, or disclosures the law requires." },
        { type: "callout", tone: "tip", text: "These exceptions are for your client to apply, not for you to decide. If you think one applies, ask your lead or client contact. Do not rely on your own reading." },
      ],
    },
    {
      id: "patient-rights",
      title: "When a patient asks for something",
      blocks: [
        { type: "paragraph", text: "Patients have rights over their own information. The client handles them, and you may be the first person who hears the request." },
        {
          type: "list",
          items: [
            "See or get a copy of their records",
            "Ask for a correction",
            "Get a list of certain disclosures",
            "Ask for limits on use or sharing, or for confidential communications",
            "Receive the clinic's notice of privacy practices, and complain",
          ],
        },
        { type: "paragraph", text: "**Your part:** do not answer or send anything yourself. Be kind, take down only the request, and pass it on the way your client instructs. The client has its own deadlines and checks." },
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
      id: "role-access",
      title: "Role-based access",
      blocks: [
        { type: "paragraph", text: "What you can see should match your job. If you find you can see more than you need, do not explore it. Tell your lead so the access can be corrected." },
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
      id: "identity",
      title: "Know who you are talking to",
      blocks: [
        { type: "paragraph", text: "Before you share anything, you must be sure the person is allowed to receive it. A friendly voice, an official-looking email or an urgent tone is not proof." },
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
  ],
};

export const q3: QuestionSeed[] = [
  q("privacy", "Use disclose request", "single", "Sending a patient's invoice to an outside collection agency is best described as:", ["A disclosure", "A use inside the organization", "A request", "A de-identification"], [0], "Giving information to someone outside the organization is a disclosure."),
  q("privacy", "Use disclose request", "single", "Asking another clinic to send you a patient's lab results is best described as:", ["A request", "A disclosure", "A use", "A breach"], [0], "Asking another organization for patient information is a request, and it also has to follow minimum necessary."),
  q("privacy", "Minimum necessary", "single", "A billing question needs the claim number and amount. What should you send?", ["Only the claim number and amount", "The full chart, so the other party has context", "The whole patient list", "A screenshot of the patient's record"], [0], "Minimum necessary means the smallest amount of information that answers the question."),
  q("privacy", "Minimum necessary", "true_false", "True or false: It is fine to send a patient's full chart for a simple scheduling question as long as you use a secure method.", ["True", "False"], [1], "A secure method does not change minimum necessary. Only the information needed for the scheduling should be shared."),
  q("privacy", "TPO", "single", "Which is the correct understanding of treatment, payment and operations for your work?", ["Your client may use information for these purposes and passes that permission to ERS through the agreement, within the client's instructions", "You may share any patient information with anyone for these purposes", "They apply only to doctors", "They allow you to use patient data for marketing"], [0], "The permission belongs to the covered entity and reaches ERS through the BAA, within the client's instructions."),
  q("privacy", "Role access", "single", "Your login can open records that are not part of your task. What is the right action?", ["Do not open them and tell your lead so access can be corrected", "Open them once to learn the system", "Use them if a teammate asks", "Keep quiet so nobody removes your access"], [0], "Extra access is not permission. Report it so it can be fixed."),
  q("privacy", "Verification", "single", "A caller says he is a patient's spouse and wants the appointment date. What is the right approach?", ["Follow your client's verification and sharing rules, and share nothing until the person is confirmed as allowed", "Share it, since spouses can usually know", "Share it if he sounds sure", "Ask him to prove it by reading the patient's address back"], [0], "Confirmed identity and permission come first. A confident voice is not proof."),
  q("privacy", "Five-point check", "single", "In the ERS 5-point send check, which question asks whether you are using the approved system or address?", ["Where?", "Who?", "What?", "Why?"], [0], "\"Where?\" is about the destination: the approved system or address."),
  q("privacy", "Five-point check", "multiple", "Which of these are part of the ERS 5-point send check? Select all that apply.", ["Who is the recipient", "What is the minimum information needed", "Why is it being sent", "How popular the patient is"], [0, 1, 2], "The five points are Who, What, Why, Where and How. Popularity is not part of it."),
  q("privacy", "Authorization", "single", "A marketing company asks your client for a list of its patients so it can send them advertisements. What is generally needed first?", ["The patients' written authorization", "Nothing, because the list is only names", "A verbal okay from the receptionist", "A note from an ERS manager"], [0], "Using patient information for marketing generally requires the patient's written authorization. It is not a treatment, payment or operations purpose."),
  q("privacy", "Patient rights", "single", "A patient calls and asks for a copy of their medical records. What should you do?", ["Do not send anything yourself; take the request the way your client instructs and pass it to the client contact", "Email the records right away", "Read the records to them over the phone", "Tell them they are not allowed to have them"], [0], "Patients have a right of access, and the client handles it with its own checks and deadlines. Your part is to pass the request on correctly."),
  q("privacy", "Patient rights", "multiple", "Which of these are rights patients have over their information? Select all that apply.", ["To see or get a copy of their records", "To ask for a correction", "To get a list of certain disclosures", "To choose which ERS team member opens their file"], [0, 1, 2], "Access, amendment and an accounting of disclosures are patient rights. Patients do not choose who works on a file."),
  q("privacy", "State laws", "single", "A state law gives patients more privacy protection than HIPAA for a certain kind of record. What does that mean for your work?", ["The stricter protection can apply as well, so follow your client's instructions and ask when a request looks unusual", "HIPAA always overrides it, so you can ignore it", "Only the state law matters and your client's rules do not", "It only applies to paper records"], [0], "HIPAA is a federal floor. A state law that gives greater privacy protection is generally not overridden by HIPAA, so the stricter rule applies."),
  q("privacy", "Mindset", "scenario", "A friend who is a nurse messages you: \"My neighbor went to your client's clinic. Can you check if her results are in?\" What do you do?", ["Decline, do not look, and carry on with your assigned tasks", "Look quickly and give a vague answer", "Look and tell her only that results are in", "Ask the neighbor's name and check later"], [0], "Looking for a personal reason is a violation and disclosing even a vague answer is a disclosure."),
];
