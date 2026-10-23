import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 8 (new in version 2): how HIPAA is enforced, the penalty tiers, generic case studies, and the other laws that sit beside
// HIPAA. Grounded in HHS's enforcement pages, 45 CFR 160.404 (civil money penalty tiers), the HITECH Act (state attorneys general),
// 42 U.S.C. 1320d-6 (criminal) and the ONC guide, chapter 7. Dollar amounts are deliberately not stated: they are adjusted every
// year. Cases are generic and invented in their details; no organization is named. Counsel reviews this before it is published.

export const m8: CourseModule = {
  key: "enforcement",
  title: "Enforcement, penalties and real-world cases",
  summary: "How a complaint becomes an investigation, what the civil and criminal penalty tiers mean, three generic cases that show how problems actually arise, and the other laws that sit beside HIPAA.",
  estimatedMinutes: 12,
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
      id: "what-went-wrong",
      title: "Match: what went wrong, in which case?",
      blocks: [
        { type: "paragraph", text: "You have read three cases. Each detail below belongs to one of them. Sort the details, one card at a time." },
        {
          type: "cards",
          title: "Which case is it?",
          prompt: "Which case does this detail belong to?",
          groups: ["The curious employee", "The stolen laptop", "The testimonial"],
          cards: [
            { text: "Records opened with no work reason", group: 0, feedback: "That is the curious employee: access without a reason is an impermissible use." },
            { text: "An audit of the access logs found it months later", group: 0, feedback: "Access logs record every look, and an audit surfaced it." },
            { text: "No security risk analysis could be shown", group: 1, feedback: "That is the stolen laptop case: OCR asked for the risk analysis and there was none." },
            { text: "An unencrypted laptop was stolen from a car", group: 1, feedback: "The theft started the case, and the missing safeguards made it grow." },
            { text: "Patients said yes in person, with no signed form", group: 2, feedback: "That is the testimonial: a spoken yes is not a written authorization." },
            { text: "The clinic removed the content and took corrective steps", group: 2, feedback: "The clinic had to take the posts down and fix its process." },
          ],
        },
      ],
    },
    {
      id: "tier-ladder",
      title: "Climb the penalty ladder",
      blocks: [
        { type: "paragraph", text: "The civil tiers rise with what the organization knew and what it did next. Put them in order, from the least to the most serious." },
        {
          type: "sort",
          title: "Order the civil tiers",
          prompt: "Arrange the tiers from least serious to most serious.",
          items: ["Tier 1: did not know", "Tier 2: reasonable cause", "Tier 3: willful neglect, corrected", "Tier 4: willful neglect, not corrected"],
          explanation: "The tiers move from not knowing, to should have known, to willful neglect that was fixed, to willful neglect that was not fixed. Fixing quickly moves a violation toward a lower tier.",
        },
        {
          type: "flip",
          title: "Criminal penalties in three cards",
          cards: [
            { front: "Knowingly obtaining or disclosing health information", back: "Up to 1 year in prison." },
            { front: "The same, under false pretenses", back: "Up to 5 years in prison." },
            { front: "Intent to sell, or for gain or malicious harm", back: "Up to 10 years in prison." },
          ],
        },
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
      id: "keys-to-success",
      title: "Keys to success: what keeps you out of trouble",
      blocks: [
        { type: "paragraph", text: "Look back at the three cases. In each one, the trouble came from an ordinary gap, not a villain. Three habits close most of those gaps." },
        {
          type: "flip",
          title: "Three keys",
          cards: [
            { front: "Education", back: "Everyone who touches patient information knows the rules and why they exist. That is what this course is for." },
            { front: "Commitment", back: "Leads and teammates take the rules seriously every day, not only after a problem." },
            { front: "Culture", back: "Asking and reporting are normal and welcome, so small slips are fixed the same day." },
          ],
        },
        {
          type: "cards",
          title: "Leads to trouble, or helps?",
          prompt: "Does this lead to trouble in an investigation, or help the organization?",
          groups: ["Leads to trouble", "Helps"],
          cards: [
            { text: "No risk analysis on file", group: 0, feedback: "A missing risk analysis turned a theft into a compliance case." },
            { text: "An unencrypted laptop and no policy for portable devices", group: 0, feedback: "That is the safeguard gap OCR found in the laptop case." },
            { text: "Posting a patient's story with no signed authorization", group: 0, feedback: "A spoken yes is not enough. The signed form makes it allowed." },
            { text: "Deleting old logs", group: 0, feedback: "Destroying records makes things much worse." },
            { text: "Documented training and a risk analysis", group: 1, feedback: "Evidence of good faith is what carries weight." },
            { text: "Reporting a problem the same day and fixing it", group: 1, feedback: "Quick reporting and a quick fix can move a violation toward a lower tier." },
          ],
        },
      ],
    },
    {
      id: "quick-round",
      title: "Quick round: enforcement",
      blocks: [
        {
          type: "game",
          title: "Enforcement sprint",
          seconds: 20,
          rounds: [
            {
              question: "Who investigates most HIPAA complaints and breach reports?",
              options: [
                { text: "HHS Office for Civil Rights", correct: true, feedback: "Yes. The Department of Justice handles criminal cases." },
                { text: "The Postal Service", correct: false, feedback: "OCR handles civil enforcement." },
                { text: "A local school board", correct: false, feedback: "OCR handles civil enforcement." },
              ],
            },
            {
              question: "An employee opens records out of curiosity and tells no one. What is it?",
              options: [
                { text: "A violation that access logs can reveal later", correct: true, feedback: "Access is not permission, and every look is logged." },
                { text: "Fine, since nothing was shared", correct: false, feedback: "Opening records without a work reason is an impermissible use." },
                { text: "Fine, since she works there", correct: false, feedback: "Working there does not make every record yours to open." },
              ],
            },
            {
              question: "Which civil tier is the most serious?",
              options: [
                { text: "Willful neglect, not corrected", correct: true, feedback: "Conscious disregard that is not fixed within 30 days." },
                { text: "Did not know", correct: false, feedback: "That is the least serious tier." },
                { text: "Reasonable cause", correct: false, feedback: "That is the second tier." },
              ],
            },
            {
              question: "What is the highest prison term in the HIPAA criminal provisions?",
              options: [
                { text: "10 years, for gain or malicious harm", correct: true, feedback: "The tiers are 1, 5 and 10 years." },
                { text: "30 days", correct: false, feedback: "The terms are measured in years." },
                { text: "There is none", correct: false, feedback: "Knowing misuse can be prosecuted." },
              ],
            },
            {
              question: "A patient said yes in person to a photo on the clinic's website. What is missing?",
              options: [
                { text: "A signed authorization", correct: true, feedback: "A written authorization is what makes the use allowed." },
                { text: "A bigger photo", correct: false, feedback: "Size is not the issue." },
                { text: "A caption", correct: false, feedback: "A caption does not change the need for a signed form." },
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
  q("enforcement", "Case: testimonial", "single", "In the testimonial case, which question from the person who maintained the website would have caught the problem?", ["Is there a signed authorization on file for each of these?", "Are the photos bright enough?", "Do the stories fit on one page?", "Has anyone shared the page yet?"], [0], "The person who maintains the site is well placed to ask whether each patient's signed authorization is on file."),
  q("enforcement", "Case: risk analysis", "multiple", "Which of these were missing in the stolen laptop case? Select all that apply.", ["A documented security risk analysis", "Encryption on the laptop", "A policy covering portable devices", "A police report"], [0, 1, 2], "The practice could not show a risk analysis, the laptop was unencrypted and no policy covered portable devices."),
  q("enforcement", "Case: snooping", "single", "In the curious employee case, how were the unneeded looks found?", ["An audit of the access logs, months later", "The employee confessed at once", "A patient noticed them on screen", "They were never found"], [0], "Access logs recorded each look, and an audit surfaced them."),
  q("enforcement", "Good faith", "true_false", "True or false: Deleting old access logs before an investigation helps an organization.", ["True", "False"], [1], "Destroying records makes things much worse. Evidence of good faith is what helps."),
];
