import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 8 (new in version 2): how HIPAA is enforced, the penalty tiers, generic case studies, and the other laws that sit beside
// HIPAA. Grounded in HHS's enforcement pages, 45 CFR 160.404 (civil money penalty tiers), the HITECH Act (state attorneys general),
// 42 U.S.C. 1320d-6 (criminal) and the ONC guide, chapter 7. Dollar amounts are deliberately not stated: they are adjusted every
// year. Cases are generic and invented in their details; no organization is named. Counsel reviews this before it is published.

export const m8: CourseModule = {
  key: "enforcement",
  title: "Enforcement, penalties and real-world cases",
  summary: "How a complaint becomes an investigation, what the civil and criminal penalty tiers mean, three generic cases that show how problems actually arise, and the other laws that sit beside HIPAA.",
  estimatedMinutes: 8,
  tracks: ["full"],
  keyPoints: [
    "OCR investigates complaints and reports, and can resolve them with guidance, an agreement or a penalty.",
    "Civil penalties follow four tiers, from not knowing to willful neglect that was not corrected.",
    "Knowingly misusing patient information is a crime, with more serious penalties for false pretenses and for gain or harm.",
    "State attorneys general can also enforce HIPAA, and states have their own laws.",
    "Real cases usually come from ordinary failures: no risk analysis, an unprotected device, an unapproved vendor.",
    "Other laws, such as rules for substance use disorder records, can add to HIPAA.",
  ],
  screens: [
    {
      id: "who-enforces",
      title: "Who enforces HIPAA",
      blocks: [
        { type: "paragraph", text: "Several bodies can act when HIPAA is not followed:" },
        {
          type: "table",
          columns: ["Who", "What they do"],
          rows: [
            ["HHS Office for Civil Rights (OCR)", "Investigates complaints and breach reports; resolves cases with guidance, agreements or penalties"],
            ["Department of Justice", "Prosecutes criminal violations"],
            ["State attorneys general", "Can bring civil actions on behalf of state residents"],
            ["The client and ERS", "Apply contract remedies and sanctions"],
          ],
        },
      ],
    },
    {
      id: "investigation",
      title: "How a complaint becomes a case",
      blocks: [
        {
          type: "steps",
          items: [
            { title: "A complaint or a report", text: "A patient, a worker or a breach report brings the matter to OCR." },
            { title: "Review", text: "OCR decides whether HIPAA applies and whether the facts show a possible violation." },
            { title: "Investigation", text: "OCR asks for policies, risk analyses, training records, logs and an explanation." },
            { title: "Resolution", text: "Guidance, a voluntary fix, a resolution agreement with a corrective plan and a payment, or a civil money penalty." },
          ],
        },
        { type: "callout", tone: "info", text: "Most cases end before a penalty. What helps is evidence of good faith: training records, a risk analysis, quick reporting and a fix." },
      ],
    },
    {
      id: "civil-tiers",
      title: "The four civil penalty tiers",
      blocks: [
        { type: "paragraph", text: "Civil penalties scale with how much the organization knew and what it did next. The dollar limits are adjusted for inflation each year, so this course describes the tiers, not the amounts." },
        {
          type: "layers",
          title: "From least to most serious",
          items: [
            { label: "Tier 1: did not know", text: "The organization did not know, and with reasonable diligence would not have known, of the violation." },
            { label: "Tier 2: reasonable cause", text: "A violation the organization should have known about, but not through willful neglect." },
            { label: "Tier 3: willful neglect, corrected", text: "Conscious disregard of the rules, fixed within 30 days of finding out." },
            { label: "Tier 4: willful neglect, not corrected", text: "Conscious disregard of the rules, and not fixed within 30 days." },
          ],
        },
        { type: "callout", tone: "tip", text: "Fixing a problem quickly moves a violation toward a lower tier. That is one more reason to report the same day." },
      ],
    },
    {
      id: "criminal",
      title: "Criminal penalties",
      blocks: [
        { type: "paragraph", text: "A person who **knowingly** obtains or discloses identifiable health information in violation of the rules can be prosecuted. The Department of Justice handles these cases, and the penalties rise with intent:" },
        {
          type: "table",
          columns: ["The conduct", "Maximum prison term"],
          rows: [
            ["Knowingly obtaining or disclosing health information", "1 year"],
            ["The same, under false pretenses", "5 years"],
            ["With intent to sell, transfer or use for commercial advantage, personal gain or malicious harm", "10 years"],
          ],
        },
        { type: "callout", tone: "warning", text: "These apply to individuals, not only organizations. Looking up information to sell it, to help a friend or to hurt someone is not a mistake: it is the conduct the law is aimed at." },
      ],
    },
    {
      id: "case-snooping",
      title: "Case one: the curious employee",
      blocks: [
        {
          type: "case",
          title: "Looking without a reason",
          scenario: "An employee at a large healthcare provider opened the records of several patients who were not part of her work, including a coworker and an acquaintance who had been in the news. Nobody was told and she did not share anything. An audit of the access logs found it months later.",
          question: "Was this a violation, even though she told no one and used no information?",
          answer: "Yes. Opening records without a work reason is an impermissible use. Access logs recorded each look, and an audit surfaced them. The consequences can include the employee's dismissal, a breach analysis by the organization, notification to the patients involved, and in cases involving intent or false pretenses, criminal exposure. The lesson is the first rule of this course: access is not permission.",
        },
      ],
    },
    {
      id: "case-risk-analysis",
      title: "Case two: the missing risk analysis",
      blocks: [
        {
          type: "case",
          title: "A stolen laptop, and what came after",
          scenario: "A small practice's unencrypted laptop, holding records for thousands of patients, was stolen from a car. During the investigation OCR asked for the practice's most recent security risk analysis. There was none, and no policy covered encryption or portable devices.",
          question: "What made this a case, and what would have changed the outcome?",
          answer: "The theft started it, but the case grew because the practice could not show a risk analysis or safeguards for portable devices. The resolution included a payment and a multi-year corrective plan. A documented risk analysis, encryption on the device and a clear policy would not have prevented the theft, but they would have prevented the breach and the finding that safeguards were absent.",
        },
      ],
    },
    {
      id: "case-testimonial",
      title: "Case three: the testimonial",
      blocks: [
        {
          type: "case",
          title: "A thank-you on the website",
          scenario: "A small clinic posted patient photos and short thank-you stories on its website and social pages. The patients were happy and had said yes in person, but no signed authorizations were on file. A patient later complained to OCR.",
          question: "Why was this a problem, and who would have caught it?",
          answer: "Using a patient's photo or story to promote the practice needs the patient's written authorization, and saying yes in person is not enough. The clinic had to remove the content and take corrective steps. The person who maintained the website was in the best position to ask: \"Is there a signed authorization on file for each of these?\"",
        },
      ],
    },
    {
      id: "state",
      title: "State laws sit beside HIPAA",
      blocks: [
        { type: "paragraph", text: "HIPAA is a federal floor. States can add to it with their own privacy, breach-notification and medical-records laws, and state attorneys general can enforce HIPAA itself. When a state law is more protective, the stricter rule applies." },
      ],
    },
    {
      id: "other-laws",
      title: "Other federal laws that touch the same information",
      blocks: [
        { type: "paragraph", text: "Some information sits under another law as well as HIPAA, or instead of it. You do not need the details. You need to know that the client's instructions already reflect them:" },
        {
          type: "table",
          columns: ["Law or rule", "What it adds"],
          rows: [
            ["Substance use disorder treatment records (42 CFR Part 2)", "Extra limits on sharing records from certain treatment programs"],
            ["Genetic Information Nondiscrimination Act (GINA)", "Limits on using genetic information in insurance and employment"],
            ["Family Educational Rights and Privacy Act (FERPA)", "Governs student education records, which are not PHI"],
            ["State laws", "Sensitive categories, minors, and breach notification"],
          ],
        },
        { type: "callout", tone: "tip", text: "If a record looks unusual or comes from a specialized program, stop and ask. The extra rule may change who may see it." },
      ],
    },
    {
      id: "check-enforcement",
      title: "Quick check",
      blocks: [
        {
          type: "check",
          question: "Which action by a clinic usually helps most when OCR investigates?",
          options: [
            { text: "Showing documented training, a risk analysis and quick reporting and fixing", correct: true, feedback: "Right. Evidence of good-faith compliance and prompt correction carries weight." },
            { text: "Saying nobody was hurt", correct: false, feedback: "Harm is not the test. The question is whether required safeguards and steps were in place." },
            { text: "Deleting old logs", correct: false, feedback: "Destroying records makes things much worse." },
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
            { term: "Resolution agreement", meaning: "A settlement with OCR that usually includes a payment and a corrective action plan." },
            { term: "Corrective action plan", meaning: "A set of steps, with monitoring, that an organization agrees to take to fix its compliance." },
            { term: "Willful neglect", meaning: "Conscious, intentional failure or reckless indifference to the duty to comply." },
            { term: "Civil money penalty", meaning: "A fine imposed by OCR on a covered entity or business associate." },
            { term: "State attorney general", meaning: "A state's chief legal officer, who can bring civil actions to enforce HIPAA." },
          ],
        },
      ],
    },
  ],
};

