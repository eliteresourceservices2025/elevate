import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 10 (new in version 2): scenario lab for billing, insurance and records work. Every person, clinic and detail is invented.
// Grounded in the Privacy Rule's payment definition and minimum necessary standard (45 CFR 164.501, 164.502(b)), the
// Security Rule's transmission and device controls, and the contract rules for business associates. Counsel reviews this.

export const m10: CourseModule = {
  key: "lab_records",
  title: "Lab: billing, insurance and records work",
  summary: "Practice the rules on billing, insurance verification, collections, faxing, chart preparation and exports.",
  estimatedMinutes: 8,
  tracks: ["full"],
  keyPoints: [
    "Payment work is permitted, but only for the minimum information the step needs.",
    "A collection agency or billing vendor is a business associate and needs an agreement.",
    "Faxes, exports and shared screens carry patient information and need the same checks as email.",
    "Every extra copy, spreadsheet or export is a new place for information to leak.",
    "Check the number, the recipient and the file before you send or share.",
  ],
  screens: [
    {
      id: "intro",
      title: "How this lab works",
      blocks: [
        { type: "paragraph", text: "These exercises come from billing, insurance and records work. They are harder than the last lab, because here the information is exactly what the job needs, and the risk is in what you do with it next." },
        { type: "callout", tone: "tip", text: "For each exercise ask: what is the minimum, where does this copy go, and who exactly will receive it?" },
      ],
    },
    {
      id: "scenario-eligibility",
      title: "Scenario 1: the eligibility check",
      blocks: [
        {
          type: "scenario",
          title: "A payer asks for more",
          prompt: "You call a patient's insurer to verify coverage before an appointment. The representative asks you to also describe the patient's diagnosis and the planned procedure \"to confirm benefits\". Your task is only to check eligibility.",
          choices: [
            { text: "Give the diagnosis and procedure, since the insurer is a health plan.", feedback: "Payment is permitted, but only the minimum for the step. Your task did not require it.", best: false },
            { text: "Give only what the eligibility check needs, and ask your lead or the client if the insurer insists on more.", feedback: "Correct. Payment is allowed but limited to the minimum necessary.", best: true },
            { text: "Hang up and mark the check as failed.", feedback: "You can finish the check with the minimum. Hanging up leaves the task undone.", best: false },
          ],
        },
      ],
    },
    {
      id: "case-collections",
      title: "Worked case: the collection agency",
      blocks: [
        {
          type: "case",
          title: "Sending overdue balances out",
          scenario: "A clinic's office manager asks you to send a spreadsheet of overdue patient balances to a collection agency she found online. The sheet has names, addresses, dates of birth, balances and the procedure name for each account. She says it is fine because it is a payment matter.",
          question: "Is it fine, and what changes before anything is sent?",
          answer: "Collections are part of payment, so the purpose can be permitted, but two things are missing. First, the agency is a business associate and must have a signed agreement with the clinic before receiving any information. Second, minimum necessary applies: the procedure name is rarely needed, and the sheet should hold only what the agency requires. Raise both with the client, and do not send until there is an agreement and a trimmed file.",
        },
      ],
    },
    {
      id: "scenario-fax",
      title: "Scenario 2: the fax number",
      blocks: [
        {
          type: "scenario",
          title: "A prior authorization by fax",
          prompt: "You need to fax a prior authorization form with a patient's details to a payer. The number on the form is smudged, and a similar number appears in a previous email from a different insurer.",
          choices: [
            { text: "Guess from the similar number and send it.", feedback: "A wrong number sends patient information to a stranger.", best: false },
            { text: "Confirm the number from a reliable source, send a cover sheet only first if the client's process allows, and ask for confirmation of receipt.", feedback: "Correct. Check the destination before the information leaves.", best: true },
            { text: "Email the form to the insurer's general address instead.", feedback: "That changes to an unapproved channel without confirming the destination.", best: false },
          ],
        },
      ],
    },
    {
      id: "scenario-export",
      title: "Scenario 3: the export for the client",
      blocks: [
        {
          type: "scenario",
          title: "A spreadsheet of everyone",
          prompt: "A clinic manager asks for a list of all patients with an unpaid balance, to review during a video call. The billing system can export every field. You are about to export all columns so you will not have to do it again.",
          choices: [
            { text: "Export every field and send it. It saves time.", feedback: "That breaks minimum necessary and creates a large file that can leak.", best: false },
            { text: "Export only the columns the review needs, send it through the approved channel, and delete your working copy as the client instructs.", feedback: "Correct. Limit the columns, use the approved channel and do not keep copies.", best: true },
            { text: "Export everything but send it in two emails.", feedback: "Splitting the message does not reduce the information shared.", best: false },
          ],
        },
      ],
    },
    {
      id: "case-screen-share",
      title: "Worked case: the shared screen",
      blocks: [
        {
          type: "case",
          title: "Helping a colleague on a video call",
          scenario: "You are on a video call with a clinic colleague and a billing consultant the clinic does not use regularly. To explain a posting error, the colleague shares her screen with the open patient ledger, including names and balances, and the consultant has not signed anything.",
          question: "What should happen, and what should you do?",
          answer: "The consultant may be an outside party with no agreement, so the screen share may be an impermissible disclosure. Ask politely to stop sharing, and suggest using a sample record with fake data. Then tell your lead what happened and what was visible. The client decides whether it is an incident that needs assessment.",
        },
      ],
    },
    {
      id: "scenario-transcription",
      title: "Scenario 4: the helpful tool",
      blocks: [
        {
          type: "scenario",
          title: "A faster way to transcribe",
          prompt: "You are given dictated clinic notes to type up. A free browser tool turns audio into text in seconds. The client's approved transcription tool is slow and expensive to scale.",
          choices: [
            { text: "Use the free tool for the long files only.", feedback: "Any file would still go to an unapproved company, and length does not change that.", best: false },
            { text: "Use only the approved tool, and raise the speed problem with your lead so the client can decide on an alternative.", feedback: "Correct. The client decides what tool is approved, and it must be under an agreement.", best: true },
            { text: "Use the free tool after removing the patient's name from the audio.", feedback: "Voices and content can identify a person, and the tool is still unapproved.", best: false },
          ],
        },
      ],
    },
    {
      id: "checklist",
      title: "Before you send, share or export",
      blocks: [
        {
          type: "steps",
          items: [
            { title: "Recipient", text: "Who exactly, and is there an agreement or a verified authority?" },
            { title: "Destination", text: "Is the fax number, address or system confirmed from a reliable source?" },
            { title: "Content", text: "Only the fields and records the step needs." },
            { title: "Channel", text: "The approved portal, secure email or system." },
            { title: "Copies", text: "No extra copies kept, and the working file removed as instructed." },
          ],
        },
      ],
    },
    {
      id: "readiness",
      title: "Check yourself",
      blocks: [
        {
          type: "check",
          question: "You prepare a patient's chart for a new specialist. Which action is the best practice?",
          options: [
            { text: "Send only the sections the specialist's request names, through the approved channel", correct: true, feedback: "Right. A treatment disclosure is allowed, and it goes by the approved route with only what is requested." },
            { text: "Send the entire chart to avoid a second request", correct: false, feedback: "Minimum necessary points the other way, and the request names what is needed." },
            { text: "Send it to the specialist's personal email so it arrives faster", correct: false, feedback: "Speed does not make an unapproved channel acceptable." },
          ],
        },
      ],
    },
  ],
};

