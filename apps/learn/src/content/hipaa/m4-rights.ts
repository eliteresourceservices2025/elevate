import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 4 (new in version 2): patients' rights over their information, and what a VA does when one asks. Grounded in 45 CFR
// 164.520 (notice), 164.522 (restrictions and confidential communications), 164.524 (access), 164.526 (amendment), 164.528
// (accounting) and 164.502(g) (personal representatives). Deadlines are described as "up to 30 days" and "up to 60 days" as the
// rule states them; the client decides every request. All people and details are invented. Counsel reviews this.

export const m4: CourseModule = {
  key: "rights",
  title: "Patients' rights over their information",
  summary: "The rights HIPAA gives patients: notice, access, amendment, accounting of disclosures, restrictions, confidential communications and complaints, and what you do when one is raised.",
  estimatedMinutes: 15,
  tracks: ["full"],
  keyPoints: [
    "Patients have rights to see, copy, correct and learn about disclosures of their own information.",
    "Every right has a deadline and a procedure, and the covered entity (your client) handles each request.",
    "The notice of privacy practices tells patients what the clinic does with their information and what their rights are.",
    "A personal representative stands in the patient's place, but who counts as one is the client's decision.",
    "Patients may complain to the clinic or to HHS, and cannot be punished for it.",
    "Your part: be kind, take down only the request, and pass it on the way your client instructs.",
  ],
  screens: [
    {
      id: "why-rights",
      title: "Why patients have rights",
      blocks: [
        { type: "paragraph", text: "The information in a patient's record is about them. The Privacy Rule therefore gives patients rights over it: to see it, to correct it, to know who it was shared with, and to ask for it to be handled differently." },
        { type: "paragraph", text: "These rights are against the **covered entity**, your client. Often a patient does not know that. They call the number they have, and the person who answers may be you." },
        { type: "callout", tone: "info", text: "You do not grant or refuse any right. You make sure the request reaches the people who do, quickly and without spreading the patient's information." },
      ],
    },
    {
      id: "rights-overview",
      title: "The rights at a glance",
      blocks: [
        {
          type: "table",
          columns: ["Right", "What the patient can ask for"],
          rows: [
            ["Notice", "A plain-language statement of how the clinic uses their information and what their rights are"],
            ["Access", "To see and get a copy of their own records"],
            ["Amendment", "To ask for a correction to information they believe is wrong"],
            ["Accounting of disclosures", "A list of certain times their information was shared"],
            ["Restriction", "To ask the clinic to limit how it uses or shares information"],
            ["Confidential communications", "To be contacted by a different method or at a different place"],
            ["Complaint", "To raise a concern with the clinic or with HHS"],
          ],
        },
      ],
    },
    {
      id: "notice",
      title: "The notice of privacy practices",
      blocks: [
        { type: "paragraph", text: "Most providers must give patients a **notice of privacy practices** (NPP) at their first service, post it where patients can see it, and put it on their website if they have one. It explains how the clinic may use and share information, what rights the patient has, and who to contact." },
        {
          type: "list",
          items: [
            "It is the clinic's document, not ERS's. You do not rewrite or reinterpret it.",
            "If a patient asks for a copy, give them the client's version through the client's approved way.",
            "If the website is one of your tasks, the notice must stay available there.",
          ],
        },
        { type: "callout", tone: "tip", text: "When a patient asks \"what do you do with my information?\", the honest answer is \"the clinic's notice explains it\". Point them to it." },
      ],
    },
    {
      id: "access",
      title: "The right of access",
      blocks: [
        { type: "paragraph", text: "Patients have the right to see and get a copy of the information in their **designated record set**: medical and billing records, and other records the clinic uses to make decisions about them. The clinic generally must respond **within 30 days**, with one 30-day extension if it explains why in writing." },
        {
          type: "layers",
          title: "What the patient can expect",
          items: [
            { label: "A copy", text: "In the form they ask for, if the clinic can readily produce it that way, including electronic form." },
            { label: "A reasonable fee", text: "Limited to the cost of copying, supplies and postage, and any summary the patient agreed to." },
            { label: "Sent to someone else", text: "The patient can direct the copy to another person they name in writing." },
            { label: "A written reason if refused", text: "Only specific grounds allow a refusal, and some can be reviewed." },
          ],
        },
        { type: "callout", tone: "warning", text: "Never send records to someone because they say the patient asked. The client confirms the patient's identity and handles the request." },
      ],
    },
    {
      id: "drs",
      title: "What is in the designated record set",
      blocks: [
        { type: "paragraph", text: "The **designated record set** is the group of records the clinic uses to make decisions about a patient. It is broader than the medical chart." },
        {
          type: "compare",
          left: { title: "In the set", items: ["Medical records", "Billing records and claims", "Enrollment and payment records for a health plan", "Records used to make decisions about the patient"] },
          right: { title: "Not open to the right of access", items: ["Psychotherapy notes", "Information compiled for use in a legal proceeding", "A few other narrow exclusions the client applies"] },
        },
      ],
    },
    {
      id: "amendment",
      title: "The right to ask for a correction",
      blocks: [
        { type: "paragraph", text: "A patient who believes information in their record is wrong or incomplete may ask in writing for it to be **amended**. The clinic must act within 60 days, with one 30-day extension." },
        {
          type: "compare",
          left: { title: "The clinic may deny when the information", items: ["Was not created by the clinic", "Is not part of the designated record set", "Is not available for the patient to inspect", "Is already accurate and complete"] },
          right: { title: "The patient can then", items: ["Submit a written statement of disagreement", "Ask that the request and the denial become part of their record", "File a complaint with the clinic or HHS"] },
        },
        { type: "callout", tone: "info", text: "You never change a clinical or billing record because a patient says it is wrong. Take the request, and pass it to the client." },
      ],
    },
    {
      id: "accounting",
      title: "The right to an accounting of disclosures",
      blocks: [
        { type: "paragraph", text: "A patient may ask for a list of certain disclosures of their information made in the **six years** before the request. The clinic must respond within 60 days, with one 30-day extension, and one request in a year is free." },
        {
          type: "paragraph",
          text: "The list does not include everything. Disclosures for treatment, payment and operations, to the patient themselves, under an authorization and a few others are left out. What it does include are the kinds of sharing a patient would not expect, like some legal and public-health disclosures.",
        },
        { type: "callout", tone: "tip", text: "This is one reason clients keep a record of unusual disclosures, and one reason you never share anything outside the approved way: a disclosure nobody recorded can still be asked about." },
      ],
    },
    {
      id: "restrictions",
      title: "The right to ask for a restriction",
      blocks: [
        { type: "paragraph", text: "A patient can ask a clinic to limit how it uses or shares their information, for example not to share a visit with a particular family member. The clinic does not have to agree, but if it does, it must follow the agreement." },
        { type: "callout", tone: "warning", title: "One firm exception", text: "If a patient pays for a service in full out of their own pocket and asks that it not be shared with their health plan, the clinic must honor that for payment and operations purposes, unless the law requires otherwise." },
        { type: "paragraph", text: "If a restriction has been agreed, the client will tell you how it affects your task. Follow it exactly." },
      ],
    },
    {
      id: "confidential-communications",
      title: "Confidential communications",
      blocks: [
        { type: "paragraph", text: "A patient may ask to be contacted in a particular way or at a particular place: for example, only by mobile phone, not the home landline, or by mail to a different address. Providers must accommodate **reasonable** requests, and cannot require a reason." },
        {
          type: "case",
          title: "The mailing address",
          scenario: "You send monthly statements for a clinic. A patient calls and says her husband opens her mail, and asks that statements go to her workplace address instead. The record shows a request had been taken, but the address in your mailing list is unchanged.",
          question: "What should happen before the next statement is sent?",
          answer: "The statement must not go to the old address. The request is a confidential-communication request, and the clinic must accommodate it if reasonable. Do not guess: ask your lead or client contact to confirm the request is on file and whether the address has been updated, and hold that patient's statement until they confirm.",
        },
      ],
    },
    {
      id: "personal-representatives",
      title: "Personal representatives",
      blocks: [
        { type: "paragraph", text: "A **personal representative** is a person the law allows to act for the patient in health care matters, for example a parent for a young child, a guardian, or someone with a health care power of attorney. In general, the clinic treats them as the patient for those matters." },
        {
          type: "list",
          items: [
            "Who counts is decided by state law and the client's records, not by what a caller claims.",
            "Being a relative, a spouse or a friend is not enough by itself.",
            "There are exceptions, for example where a minor may consent to their own care or where there is concern about abuse.",
          ],
        },
        { type: "callout", tone: "tip", text: "The question to ask the client is not \"is she the mother?\" but \"is she on file as the patient's personal representative?\"" },
      ],
    },
    {
      id: "complaints",
      title: "Complaints, and no retaliation",
      blocks: [
        { type: "paragraph", text: "A patient who thinks their rights were not respected may complain to the clinic or to HHS's Office for Civil Rights, generally within 180 days of when they knew about the problem. Clinics must have a process for it, and a contact person." },
        {
          type: "list",
          items: [
            "A clinic may not retaliate against anyone for filing a complaint or taking part in an investigation.",
            "A patient cannot be asked to give up these rights as a condition of care.",
            "Treat a complaint like any request: be kind, take down only the facts, and pass it on.",
          ],
        },
      ],
    },
    {
      id: "what-you-do",
      title: "What you do when a patient asks",
      blocks: [
        { type: "paragraph", text: "The same steps work for every right:" },
        {
          type: "steps",
          items: [
            { title: "Listen and thank them", text: "Be kind. Do not say yes, no or \"that is not allowed\"." },
            { title: "Take down only the request", text: "What they want, how to reach them, and the date. No clinical detail." },
            { title: "Do not act yourself", text: "Do not send records, change records or make promises." },
            { title: "Pass it on the client's way", text: "Use the client's form, line or contact, the same day." },
            { title: "Tell the patient what happens next", text: "That the clinic will respond, and roughly when, if the client has said so." },
          ],
        },
      ],
    },
    {
      id: "scenario-records-request",
      title: "Try it: the records request",
      blocks: [
        {
          type: "scenario",
          title: "A caller wants her records",
          prompt: "A woman calls the clinic's line. She says she is a patient and wants a copy of her records for a new doctor. She sounds impatient and says the clinic always takes too long.",
          choices: [
            { text: "Tell her you will email her chart right away to make up for the delay.", feedback: "You cannot verify her identity or release records. The client handles access requests.", best: false },
            { text: "Thank her, take her request and contact details, tell her the clinic will respond, and pass it to the client's records contact the same day.", feedback: "Correct. This respects her right and keeps the information with the people who can release it.", best: true },
            { text: "Tell her the clinic does not give out records over the phone and end the call.", feedback: "Patients do have a right of access. The answer is to route the request, not to refuse it.", best: false },
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
            { term: "Notice of privacy practices", meaning: "The clinic's statement of how it uses information and what rights patients have." },
            { term: "Designated record set", meaning: "The records a clinic uses to make decisions about a patient, including medical and billing records." },
            { term: "Amendment", meaning: "A correction to a patient's record, requested by the patient." },
            { term: "Accounting of disclosures", meaning: "A list of certain disclosures of a patient's information, going back six years." },
            { term: "Restriction", meaning: "A limit on use or sharing that a patient requests, binding if the clinic agrees." },
            { term: "Personal representative", meaning: "A person the law allows to act for the patient in health care matters." },
          ],
        },
      ],
    },
  ],
};

