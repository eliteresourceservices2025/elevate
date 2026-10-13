import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 7: privacy and security incidents. How to report is described in plain terms (lead and HR, plus the client's own steps);
// the in-ELEVATE incident form is linked here when it is built (release 2).

export const m7: CourseModule = {
  key: "incidents",
  title: "Privacy and security incidents",
  summary: "What counts as an incident, why speed matters, and exactly what to do and not do when something goes wrong.",
  estimatedMinutes: 8,
  tracks: ["full", "essentials", "refresher"],
  keyPoints: [
    "An incident is anything that may have exposed patient information or weakened its protection.",
    "Report immediately to your lead and HR. Do not wait to be sure.",
    "Do not investigate, fix quietly, delete evidence or contact the patient yourself.",
    "Describe what happened and when. Do not write patient details in the report.",
    "Good-faith reporting is protected. Nobody is punished for speaking up.",
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
      id: "breach",
      title: "Incident and breach",
      blocks: [
        { type: "paragraph", text: "A **breach** is an impermissible use or disclosure of PHI that compromises its privacy or security. The law presumes it is a breach unless a risk assessment shows a low probability that the information was compromised." },
        { type: "paragraph", text: "That decision belongs to the client and ERS, not to you. Your part is to **report quickly** so they can make it." },
      ],
    },
    {
      id: "why-speed",
      title: "Why speed matters",
      blocks: [
        { type: "paragraph", text: "When a breach is confirmed, the covered entity must notify the people affected without unreasonable delay and no later than 60 days. A business associate must tell the covered entity first, and many contracts require it much sooner than that." },
        { type: "paragraph", text: "A breach counts as discovered on the first day it is known, or would have been known with reasonable care, to anyone other than the person who caused it. A few hours of delay on your side can use up time the client needs." },
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
  ],
};

export const q7: QuestionSeed[] = [
  q("incidents", "What is an incident", "multiple", "Which of these should be reported as a possible privacy or security incident? Select all that apply.", ["An email with patient information sent to the wrong recipient", "A lost laptop used for work", "A password you accidentally shared", "A reminder to take a break"], [0, 1, 2], "Misdirected PHI, lost devices and shared passwords are incidents. A break reminder is not."),
  q("incidents", "Speed", "single", "You just realized you sent a file with patient names to the wrong person. When should you report it?", ["Immediately", "At the end of the week", "Only if the person replies", "After you have checked with a friend"], [0], "Speed matters. Report immediately so the client can act within its deadlines."),
  q("incidents", "Who to tell", "single", "Who should you tell first about a possible incident?", ["Your team lead and HR, following your client's instructions", "The patient directly", "Your coworkers in a group chat", "Nobody until you are sure"], [0], "Report through the proper channel. Do not tell the patient or wait for certainty."),
  q("incidents", "Do not", "single", "A teammate tells you they deleted an email that revealed a mistake to avoid trouble. What is the right response?", ["Encourage them to report it and keep any evidence", "Say nothing", "Help them delete related files", "Tell them to deny everything"], [0], "Deleting evidence and hiding incidents makes things worse. Report and preserve."),
  q("incidents", "Breach", "single", "Who decides whether an incident is a reportable breach?", ["The client and ERS, through their risk assessment", "The person who made the mistake", "A coworker", "The patient"], [0], "A breach determination follows a formal risk assessment by the responsible organization. You report; they decide."),
  q("incidents", "Breach", "single", "Under HIPAA, a covered entity must notify affected individuals of a breach without unreasonable delay and no later than:", ["60 days after discovery", "6 months", "1 year", "Whenever convenient"], [0], "The outer limit for individual notification is 60 days from discovery, and delay should not be unreasonable."),
  q("incidents", "Report details", "single", "What should you include when you write an incident report?", ["What happened, when and where, with no patient names or details", "The full patient record", "Your guess about whose fault it was", "Only that something went wrong"], [0], "Give facts about the event. Keep patient details out of the report itself."),
  q("incidents", "No retaliation", "true_false", "True or false: HIPAA prohibits an organization from retaliating against someone for filing a complaint about a possible violation.", ["True", "False"], [0], "The Privacy Rule bars intimidating or retaliatory acts against people who file complaints or take part in investigations. ERS also does not punish good-faith internal reports."),
  q("incidents", "Preserve", "single", "You suspect a phishing email caused a problem. What should you do with the email?", ["Keep it and report it", "Delete it immediately", "Forward it to everyone", "Print it and throw it away"], [0], "Do not delete evidence. The message helps responders understand what happened."),
  q("incidents", "Scenario", "scenario", "You find a printout with patient names left on a shared printer at a co-working space. What do you do?", ["Keep it secure, report it to your lead and HR, and follow instructions", "Throw it in the bin", "Leave it where it is", "Take a photo and post it to ask whose it is"], [0], "Secure the document, then report it. Throwing it away or posting a photo spreads the exposure."),
];