export const q10: QuestionSeed[] = [
  q("lab_records", "Payment", "single", "Which of these is part of 'payment' under HIPAA?", ["Billing, claims management and collection activities", "A newsletter about a new doctor", "Posting patient stories online", "Selling patient lists"], [0], "Payment includes billing, claims, eligibility checks and collection activities."),
  q("lab_records", "Payment", "single", "You verify a patient's coverage with an insurer. The representative asks for the patient's diagnosis, which you do not need for the check. What do you do?", ["Give only the minimum the check needs, and ask your lead if the insurer insists", "Give the diagnosis, since the insurer is a health plan", "Hang up", "Give the diagnosis and the treatment plan"], [0], "Payment is permitted but limited to the minimum necessary for the step."),
  q("lab_records", "Collections", "single", "A clinic wants to send overdue balances to a collection agency. What must be true before information is shared?", ["The agency has a business associate agreement with the clinic, and only the minimum is sent", "The agency has a nice website", "The balances are small", "The agency is in the same city"], [0], "A collection agency handling patient information is a business associate and needs an agreement. Minimum necessary also applies."),
  q("lab_records", "Collections", "multiple", "Which fields might a collection agency need from a clinic's overdue account? Select all that apply.", ["The patient's name and address", "The amount owed and account number", "The details of the procedure and diagnosis in full", "The patient's favorite music"], [0, 1], "Collections need identifying and balance information. Diagnosis and procedure detail is rarely needed and exceeds minimum necessary."),
  q("lab_records", "Fax", "single", "You are about to fax a form with patient information. The fax number is unclear. What do you do?", ["Confirm the number from a reliable source before sending", "Guess from a similar number", "Send to every number that might be right", "Send it by personal email instead"], [0], "A wrong destination sends information to a stranger. Confirm first."),
  q("lab_records", "Fax", "true_false", "True or false: A fax is not covered by HIPAA because it is not electronic.", ["True", "False"], [1], "Information on a fax is PHI, and the same minimum necessary and destination checks apply."),
  q("lab_records", "Exports", "single", "A billing system can export every field, and a review needs only name, account number and balance. What should you export?", ["Only the three fields the review needs", "Every field, to save time", "Every field, but split into two files", "Every field with the names replaced by initials"], [0], "Minimum necessary applies to exports. Fewer columns mean less to leak."),
  q("lab_records", "Exports", "single", "After sending an export through the approved channel, what should you do with your working copy?", ["Remove it as the client instructs and do not keep extra copies", "Keep it in a personal folder in case it is needed again", "Email it to yourself", "Rename it so it is harder to find"], [0], "Every extra copy is another place for information to leak. Follow the client's retention instructions."),
  q("lab_records", "Screen sharing", "single", "A colleague shares a screen with an open patient ledger on a call that includes someone with no agreement. What should you do?", ["Ask to stop sharing, and tell your lead what was visible", "Say nothing", "Screenshot it for later", "Share your own screen too"], [0], "A disclosure to an outside party may have occurred. Stop it and report."),
  q("lab_records", "Transcription", "single", "A free online tool can transcribe clinic audio quickly. What is the right choice?", ["Use only the approved tool, and raise the speed problem with your lead", "Use the free tool for long files", "Use the free tool if the audio has no names", "Use the free tool on weekends"], [0], "Only tools under an agreement and approved by the client may receive patient information."),
  q("lab_records", "Chart prep", "single", "A new specialist requests only a patient's recent lab results. What should you send?", ["The lab results the request names, through the approved channel", "The whole chart", "Everything from the last five years", "A photo of the chart"], [0], "A treatment disclosure is allowed. The request defines the information needed."),
  q("lab_records", "Chart prep", "true_false", "True or false: Minimum necessary does not apply when a provider requests information for the patient's treatment.", ["True", "False"], [0], "The minimum necessary standard does not apply to disclosures to a provider for treatment, though the client still sends through approved channels."),
  q("lab_records", "Records requests", "single", "A patient's attorney emails asking for a copy of the patient's chart and says the patient agrees. What do you do?", ["Route it to the client's records contact without sending anything", "Send the chart, since an attorney asked", "Send only the discharge summary", "Ask the attorney to call the patient"], [0], "Records requests are handled by the client, who verifies authority and authorization."),
  q("lab_records", "Records requests", "single", "A staff member wants a report of patients with a particular diagnosis for a mailing about a new service. What is the concern?", ["It may be marketing using PHI and needs the client's review and possibly authorization", "The report is too long", "The diagnosis is hard to spell", "Nothing, because it is the clinic's own list"], [0], "Using diagnosis information to market a service can require authorization and review by the client."),
  q("lab_records", "Copies", "multiple", "Which of these create extra copies of patient information that you should avoid? Select all that apply.", ["Saving an export to a personal folder", "Emailing a file to yourself", "Taking a photo of a screen", "Working in the client's system"], [0, 1, 2], "Working in the client's system keeps information in place. The others create copies outside it."),
  q("lab_records", "Email", "single", "You need to email a billing question about a patient. What is the best way to identify the patient?", ["Use the minimum identifier the client's policy allows, such as an account number", "Use the full name, date of birth and diagnosis", "Use only the patient's nickname", "Attach the full chart"], [0], "Use the least identifying information that answers the question, as the client's policy directs."),
  q("lab_records", "Scribing", "single", "While scribing for a clinician, you hear details about a patient who is a friend of yours. What do you do?", ["Complete the task and tell no one, and do not look at anything beyond it", "Mention it to the friend", "Look up the friend's other records", "Post a hint to a group chat"], [0], "Use information only for the task, and never disclose or look further because you know the person."),
  q("lab_records", "Checklist", "multiple", "Which questions belong in a check before you send, share or export patient information? Select all that apply.", ["Who exactly receives it?", "Is the destination confirmed?", "Is it only the minimum?", "How many pages is it?"], [0, 1, 2], "Recipient, destination and minimum are the checks. Page count is not."),
];
