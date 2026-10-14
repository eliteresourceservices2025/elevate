import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 7: privacy and security incidents, and breach notification. Version 2 (deeper). Grounded in 45 CFR 164.402 (breach,
// presumption, risk assessment, exceptions, unsecured PHI), 164.404 (notice to individuals), 164.406 (media), 164.408 (HHS),
// 164.410 (business associates), 164.530(g) and 160.316 (no retaliation). How to report inside ERS is described in plain terms
// (lead and HR, plus the client's own steps). All people and details are invented. Counsel reviews this before it is published.

export const m7: CourseModule = {
  key: "incidents",
  title: "Privacy and security incidents and breaches",
  summary: "What counts as an incident, how a breach is decided, who must be told and by when, and exactly what to do and not do when something goes wrong.",
  estimatedMinutes: 12,
  tracks: ["full", "essentials", "refresher"],
  keyPoints: [
    "An incident is anything that may have exposed patient information or weakened its protection.",
    "A breach is an impermissible use or disclosure that compromises PHI, and the law presumes it is one unless a risk assessment shows otherwise.",
    "The client and ERS decide whether an incident is a reportable breach, not the person who found it.",
    "Notification deadlines run from the day the incident is known, so report the same day.",
    "Do not investigate, fix quietly, delete evidence or contact the patient yourself.",
    "Good-faith reporting is protected, and nobody may retaliate against someone who files a complaint.",
  ],
  screens: [
    {
      id: "what",
      title: "What is an incident?",
      blocks: [
        { type: "paragraph", text: "An **incident** is anything that may have exposed, changed or blocked access to patient information, or that breaks a privacy or security rule." },
        {
          type: "list",
          items: [
            "A message with patient information sent to the wrong person",
            "A lost or stolen laptop or phone",
            "A clicked phishing link or a shared password",
            "Records opened without a work reason",
            "A system that locks up or shows data that is not yours",
          ],
        },
        { type: "callout", tone: "info", text: "You do not have to be sure it is serious. If you wonder whether it is an incident, report it." },
      ],
    },
    {
      id: "common-causes",
      title: "What usually goes wrong",
      blocks: [
        { type: "paragraph", text: "Most incidents are ordinary mistakes, not attacks. These come up again and again:" },
        {
          type: "list",
          items: [
            "Patient information sent or faxed to the wrong person",
            "A laptop, phone or drive lost or stolen",
            "Records opened without a work reason",
            "A shared or borrowed login",
            "Paper or old devices thrown away without being destroyed",
            "A phishing message, virus or other attack",
            "Missing training or missing agreements with vendors",
          ],
        },
      ],
    },
    {
      id: "breach-definition",
      title: "Incident and breach",
      blocks: [
        { type: "paragraph", text: "A **breach** is an **impermissible use or disclosure** of PHI that compromises its privacy or security. Not every incident is a breach, and that decision is not yours to make." },
        {
          type: "compare",
          left: { title: "Incident", items: ["Anything that may have exposed or weakened protection", "Reported by anyone, the same day", "Often turns out to be low risk"] },
          right: { title: "Breach", items: ["An impermissible use or disclosure that compromises PHI", "Decided by the client and ERS after an assessment", "Triggers notification duties"] },
        },
        { type: "callout", tone: "tip", text: "Your job is to report quickly and truthfully. Theirs is to assess and decide." },
      ],
    },
    {
      id: "presumption",
      title: "Presumed to be a breach",
      blocks: [
        { type: "paragraph", text: "The law starts from the opposite of what people expect. An impermissible use or disclosure is **presumed to be a breach** unless the organization shows, through a documented risk assessment, that there is a **low probability the information was compromised**." },
        { type: "paragraph", text: "The burden is on the organization. That is why a quick, accurate report matters: it gives them the facts to meet that burden." },
      ],
    },
    {
      id: "four-factors",
      title: "The four-factor risk assessment",
      blocks: [
        { type: "paragraph", text: "To decide whether information was compromised, the client and ERS assess at least four things:" },
        {
          type: "table",
          caption: "What the assessment considers",
          columns: ["Factor", "The question", "A reassuring answer"],
          rows: [
            ["The information", "How sensitive was it, and could it be tied to a person?", "A few non-identifying details"],
            ["The recipient", "Who got it or saw it?", "Another HIPAA-covered organization"],
            ["Acquired or viewed", "Was it actually opened or taken?", "Never opened"],
            ["Mitigation", "Has the risk been reduced?", "Deleted with written confirmation"],
          ],
        },
        { type: "callout", tone: "info", text: "You supply the facts for these four: what was sent, to whom, whether it was opened and what has been done. That is why your report should be factual and complete." },
      ],
    },
    {
      id: "exceptions",
      title: "Three situations that are not breaches",
      blocks: [
        { type: "paragraph", text: "The rule excludes three narrow situations from the definition of a breach:" },
        {
          type: "list",
          items: [
            "**Good-faith, unintentional access** by a workforce member, within their authority, with no further impermissible use.",
            "**Inadvertent sharing between two authorized people** at the same organization or arrangement, with no further impermissible use.",
            "**A good-faith belief that the recipient could not keep the information**, for example it was returned unopened.",
          ],
        },
        { type: "callout", tone: "warning", text: "These are for the client and ERS to apply. Never decide an exception applies and keep quiet. Report it, and let them decide." },
      ],
    },
    {
      id: "secured",
      title: "Secured and unsecured PHI",
      blocks: [
        { type: "paragraph", text: "The notification rules apply to **unsecured PHI**: information that has not been made unusable, unreadable or indecipherable to unauthorized people. The government's guidance recognizes two ways to secure it:" },
        {
          type: "compare",
          left: { title: "Encryption", items: ["Electronic data made unreadable without a key", "The key is not stored with the data", "Meets recognized standards"] },
          right: { title: "Destruction", items: ["Paper shredded or burned so it cannot be rebuilt", "Electronic media cleared, purged or destroyed", "Not just deleted or thrown away"] },
        },
        { type: "callout", tone: "tip", text: "A properly encrypted laptop that is stolen is generally not a reportable breach. But whether it was properly encrypted is for the client and ERS to confirm, never you. Report every loss." },
      ],
    },
    {
      id: "why-speed",
      title: "Who is told, and by when",
      blocks: [
        { type: "paragraph", text: "When a breach is confirmed, the covered entity has several notification duties, all with the same outer limit of **60 days** from discovery, and a duty to act without unreasonable delay within it." },
        {
          type: "timeline",
          title: "After a breach is found",
          items: [
            { when: "Day 0", text: "Anyone in the workforce knows, or with reasonable care would have known. The clock starts." },
            { when: "Right away", text: "ERS tells the client, often within days under the contract." },
            { when: "Within 60 days", text: "The client tells each affected person, in writing." },
            { when: "Within 60 days, 500 or more people", text: "The client also tells HHS and, for large breaches in one state, prominent media." },
            { when: "After the year ends", text: "Smaller breaches are reported to HHS within 60 days after the end of the calendar year." },
          ],
        },
      ],
    },
    {
      id: "what-notice-says",
      title: "What a notice to patients says",
      blocks: [
        { type: "paragraph", text: "A breach notice is written in plain language and includes: what happened and when it happened and was found; the types of information involved; what patients should do to protect themselves; what the organization is doing; and how to contact it." },
        { type: "callout", tone: "info", text: "It is written by the client, using the facts you and ERS gave. You never contact a patient about an incident yourself." },
      ],
    },
    {
      id: "what-to-do",
      title: "What to do",
      blocks: [
        {
          type: "steps",
          items: [
            { title: "Stop", text: "Stop what you are doing with the information. Do not try to undo it yourself." },
            { title: "Tell", text: "Report to your team lead and HR immediately, and follow your client's instructions." },
            { title: "Describe", text: "Say what happened, when, and which system. Leave out patient names and details." },
            { title: "Preserve", text: "Keep the message, file or device as it is. Do not delete anything." },
            { title: "Follow instructions", text: "Do what you are asked, and nothing more." },
          ],
        },
      ],
    },
    {
      id: "what-not",
      title: "What not to do",
      blocks: [
        {
          type: "compare",
          left: { title: "Do", items: ["Report right away", "Write facts only", "Keep evidence", "Cooperate fully"] },
          right: { title: "Do not", items: ["Wait and see", "Fix it quietly", "Delete or edit records", "Contact the patient or discuss it with others"] },
        },
        { type: "callout", tone: "warning", text: "Trying to hide a mistake is far more serious than the mistake. Honest and fast is always the right answer." },
      ],
    },
    {
      id: "case-misdirected",
      title: "Worked case: the right name, the wrong address",
      blocks: [
        {
          type: "case",
          title: "A schedule to the wrong clinic",
          scenario: "At 4:50 pm you send a next-day schedule, with patient names and appointment times, to a clinic contact. At 5:05 pm you notice your email program filled in a different clinic's contact with the same first name. The message was delivered and the other contact has not replied.",
          question: "What do you do, in what order, and what do you leave out of your report?",
          answer: "Stop, and do not send a second email asking them to ignore the first. Tell your lead and HR at once, and use the client's incident steps. Describe the facts: what was sent, to which address, at what time, whether it was opened if you know, and that you have not tried to fix it. Leave out the patient names and the schedule contents. Keep the sent message as it is. The client and ERS will assess it, and ask the other clinic to confirm deletion if that is the right step.",
        },
      ],
    },
    {
      id: "no-retaliation",
      title: "You are protected",
      blocks: [
        { type: "paragraph", text: "HIPAA prohibits retaliating against someone for filing a complaint about a possible violation or taking part in an investigation. ERS goes further: it does not punish anyone for reporting a possible incident in good faith. It does apply sanctions for deliberate violations and for hiding incidents." },
        {
          type: "check",
          question: "You made an honest mistake and sent a message to the wrong client contact. What is the best next step?",
          options: [
            { text: "Report it immediately to your lead and HR", correct: true, feedback: "Right. Fast, honest reporting is protected and limits harm." },
            { text: "Wait to see if the person replies", correct: false, feedback: "Waiting uses up time the client may need." },
            { text: "Ask the person to delete it and say nothing", correct: false, feedback: "A request is not a fix. The incident must still be reported." },
          ],
        },
      ],
    },
    {
      id: "scenario-wrong-fax",
      title: "Try it: the wrong recipient",
      blocks: [
        {
          type: "scenario",
          title: "It went to the wrong person",
          prompt: "You email a schedule with patient names to a clinic contact. A minute later you notice the address autofilled to a similarly named person at a different company.",
          choices: [
            { text: "Send a second email asking them to ignore the first and move on.", feedback: "That does not report the incident, and it creates another message.", best: false },
            { text: "Tell your lead and HR immediately, describe what you sent and where, and follow the client's instructions.", feedback: "Correct. The earlier it is reported, the more can be done.", best: true },
            { text: "Hope the person does not open it, and fix your autofill.", feedback: "Hoping is not a response, and the incident would stay hidden.", best: false },
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
            { term: "Incident", meaning: "Anything that may have exposed, changed or blocked access to information, or broken a rule." },
            { term: "Breach", meaning: "An impermissible use or disclosure of PHI that compromises its privacy or security." },
            { term: "Unsecured PHI", meaning: "PHI that has not been made unusable, unreadable or indecipherable to unauthorized people." },
            { term: "Risk assessment", meaning: "The documented review of four factors used to decide whether PHI was compromised." },
            { term: "Discovery", meaning: "The first day a breach is known, or would have been known with reasonable care." },
            { term: "Retaliation", meaning: "Punishing someone for filing a complaint or taking part in an investigation, which HIPAA prohibits." },
          ],
        },
      ],
    },
  ],
};

export const q7: QuestionSeed[] = [
  q("incidents", "What is an incident", "multiple", "Which of these should be reported as a possible privacy or security incident? Select all that apply.", ["An email with patient information sent to the wrong recipient", "A lost laptop used for work", "A password you accidentally shared", "A reminder to take a break"], [0, 1, 2], "Misdirected PHI, lost devices and shared passwords are incidents. A break reminder is not."),
  q("incidents", "What is an incident", "single", "You wonder whether something is an incident but are not sure. What should you do?", ["Report it, and let the client and ERS decide", "Wait until you are sure", "Ask a friend", "Fix it quietly"], [0], "You do not need to be sure. If you wonder, report it."),
  q("incidents", "Speed", "single", "You just realized you sent a file with patient names to the wrong person. When should you report it?", ["Immediately", "At the end of the week", "Only if the person replies", "After you have checked with a friend"], [0], "Speed matters. Report immediately so the client can act within its deadlines."),
  q("incidents", "Who to tell", "single", "Who should you tell first about a possible incident?", ["Your team lead and HR, following your client's instructions", "The patient directly", "Your coworkers in a group chat", "Nobody until you are sure"], [0], "Report through the proper channel. Do not tell the patient or wait for certainty."),
  q("incidents", "Do not", "single", "A teammate tells you they deleted an email that revealed a mistake to avoid trouble. What is the right response?", ["Encourage them to report it and keep any evidence", "Say nothing", "Help them delete related files", "Tell them to deny everything"], [0], "Deleting evidence and hiding incidents makes things worse. Report and preserve."),
  q("incidents", "Breach definition", "single", "Which statement best defines a breach under HIPAA?", ["An impermissible use or disclosure of PHI that compromises its privacy or security", "Any email sent by a VA", "Any use of a computer", "Any call a patient makes"], [0], "A breach is an impermissible use or disclosure that compromises PHI, and is presumed unless a risk assessment shows a low probability of compromise."),
  q("incidents", "Who decides", "single", "Who decides whether an incident is a reportable breach?", ["The client and ERS, through their risk assessment", "The person who made the mistake", "A coworker", "The patient"], [0], "A breach determination follows a formal risk assessment by the responsible organization. You report; they decide."),
  q("incidents", "Presumption", "single", "How does the law treat an impermissible use or disclosure of PHI?", ["It is presumed to be a breach unless a risk assessment shows a low probability of compromise", "It is presumed not to be a breach unless proven", "It is ignored if it was small", "It is only a breach if the patient complains"], [0], "The presumption favors treating it as a breach, and the organization must show otherwise."),
  q("incidents", "Risk assessment", "multiple", "Which of these are factors in the breach risk assessment? Select all that apply.", ["The nature and extent of the information involved", "Who received or used the information", "Whether the information was actually acquired or viewed", "How popular the clinic is online"], [0, 1, 2], "The four factors are the information, the recipient, whether it was acquired or viewed, and mitigation."),
  q("incidents", "Risk assessment", "single", "An email with patient names went to another clinic's secure address and was deleted unopened, confirmed in writing. Which factors point toward low risk?", ["The recipient is a covered entity, it was not viewed, and the risk was mitigated", "The email was short", "It was sent in the afternoon", "The VA was new"], [0], "A HIPAA-covered recipient, no viewing and confirmed deletion all reduce the probability of compromise."),
  q("incidents", "Exceptions", "single", "A new team member opens a patient's record by mistake, realizes it, closes it, and does nothing further. Which describes this best?", ["It may fit the exception for good-faith, unintentional access, but it should still be reported for the client to decide", "It is always a reportable breach", "It never needs to be reported", "It is only a problem if a patient noticed"], [0], "A narrow exception can apply, but applying it is the client's and ERS's decision. Report it."),
  q("incidents", "Unsecured", "single", "Notification duties apply to which kind of PHI?", ["Unsecured PHI, not rendered unusable, unreadable or indecipherable", "Only paper PHI", "Only encrypted PHI", "Only spoken PHI"], [0], "The breach notification rule applies to unsecured PHI. Proper encryption or destruction secures it."),
  q("incidents", "Encryption", "single", "A work laptop is stolen from a car. It has full-disk encryption. What do you do?", ["Report it immediately; the client decides whether notification is needed", "Say nothing, because it was encrypted", "Decide yourself that no report is needed", "Wait a week to see if it is found"], [0], "Encryption can mean notification is not required, but that decision belongs to the client and ERS. Every loss is reported."),
  q("incidents", "Notification", "single", "Under HIPAA, a covered entity must notify affected individuals of a breach without unreasonable delay and no later than:", ["60 days after discovery", "6 months", "1 year", "Whenever convenient"], [0], "The outer limit for individual notification is 60 days from discovery, and delay should not be unreasonable."),
  q("incidents", "Notification", "single", "Which breaches are reported to HHS at the same time as the notice to individuals, within 60 days?", ["Breaches affecting 500 or more people", "Breaches affecting one person", "Breaches that were encrypted", "Breaches the VA discovers"], [0], "Breaches affecting 500 or more individuals are reported to HHS within 60 days of discovery. Smaller ones are reported after the end of the calendar year."),
  q("incidents", "Discovery", "single", "When is a breach treated as discovered?", ["The first day it is known, or would have been known with reasonable care, to anyone in the workforce other than the person who caused it", "When the client finishes its review", "When the patient is told", "At the end of the quarter"], [0], "Discovery is the first day it is known, or would reasonably have been known, which is why the same-day report matters."),
  q("incidents", "Report details", "single", "What should you include when you write an incident report?", ["What happened, when and where, with no patient names or details", "The full patient record", "Your guess about whose fault it was", "Only that something went wrong"], [0], "Give facts about the event. Keep patient details out of the report itself."),
  q("incidents", "No retaliation", "true_false", "True or false: HIPAA prohibits an organization from retaliating against someone for filing a complaint about a possible violation.", ["True", "False"], [0], "The Privacy Rule bars intimidating or retaliatory acts against people who file complaints or take part in investigations. ERS also does not punish good-faith internal reports."),
  q("incidents", "Preserve", "single", "You suspect a phishing email caused a problem. What should you do with the email?", ["Keep it and report it", "Delete it immediately", "Forward it to everyone", "Print it and throw it away"], [0], "Do not delete evidence. The message helps responders understand what happened."),
  q("incidents", "Scenario", "scenario", "You find a printout with patient names left on a shared printer at a co-working space. What do you do?", ["Keep it secure, report it to your lead and HR, and follow instructions", "Throw it in the bin", "Leave it where it is", "Take a photo and post it to ask whose it is"], [0], "Secure the document, then report it. Throwing it away or posting a photo spreads the exposure."),
  q("incidents", "Common causes", "multiple", "Which of these are common causes of privacy or security incidents? Select all that apply.", ["Information sent to the wrong person", "A lost or stolen laptop", "Records opened without a work reason", "Taking a regular break"], [0, 1, 2], "Misdirected information, lost devices and unauthorized access are among the most common causes. A break is not an incident."),
];
