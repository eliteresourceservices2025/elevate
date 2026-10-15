import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 2: PHI, ePHI and identifiers. Version 2 (deeper). Grounded in 45 CFR 160.103 (definitions) and 164.514 (de-identification
// and the 18 identifiers). All people and details in examples are invented. Counsel reviews this before it is published.

export const m2: CourseModule = {
  key: "phi",
  title: "PHI, ePHI and identifiers",
  summary: "What makes information protected health information, the 18 identifiers, how information can be de-identified, and what HIPAA does not treat as PHI.",
  estimatedMinutes: 12,
  tracks: ["full", "essentials", "refresher"],
  keyPoints: [
    "PHI is health information that identifies a person, held or sent by a covered entity or business associate, in any form.",
    "ePHI is PHI in electronic form: databases, email, files, screenshots, voicemails and recordings.",
    "Names are only one of eighteen kinds of identifier, and context can identify a person without one.",
    "Taking off a name does not de-identify information; HIPAA has two specific methods.",
    "Some records are not PHI, such as an employer's employment records, but they can still need protection.",
    "Spoken and paper information is PHI too.",
  ],
  screens: [
    {
      id: "what-is-phi",
      title: "What is PHI?",
      blocks: [
        { type: "paragraph", text: "**Protected health information (PHI)** is health information that identifies a person, or could reasonably be used to identify them, when it is held or sent by a covered entity or a business associate." },
        { type: "paragraph", text: "Think of it as three parts that come together: it is **about a person**, it is about their **health, their care or the payment for their care**, and it **identifies them**. Take away any one part and it may no longer be PHI." },
        { type: "callout", tone: "tip", text: "Health information means more than diagnoses. A sign-in sheet that shows who visited a clinic, an invoice, and a reminder call about an appointment all say something about a person's health care." },
      ],
    },
    {
      id: "health-info",
      title: "What counts as health information",
      blocks: [
        { type: "paragraph", text: "HIPAA's definition covers information that relates to any of three things:" },
        {
          type: "list",
          items: [
            "The person's past, present or future **physical or mental health or condition**",
            "The **care** provided to the person",
            "The past, present or future **payment** for that care",
          ],
        },
        { type: "paragraph", text: "That is why a billing record counts as much as a chart. If it says who a person is and connects them to care or payment for it, it is PHI." },
      ],
    },
    {
      id: "ephi",
      title: "ePHI: electronic PHI",
      blocks: [
        { type: "paragraph", text: "**ePHI** is PHI in electronic form. The Security Rule applies to it." },
        {
          type: "list",
          items: [
            "Records in an EHR, a billing system or a spreadsheet",
            "Email, chat messages and text messages",
            "Scanned documents, photos and screenshots",
            "Voicemail, call recordings and video calls",
            "Anything stored on a laptop, phone or drive",
          ],
        },
        { type: "callout", tone: "info", text: "The same fact can be PHI in three forms at once: on the screen, in a printout, and spoken aloud. The protection follows the information, not the format." },
      ],
    },
    {
      id: "identifiers-1",
      title: "What identifies a person (1 of 2)",
      blocks: [
        { type: "paragraph", text: "HIPAA lists **eighteen identifiers**. If health information carries any of them, it points to a person. The first nine:" },
        {
          type: "table",
          caption: "Identifiers 1 to 9",
          columns: ["Identifier", "Plain-language note"],
          rows: [
            ["Names", "Full or partial, including a nickname that points to one person"],
            ["Small geographic areas", "Street address, city, county, ZIP code: anything smaller than a state"],
            ["Dates tied to the person", "Birth, admission, discharge, death and any other date linked to them; ages over 89"],
            ["Telephone numbers", "Mobile, home and office"],
            ["Fax numbers", "Often forgotten: faxes are common in healthcare"],
            ["Email addresses", "Personal or work"],
            ["Social security numbers", "Full or any part used to identify"],
            ["Medical record numbers", "Chart and patient ID numbers"],
            ["Health plan beneficiary numbers", "Member and policy IDs"],
          ],
        },
      ],
    },
    {
      id: "identifiers-2",
      title: "What identifies a person (2 of 2)",
      blocks: [
        { type: "paragraph", text: "The other nine, which people forget most often. The list applies to the identifiers of the person and also to those of their relatives, employers and household members:" },
        {
          type: "table",
          caption: "Identifiers 10 to 18",
          columns: ["Identifier", "Plain-language note"],
          rows: [
            ["Account numbers", "Billing and payment accounts"],
            ["Certificate or license numbers", "Professional or driver's license numbers"],
            ["Vehicle identifiers", "License plates and vehicle serial numbers"],
            ["Device identifiers and serial numbers", "A medical device's unique number"],
            ["Web addresses (URLs)", "A link that leads to a person's own page or record"],
            ["IP addresses", "The address of the computer used"],
            ["Biometric identifiers", "Fingerprints and voice prints"],
            ["Full-face photographs", "And comparable images that show the face"],
            ["Any other unique number, code or characteristic", "A catch-all for anything that identifies one person"],
          ],
        },
      ],
    },
    {
      id: "context",
      title: "Context changes the answer",
      blocks: [
        { type: "paragraph", text: "A name is not the only way to point at a person. A rare diagnosis in a small town, a job title at a small company, or a unique combination of age, ZIP code and visit date can identify someone without any name at all." },
        {
          type: "case",
          title: "The unnamed patient",
          scenario: "A team member posts in a public group: \"A 91-year-old woman in our small town was admitted yesterday after her fall at the bakery. I handled her insurance claim.\" No name is given.",
          question: "Is this PHI, and is the post a problem?",
          answer: "Yes. It describes a person's care and payment, and in a small town the age, the event and the place make her easy to identify. Removing the name does not make it safe. Posting it is an impermissible disclosure, and it should be reported to your lead and HR.",
        },
      ],
    },
    {
      id: "deidentification",
      title: "Removing a name is not enough",
      blocks: [
        { type: "paragraph", text: "Information is **de-identified** only when there is no reasonable way to tell who it is about. HIPAA recognizes exactly two methods, and neither is \"I took the name out.\"" },
        {
          type: "compare",
          left: { title: "Safe Harbor", items: ["Remove all 18 identifiers", "The organization has no actual knowledge that what is left could identify someone"] },
          right: { title: "Expert Determination", items: ["A qualified statistician studies the data", "They document that the risk of identifying anyone is very small"] },
        },
        { type: "callout", tone: "warning", text: "De-identifying is the client's decision and process. A VA does not de-identify information on their own and send it onward as \"safe.\"" },
      ],
    },
    {
      id: "not-phi",
      title: "What is not PHI",
      blocks: [
        { type: "paragraph", text: "HIPAA's definition has deliberate exclusions. These are not PHI under HIPAA:" },
        {
          type: "list",
          items: [
            "Employment records that a covered entity holds in its role as an employer",
            "Education records covered by a different federal law (FERPA)",
            "Information that has been properly de-identified",
            "Records of a person who has been dead for more than 50 years",
          ],
        },
        { type: "callout", tone: "tip", title: "Careful", text: "Not being PHI does not mean not sensitive. An employer's sick-leave note is not PHI, but your client still expects it to be protected, and other laws may apply." },
      ],
    },
    {
      id: "everywhere",
      title: "PHI is not only in the EHR",
      blocks: [
        { type: "paragraph", text: "People expect PHI in the chart. It is just as often in the places around the chart, and that is where mistakes happen:" },
        {
          type: "list",
          items: [
            "A screenshot someone saves \"to remember how to do it\"",
            "A file name that includes a patient's name",
            "An email subject line or a calendar invite",
            "A sticky note, a notebook or a printed schedule",
            "A voicemail greeting or a call you take in a shared space",
          ],
        },
      ],
    },
    {
      id: "scenario-screenshot",
      title: "Try it: the screenshot",
      blocks: [
        {
          type: "scenario",
          title: "A question for the group chat",
          prompt: "You are stuck on a field in the client's billing system. You take a screenshot of your screen, which shows a patient's name, date of birth and balance, and want to ask a teammate in a group chat how to fill it in.",
          choices: [
            { text: "Post the screenshot but crop out the name.", feedback: "The date of birth and balance still identify a person, and the chat may not be approved for PHI.", best: false },
            { text: "Describe the field in words without any patient details, or ask through the client's approved channel.", feedback: "Correct. You can get the answer without sending any PHI.", best: true },
            { text: "Post it in a private chat with one teammate instead.", feedback: "A smaller audience is still a disclosure through an unapproved channel.", best: false },
          ],
        },
      ],
    },
    {
      id: "spoken-paper",
      title: "Spoken and paper PHI",
      blocks: [
        { type: "paragraph", text: "The rules do not stop at the screen. Information you hear on a call, read on paper or see on a whiteboard is PHI, and you protect it the same way." },
        {
          type: "list",
          items: [
            "Keep your voice down on calls, and take them where others cannot hear.",
            "Do not leave paper out. Put it away or destroy it the approved way.",
            "Do not describe a patient to friends or family, even without a name.",
            "Do not read details aloud in a shared or public space.",
          ],
        },
      ],
    },
    {
      id: "recognition",
      title: "Quick recognition",
      blocks: [
        {
          type: "check",
          question: "Which of these is PHI when it is held by ERS for a clinic?",
          multiple: true,
          options: [
            { text: "A list of appointment dates with patient initials and phone numbers", correct: true, feedback: "Initials plus a phone number and appointment dates identify patients and say they receive care." },
            { text: "A spreadsheet of invoice numbers and balances with patient account numbers", correct: true, feedback: "An account number is an identifier and the balance relates to payment for care." },
            { text: "A count of how many appointments the clinic had this month, with no names or dates", correct: false, feedback: "A bare count does not identify anyone, so it is not PHI." },
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
            { term: "PHI", meaning: "Protected health information: health information that identifies a person, held or sent by a covered entity or business associate." },
            { term: "ePHI", meaning: "PHI in electronic form, such as files, email, messages and recordings." },
            { term: "Identifier", meaning: "A piece of information that points to one person. HIPAA lists eighteen." },
            { term: "De-identified", meaning: "Information that cannot reasonably be used to identify a person, by one of HIPAA's two methods." },
            { term: "Safe Harbor", meaning: "The method of removing all 18 identifiers, with no knowledge that what is left could identify someone." },
            { term: "Expert Determination", meaning: "The method where a qualified expert documents that the risk of identification is very small." },
          ],
        },
      ],
    },
  ],
};

export const q2: QuestionSeed[] = [
  q("phi", "What is PHI", "single", "Which description best fits protected health information (PHI)?", ["Health information that identifies a person, held or sent by a covered entity or business associate", "Any information about the weather", "Only a diagnosis written by a doctor", "Only information stored in a hospital's computer"], [0], "PHI is individually identifiable health information about care, condition or payment, in any form, held by a covered entity or business associate."),
  q("phi", "What is PHI", "single", "Which of these is health information under HIPAA's definition?", ["An invoice showing a patient's balance for a visit", "A clinic's holiday schedule", "A public news story about a new hospital", "A vendor's price list"], [0], "Information relating to payment for a person's care is health information, and with an identifier it is PHI."),
  q("phi", "What is PHI", "multiple", "A record is PHI when it has which of these? Select all that apply.", ["It is about a person's health, care or payment for care", "It identifies, or could reasonably identify, the person", "It is held or sent by a covered entity or business associate", "It is written in a language other than English"], [0, 1, 2], "PHI is identifiable health information held by a covered entity or business associate. The language does not matter."),
  q("phi", "ePHI", "multiple", "Which of these can be ePHI? Select all that apply.", ["A voicemail left by a patient", "A screenshot of a billing screen", "An email that names a patient", "A blank form with no patient information"], [0, 1, 2], "ePHI is PHI in electronic form: recordings, screenshots and emails count. A blank form holds no patient information."),
  q("phi", "ePHI", "true_false", "True or false: A screenshot of a patient's record is not PHI because it is a picture.", ["True", "False"], [1], "A screenshot carries the same patient information as the screen, so it is PHI and ePHI."),
  q("phi", "Identifiers", "multiple", "Which of these are among HIPAA's 18 identifiers? Select all that apply.", ["A telephone number", "A medical record number", "A full-face photograph", "A favorite color"], [0, 1, 2], "Telephone numbers, medical record numbers and full-face photographs are all identifiers. A favorite color is not."),
  q("phi", "Identifiers", "single", "Which of these is an identifier even though it is not a name or a number?", ["A full-face photograph", "The weather on the day of the visit", "The name of the clinic's building", "The clinic's opening hours"], [0], "Full-face photographs and comparable images are one of the 18 identifiers."),
  q("phi", "Identifiers", "single", "Which kind of date is an identifier when it is tied to a patient?", ["A date of birth, admission or discharge", "The date a vendor sent an invoice to the clinic", "A public holiday", "The date of a software update"], [0], "Dates directly related to the individual, such as birth, admission and discharge, are identifiers."),
  q("phi", "Identifiers", "single", "A report lists a patient's IP address from an online appointment form together with their appointment type. Is the IP address an identifier?", ["Yes, IP addresses are one of the 18 identifiers", "No, only names count", "No, because it is a number", "Only if the patient used a mobile phone"], [0], "IP addresses, like web addresses, are on HIPAA's list of identifiers."),
  q("phi", "Context", "single", "A post describes a patient's rare condition and the small town where they live, but gives no name. What is the most accurate description?", ["It may still identify the person, so it is likely PHI", "It is safe because no name was used", "It is safe because the town is small", "It is safe because the post was short"], [0], "Context can identify a person without a name. Rare facts plus a small place often point to one individual."),
  q("phi", "De-identification", "single", "Which of these can make information de-identified under HIPAA?", ["Removing all 18 identifiers with no knowledge that the rest could identify anyone, or an expert's documented determination", "Removing the patient's name and leaving everything else", "Changing the patient's first name to initials", "Asking the recipient to promise not to look"], [0], "HIPAA recognizes two methods: Safe Harbor and Expert Determination."),
  q("phi", "De-identification", "true_false", "True or false: Replacing a patient's name with their initials de-identifies the record.", ["True", "False"], [1], "Initials are still identifying when combined with other details, and many other identifiers remain."),
  q("phi", "De-identification", "single", "Who decides how a client's information is de-identified?", ["The client, using one of HIPAA's two methods", "Any team member who thinks it looks anonymous", "The patient's neighbor", "The first person who opens the file"], [0], "De-identification is a client-controlled process. A VA does not decide that information is safe to send onward."),
  q("phi", "Not PHI", "single", "Which of these is NOT PHI under HIPAA's definition?", ["Employment records a covered entity holds in its role as an employer", "A patient's lab results", "A claim for a patient's surgery", "A patient's appointment reminder"], [0], "Employment records held by a covered entity as an employer are excluded from PHI, though they may still be protected by other laws."),
  q("phi", "Everywhere", "single", "A teammate saves screenshots of patient screens in a personal folder 'to remember how to do it'. What is the problem?", ["The screenshots are ePHI stored outside the approved system", "Screenshots are not PHI", "The folder name is too short", "There is no problem as long as the folder is private"], [0], "Screenshots of patient screens are ePHI. Saving them outside approved systems is an unapproved copy."),
  q("phi", "Everywhere", "single", "Which file name is the biggest problem?", ["Smith_John_DOB_1980_claim.pdf", "invoice_batch_12.pdf", "weekly_report.pdf", "template_v2.pdf"], [0], "A name plus a date of birth in a file name exposes identifiers to anyone who sees a file list."),
  q("phi", "Spoken and paper", "true_false", "True or false: Information you hear on a client call is protected only if you write it down.", ["True", "False"], [1], "PHI is protected in every form, including spoken. Overheard and remembered information is covered too."),
  q("phi", "Spoken and paper", "single", "You take a patient call at a shared table in a cafe. What is the best approach?", ["Move to a private place or reschedule, and keep your voice down", "Take the call and speak clearly so the patient can hear", "Put the call on speaker so you can type", "Write the patient's details on a napkin so you will remember"], [0], "Spoken PHI can be overheard. Choose a private place and avoid exposing details."),
];
