import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 2: PHI, ePHI and identifiers. Invented examples only.

export const m2: CourseModule = {
  key: "phi",
  title: "PHI, ePHI and identifiers",
  summary: "How to recognize protected health information in any form, including the small details that identify a person.",
  estimatedMinutes: 10,
  tracks: ["full", "essentials", "refresher"],
  keyPoints: [
    "PHI is health information that can identify a person, in any form: screen, paper, spoken or electronic.",
    "A name is only one identifier. Dates, numbers, contacts, images and device details can identify someone too.",
    "Context matters: ordinary details become PHI when they are tied to healthcare.",
    "Screenshots, exports and copies carry the same protection as the original.",
    "Removing a name does not make information anonymous.",
  ],
  screens: [
    {
      id: "what-is-phi",
      title: "What is PHI?",
      blocks: [
        { type: "paragraph", text: "**PHI** means protected health information. It is information about a person's health, their healthcare, or payment for healthcare, that identifies them or could be used to identify them." },
        {
          type: "list",
          items: [
            "Health: a diagnosis, a symptom, a test result, a medication.",
            "Healthcare: an appointment, a visit, a referral, a procedure.",
            "Payment: a bill, an insurance claim, a balance owed.",
          ],
        },
        { type: "callout", tone: "info", text: "PHI can be on a screen, on paper, in a phone call, or in a conversation. The form does not change the protection." },
      ],
    },
    {
      id: "ephi",
      title: "ePHI: electronic PHI",
      blocks: [
        { type: "paragraph", text: "**ePHI** is PHI that is created, stored, sent or received electronically: an EHR record, an email, a spreadsheet, a scan, a chat message, a screenshot, a voicemail file." },
        { type: "paragraph", text: "The HIPAA Security Rule is about ePHI. Most of your work will touch ePHI, which is why the safeguards in the next modules matter every day." },
        {
          type: "check",
          question: "A PDF of a patient's lab results saved on a computer is:",
          options: [
            { text: "ePHI", correct: true, feedback: "Right. It is health information that identifies a person, stored electronically." },
            { text: "Not protected because it is a file", correct: false, feedback: "Files are exactly where ePHI lives." },
          ],
        },
      ],
    },
    {
      id: "identifiers",
      title: "What identifies a person",
      blocks: [
        { type: "paragraph", text: "HIPAA lists 18 kinds of identifiers. You do not need to memorize a list. Learn the five families:" },
        {
          type: "list",
          items: [
            "**Identity**: name, photo of a face, biometric prints.",
            "**Contact and place**: address, city, ZIP code, phone, fax, email.",
            "**Dates and ages**: birth date, admission or discharge date, appointment date, age over 89.",
            "**Numbers**: Social Security number, medical record number, insurance or account number, license numbers.",
            "**Digital and device**: IP address, website address, device serial numbers, vehicle plate numbers.",
          ],
        },
      ],
    },
    {
      id: "context",
      title: "Context changes the answer",
      blocks: [
        { type: "paragraph", text: "A first name on its own is not much. The same name in a clinic's appointment list is PHI." },
        {
          type: "compare",
          left: { title: "By itself", items: ["\"Maria\"", "A phone number on a business card", "\"Tuesday 2 PM\""] },
          right: { title: "With healthcare context", items: ["\"Maria, cardiology follow-up\"", "A phone number in a patient's chart", "\"Tuesday 2 PM, Dr. Reyes, oncology\""] },
        },
        { type: "callout", tone: "tip", text: "Ask yourself: could this tell someone who a patient is, or something about their health or care? If yes, treat it as PHI." },
      ],
    },
    {
      id: "everywhere",
      title: "PHI is not only in the EHR",
      blocks: [
        { type: "paragraph", text: "Patient information turns up in places people forget:" },
        {
          type: "list",
          items: [
            "Emails and chat messages with a patient's name in the subject or body",
            "Scheduling and billing spreadsheets",
            "Screenshots sent \"just to show the problem\"",
            "Sticky notes, printouts and notebooks on a desk",
            "Voicemail, call recordings and what you say aloud at home",
            "File names such as \"Lopez_MRI_results.pdf\"",
          ],
        },
        { type: "callout", tone: "warning", text: "Screenshots and copies inherit the sensitivity of what is in them. A screenshot of a chart is PHI." },
      ],
    },
    {
      id: "deidentified",
      title: "Removing a name is not enough",
      blocks: [
        { type: "paragraph", text: "Information is only free of HIPAA rules when it is properly **de-identified**: either all 18 identifier types are removed, or an expert formally confirms the risk of identifying anyone is very small." },
        { type: "paragraph", text: "Deleting the name column from a spreadsheet does not do that. A birth date, a ZIP code and a rare diagnosis can still point to one person." },
        { type: "callout", tone: "warning", text: "Never decide on your own that data is anonymous. Ask your lead or client before treating any patient-related data as safe to share." },
      ],
    },
    {
      id: "scenario-screenshot",
      title: "Try it: the screenshot",
      blocks: [
        {
          type: "scenario",
          title: "A helpful screenshot",
          prompt: "A software tool is acting up while you work in a client's system. You want help from a friend who is good with computers. A screenshot would show the problem clearly, and it contains a patient's name and diagnosis.",
          choices: [
            { text: "Send the full screenshot privately to your friend.", feedback: "That sends PHI to someone who is not authorized to see it.", best: false },
            { text: "Describe the problem in words, with no patient details, or report it to your lead or the client's support.", feedback: "Correct. Get help through approved channels and keep PHI out of it.", best: true },
            { text: "Blur the name and send the rest.", feedback: "The diagnosis and other details can still identify the person. Do not send it.", best: false },
          ],
        },
      ],
    },
    {
      id: "spoken-paper",
      title: "Spoken and paper PHI",
      blocks: [
        { type: "paragraph", text: "PHI does not stop being PHI when it is not on a screen. Calls, voice notes, printouts and conversations all count." },
        {
          type: "list",
          items: [
            "Take calls where others cannot hear patient details.",
            "Do not leave notes with patient information in view.",
            "Do not print unless your client's rules allow it, and never leave printouts lying around.",
            "Do not discuss patients with family, friends or on social media, even without names.",
          ],
        },
      ],
    },
    {
      id: "quick-check",
      title: "Quick recognition",
      blocks: [
        {
          type: "check",
          question: "Which of these is PHI? Select all that apply.",
          multiple: true,
          options: [
            { text: "A spreadsheet row with a patient's name and balance owed", correct: true, feedback: "Name plus payment information: PHI." },
            { text: "A voicemail from a patient asking to reschedule a dermatology visit", correct: true, feedback: "A person's voice, their care and their request: PHI." },
            { text: "A blank appointment form template with no patient data", correct: false, feedback: "No individual is identified, so it is not PHI." },
            { text: "A screenshot of a patient's insurance card", correct: true, feedback: "An insurance number identifies the person: PHI." },
          ],
        },
      ],
    },
  ],
};