export const q8: QuestionSeed[] = [
  q("enforcement", "Who enforces", "single", "Which body handles civil enforcement of the HIPAA Privacy, Security and Breach Notification Rules?", ["HHS Office for Civil Rights", "The Federal Aviation Administration", "The Postal Service", "A local school board"], [0], "OCR investigates and resolves civil HIPAA cases, and the Department of Justice prosecutes criminal ones."),
  q("enforcement", "Who enforces", "multiple", "Which of these can enforce HIPAA or take action over violations? Select all that apply.", ["The HHS Office for Civil Rights", "State attorneys general", "The Department of Justice for criminal violations", "A patient's neighbor"], [0, 1, 2], "OCR, state attorneys general and the Department of Justice have enforcement roles. A neighbor does not."),
  q("enforcement", "Investigation", "single", "What does OCR typically ask for first when it investigates a covered entity or business associate?", ["Policies, risk analysis, training records and an explanation of what happened", "A list of the staff's personal phone numbers", "The clinic's advertising", "The patient's medical diagnosis"], [0], "OCR looks at whether required safeguards, training and documentation were in place."),
  q("enforcement", "Investigation", "single", "Which is NOT a typical way OCR resolves a case?", ["By closing the clinic's building immediately without any process", "Technical assistance and guidance", "A resolution agreement with a corrective action plan", "A civil money penalty"], [0], "Outcomes range from guidance to agreements to penalties, through a defined process."),
  q("enforcement", "Civil tiers", "single", "How are civil penalty tiers generally decided?", ["By how much the organization knew and whether it corrected the violation", "By the size of the patient's bill", "By the weather", "By the number of staff"], [0], "The tiers move from did not know, to reasonable cause, to willful neglect corrected, to willful neglect not corrected."),
  q("enforcement", "Civil tiers", "single", "Which description fits the most serious civil tier?", ["Willful neglect that was not corrected within 30 days", "A violation the organization did not know about", "A violation with reasonable cause", "A violation corrected immediately"], [0], "Willful neglect that is not corrected is the most serious tier."),
  q("enforcement", "Good faith", "single", "An organization finds a violation and fixes it within days, with documentation. What effect can this have?", ["It can move the violation toward a lower penalty tier", "It makes the violation worse", "It has no effect", "It means the patient must pay"], [0], "Prompt correction matters for how serious a violation is treated."),
  q("enforcement", "Criminal", "single", "What is the highest maximum prison term under the HIPAA criminal provisions?", ["10 years, for intent to sell, transfer or use information for commercial advantage, personal gain or malicious harm", "30 days", "6 months", "There is no prison term"], [0], "The tiers are 1 year, 5 years under false pretenses, and 10 years for gain or malicious harm."),
  q("enforcement", "Criminal", "true_false", "True or false: Criminal penalties under HIPAA can apply to an individual employee, not only to an organization.", ["True", "False"], [0], "Individuals who knowingly obtain or disclose information in violation of the rules can be prosecuted."),
  q("enforcement", "Case: snooping", "single", "An employee opens several patients' records out of curiosity and tells nobody. What is the best description?", ["An impermissible use, even though nothing was shared, and logs can reveal it later", "Not a problem if nothing was shared", "Allowed if she works there", "A problem only if the patients complain"], [0], "Looking without a work reason is a violation, and access logs record every look."),
  q("enforcement", "Case: risk analysis", "single", "After a laptop theft, what made OCR's case against a practice more serious?", ["It could not show a risk analysis or safeguards for portable devices", "The laptop was expensive", "The theft happened at night", "The practice had too few patients"], [0], "Missing documentation and safeguards turned a theft into a compliance case."),
  q("enforcement", "Case: testimonial", "single", "A patient said yes in person to a clinic posting their photo and story on its website. What is missing?", ["A signed authorization on file", "A better photo", "A longer caption", "A comment from a neighbor"], [0], "A written authorization is required to use a patient's photo or story for promotion."),
];