export const q4: QuestionSeed[] = [
  q("rights", "Rights overview", "multiple", "Which of these are rights HIPAA gives patients over their information? Select all that apply.", ["To see and get a copy of their records", "To ask for a correction", "To receive a list of certain disclosures", "To decide which clinic employees are hired"], [0, 1, 2], "Access, amendment and an accounting of disclosures are patient rights. Hiring decisions are not."),
  q("rights", "Who handles", "single", "A patient asks for a copy of her records. Who decides how and when the request is answered?", ["The covered entity, your client", "The first VA who takes the call", "The patient's friend", "Any vendor the clinic uses"], [0], "Patient rights are exercised against the covered entity, which handles the request through its own procedure."),
  q("rights", "Notice", "single", "What is the notice of privacy practices?", ["The clinic's statement of how it uses patient information and what rights patients have", "A flyer about parking", "A list of doctors on staff", "A bill sent to patients"], [0], "The NPP explains the clinic's information practices and patients' rights."),
  q("rights", "Notice", "true_false", "True or false: A VA who maintains a clinic's website should ensure the clinic's notice of privacy practices remains available there if the client asks.", ["True", "False"], [0], "Providers with a website must post their notice there, so keeping it available is part of the client's compliance."),
  q("rights", "Access", "single", "Within what time does a clinic generally have to respond to a patient's request for access to their records?", ["30 days, with one possible 30-day extension if it explains why in writing", "24 hours", "One year", "Whenever it is convenient"], [0], "The access rule allows up to 30 days, with one 30-day extension in writing."),
  q("rights", "Access", "single", "A patient asks for their records in electronic form. If the clinic keeps them electronically and can produce that form, what should happen?", ["The clinic should provide the electronic copy in the form requested", "The clinic must refuse and mail paper", "The clinic may refuse every time", "The clinic must call the patient's employer"], [0], "Patients can get an electronic copy in the form and format requested if the record is kept electronically and readily producible that way."),
  q("rights", "Access", "single", "A patient asks that a copy of their records be sent to a new specialist they name in writing. This is:", ["Within the right of access, since the patient can direct the copy to someone else", "Not allowed under any circumstances", "Only allowed with a court order", "Only allowed if the specialist is a family member"], [0], "The patient can direct the copy to a third party they identify in writing."),
  q("rights", "Designated record set", "single", "Which of these is part of the designated record set?", ["Billing and claims records used to make decisions about the patient", "The clinic's staff holiday calendar", "A vendor's price list", "A news article about the clinic"], [0], "The designated record set includes medical and billing records and others used to make decisions about the patient."),
  q("rights", "Amendment", "single", "A patient says her phone number is wrong in the record. What does the VA do?", ["Take the request and pass it to the client, who decides and updates the record", "Update it immediately without checking", "Tell her only the doctor can change anything", "Ignore it because phone numbers are not important"], [0], "The covered entity handles amendment requests. A VA does not change records on someone's say-so."),
  q("rights", "Amendment", "true_false", "True or false: A clinic must always accept a patient's request to change something in their record.", ["True", "False"], [1], "The clinic can deny a request on specific grounds, such as that the record is already accurate and complete, and the patient may then file a statement of disagreement."),
  q("rights", "Amendment", "single", "A clinic denies a patient's amendment request because the record is accurate. What can the patient do?", ["Submit a written statement of disagreement", "Nothing", "Change the record themselves", "Ask the VA to change it quietly"], [0], "The patient may submit a statement of disagreement, which becomes part of the record."),
  q("rights", "Accounting", "single", "How far back can a patient ask for an accounting of disclosures?", ["Six years before the request", "One week", "Thirty days", "Ten years"], [0], "An accounting covers disclosures made in the six years before the request."),
  q("rights", "Accounting", "single", "Which of these is generally NOT listed in an accounting of disclosures?", ["Disclosures for treatment, payment and operations", "A disclosure ordered by a court", "A public-health report of a disease", "A disclosure made in error"], [0], "Treatment, payment and operations disclosures are left out of an accounting, while many unusual disclosures are included."),
  q("rights", "Restrictions", "single", "A patient pays for a visit in full out of pocket and asks that it not be sent to their health plan. What generally applies?", ["The clinic must honor the request for payment and operations purposes", "The clinic can ignore it", "The VA decides", "The request is only valid for family members"], [0], "When a patient pays in full out of pocket and asks, the provider must not disclose that item or service to the health plan for payment or operations."),
  q("rights", "Restrictions", "true_false", "True or false: A clinic must agree to every restriction a patient asks for.", ["True", "False"], [1], "A clinic need not agree to most restriction requests, but must follow the ones it does agree to."),
  q("rights", "Confidential communications", "single", "A patient asks to be contacted only on her mobile phone and not at home. This is:", ["A request for confidential communications, which providers must accommodate if reasonable", "An unreasonable request that should be refused", "A request only the patient's doctor can decide", "A marketing opt-out"], [0], "Providers must accommodate reasonable requests for confidential communications and cannot require an explanation."),
  q("rights", "Personal representative", "single", "A caller says she is the patient's aunt and wants to see the patient's chart. What is the right approach?", ["Do not share, and ask the client whether she is on file as a personal representative", "Share, since she is family", "Share only the diagnosis", "Share if she knows the date of birth"], [0], "Family relationship alone does not make someone a personal representative. The client's records and state law decide."),
  q("rights", "Complaints", "single", "A patient is unhappy about how their information was handled. Who may they complain to?", ["The clinic, or the HHS Office for Civil Rights", "Only the VA who handled it", "Only a local newspaper", "Nobody"], [0], "Patients may complain to the clinic or to OCR."),
  q("rights", "Complaints", "true_false", "True or false: A clinic may refuse care to a patient who files a privacy complaint.", ["True", "False"], [1], "HIPAA prohibits retaliation against people who file complaints or take part in investigations."),
  q("rights", "What you do", "single", "A patient tells you she wants to know who her information has been shared with. What is your best response?", ["Thank her, take down the request, and pass it to the client the same day", "Tell her you will check the logs yourself and call back", "Tell her that information is secret", "Give her a list from memory"], [0], "An accounting of disclosures is the clinic's process. You take the request and route it."),
  q("rights", "What you do", "multiple", "A patient raises a privacy right on a call. Which of these should you do? Select all that apply.", ["Be kind and take down the request and contact details", "Pass it on to the client the same day", "Make a promise about the outcome", "Avoid writing clinical details in the note"], [0, 1, 3], "Take the request, route it, and keep notes minimal. Do not promise an outcome that is the client's decision."),
  q("rights", "Notice", "single", "A patient asks what a clinic does with their information. What is the most accurate and helpful reply?", ["Point them to the clinic's notice of privacy practices and offer a copy through the client's process", "Tell them the clinic never shares anything", "Tell them it is none of their business", "Describe it from memory"], [0], "The notice is the authoritative statement of the clinic's practices."),
];