export const q2: QuestionSeed[] = [
  q("phi", "What is PHI", "single", "Which best describes protected health information (PHI)?", ["Health, care or payment information that identifies a person or could be used to identify them", "Any information about a company", "Only information typed into an EHR", "Only diagnoses"], [0], "PHI covers health, healthcare and payment information that can be tied to an individual, in any form."),
  q("phi", "ePHI", "single", "Which of these is ePHI?", ["A spreadsheet with patient names and appointment dates", "A printed brochure about flu shots", "A blank intake form", "A public holiday calendar"], [0], "ePHI is PHI held or sent electronically. A spreadsheet with patient names and appointments is ePHI."),
  q("phi", "Identifiers", "multiple", "Which of these can identify a person and are treated as identifiers under HIPAA? Select all that apply.", ["Medical record number", "Email address", "A full-face photograph", "The weather on the day of a visit"], [0, 1, 2], "Record numbers, email addresses and full-face photos are identifiers. The weather identifies no one."),
  q("phi", "Identifiers", "single", "Which date is an identifier tied to a patient?", ["Date of birth", "The date HIPAA was passed", "The date a new software release shipped", "Today's date on a blank form"], [0], "Dates directly related to an individual, such as birth, admission or discharge dates, are identifiers."),
  q("phi", "Context", "single", "A note on your screen reads \"Elena, 3 PM Thursday\". When is it PHI?", ["When it refers to a patient's appointment at a healthcare provider", "Never, because it has no last name", "Only when it is on paper", "Only when it is emailed"], [0], "Context turns ordinary details into PHI: a name plus a healthcare appointment can identify a patient and their care."),
  q("phi", "Screenshots", "single", "You need help with a software problem and have a screenshot that shows patient details. What should you do?", ["Report the problem without patient details, using the approved channel", "Post it in a public forum with the name blurred", "Send it to a friend who knows the software", "Text it to yourself to look at later"], [0], "Screenshots carry the same protection as the original. Seek help through approved channels with no PHI in it."),
  q("phi", "De-identification", "single", "A teammate deletes the name column from a patient spreadsheet and says the data is now anonymous. What is the best response?", ["The remaining dates, ZIP codes and rare diagnoses can still identify people, so check with your lead before treating it as anonymous", "Agree, since the name is the only identifier", "Agree if the file is small", "Agree, as long as it is shared by email"], [0], "De-identification means removing all 18 identifier types or an expert determination. Removing a name alone is not enough."),
  q("phi", "Everywhere", "true_false", "True or false: PHI is protected only while it is in the client's EHR system.", ["True", "False"], [1], "PHI is protected in any form and location: emails, chats, files, paper, screenshots and conversations."),
  q("phi", "File names", "single", "Which file name is the safest to use for a file attached to an email?", ["Invoice batch 2026-10", "Lopez, Maria - MRI results", "Smith diabetes follow-up", "Birth date 1984 patient list"], [0], "File names can reveal PHI by themselves. Use neutral names that contain no patient details."),
  q("phi", "Spoken PHI", "single", "You take a patient call at home while family members are nearby. What is the best practice?", ["Move to a private space or use a headset so others cannot hear the details", "Put the call on speaker for clarity", "Repeat the patient's details aloud to confirm", "Continue the call in a shared kitchen"], [0], "Spoken PHI is PHI. Take calls where others cannot overhear."),
];
