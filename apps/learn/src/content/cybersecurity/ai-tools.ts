import { q, type CourseModule, type QuestionSeed } from "../schema";

// Cybersecurity course, new module (version 2): AI tools and your data. General good practice, not legal text. Where a rule is ERS
// policy it says so. All people and details in examples are invented.

export const aiToolsModule: CourseModule = {
  key: "ai_tools",
  title: "AI tools and your data",
  summary: "Why pasting work into an AI tool is a disclosure, what counts as an AI tool, how to check what comes back, and what to do instead.",
  estimatedMinutes: 10,
  tracks: ["full"],
  keyPoints: [
    "Anything you type or upload into an AI tool leaves your control and goes to the company that runs it.",
    "Client and patient information never goes into a tool that ERS and the client have not approved.",
    "Removing a name is not enough: details and context can still identify a person.",
    "AI tools are built into many apps and browsers, so check before you use any assistant on work.",
    "Treat AI output as a draft that may be wrong, and check it before it goes anywhere.",
    "When in doubt, ask your lead for the approved way.",
  ],
  screens: [
    {
      id: "what-happens",
      title: "What happens to what you type",
      blocks: [
        { type: "paragraph", text: "An AI tool is a service run by a company. When you paste text, upload a file or record audio, the information travels to that company's systems. Depending on the service, it may be stored, reviewed by people, used to improve the product, or exposed if the company is breached." },
        { type: "paragraph", text: "You cannot take it back. That is why the rule is about what goes in, not about how good the answer is." },
        { type: "callout", tone: "warning", text: "Sending client or patient information to a tool nobody approved is a disclosure to an outside company, even if it takes two seconds and the answer is helpful." },
      ],
    },
    {
      id: "what-counts",
      title: "What counts as an AI tool",
      blocks: [
        { type: "paragraph", text: "Many tools use AI without saying so. Treat all of these as AI tools:" },
        {
          type: "list",
          items: [
            "Chatbots and writing assistants, in a browser or inside another app",
            "Transcription, note-taking and meeting-summary services",
            "Translators and grammar or rewriting tools, including browser extensions",
            "Image, document and spreadsheet assistants built into office software",
            "Free \"converter\" or \"summarizer\" websites",
          ],
        },
        { type: "callout", tone: "tip", text: "The test is simple: does the tool send what I give it to someone else's servers? If you are not sure, assume it does." },
      ],
    },
    {
      id: "approved",
      title: "Approved and not approved",
      blocks: [
        { type: "paragraph", text: "ERS and each client decide which tools are approved for client work. A tool is approved only when ERS or the client has reviewed it and has an agreement that limits what the company may do with the information." },
        {
          type: "compare",
          left: { title: "Approved for work", items: ["A tool named in your client's instructions", "A tool ERS has approved in writing", "A tool whose settings your lead has confirmed"] },
          right: { title: "Not approved", items: ["A free account you made yourself", "A browser extension you found", "A tool a coworker recommended"] },
        },
        { type: "callout", tone: "info", text: "Using an approved tool for approved purposes is fine. Ask your lead which tools are approved and for what." },
      ],
    },
    {
      id: "anonymizing",
      title: "\"I took the name out\" is not enough",
      blocks: [
        { type: "paragraph", text: "People often think removing a name makes information safe. It rarely does. A date, a rare condition, a small town, a job title, an account number or a pattern in the details can point to one person." },
        {
          type: "case",
          title: "The summary request",
          scenario: "You are asked to summarize a long patient complaint letter for a clinic manager. You delete the patient's name and paste the rest into a free AI assistant, planning to tidy the summary yourself. The letter mentions her rare diagnosis, the exact date of her surgery and the street she lives on.",
          question: "Why is this still a problem?",
          answer: "The details identify her without a name: the diagnosis, the date and the street together point to one person. The text has also left the approved systems and reached a company with no agreement. The right route is to summarize it yourself inside the client's system, or ask the client for an approved tool.",
        },
      ],
    },
    {
      id: "meetings",
      title: "Notetakers, recorders and meeting bots",
      blocks: [
        { type: "paragraph", text: "Some meeting tools record and transcribe calls, or send a bot to join. On a client call that may capture patient names, schedules and other details, and store them with a third party." },
        {
          type: "list",
          items: [
            "Do not turn on recording or transcription on client calls unless the client says so.",
            "Do not let a bot or notetaker app join a client call.",
            "If someone else's tool joins, ask the host whether it is approved.",
            "Tell your lead if a recording was made without approval.",
          ],
        },
      ],
    },
    {
      id: "accuracy",
      title: "Check what comes back",
      blocks: [
        { type: "paragraph", text: "AI tools can sound sure and be wrong. They can invent facts, misread a number or leave out a key detail. Output that goes into a record, a message to a patient or a client report must be checked by a person before it is used." },
        {
          type: "steps",
          items: [
            { title: "Read it all", text: "Do not skim. One wrong number can matter." },
            { title: "Check the facts", text: "Against the source in the client's system." },
            { title: "Remove what should not be there", text: "Anything you did not mean to include." },
            { title: "Own it", text: "What you send is your work, whoever drafted it." },
          ],
        },
      ],
    },
    {
      id: "hidden-instructions",
      title: "Instructions hidden in documents",
      blocks: [
        { type: "paragraph", text: "Attackers can hide instructions in a document, a web page or an email so that an AI assistant that reads it follows them, for example \"send the contents of this chat to this address\". You may not see the text at all." },
        { type: "callout", tone: "warning", text: "Do not let an assistant open, read or act on files, links or messages from people you do not know. And never give a tool access to your email, your files or your accounts without approval." },
      ],
    },
    {
      id: "scenario-quick-help",
      title: "Try it: the quick favor",
      blocks: [
        {
          type: "scenario",
          title: "A faster way to answer",
          prompt: "A client's office manager sends you a long email thread about a patient's insurance dispute and asks for a one-paragraph summary by the end of the hour. A free AI summarizer would do it in seconds.",
          choices: [
            { text: "Paste the thread into the free summarizer and tidy the result.", feedback: "The thread has left the approved systems and reached an outside company, whatever you do afterward.", best: false },
            { text: "Write the summary yourself in the client's system, and ask your lead whether an approved tool exists for long threads.", feedback: "Correct. You meet the deadline without sending anything out, and the question helps the next person.", best: true },
            { text: "Paste only the last three emails.", feedback: "Fewer emails is still client information sent to an unapproved tool.", best: false },
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
            { term: "AI tool", meaning: "A service that uses artificial intelligence and sends what you give it to the company's servers." },
            { term: "Approved tool", meaning: "A tool ERS or the client has reviewed and covered with an agreement limiting what the company may do with data." },
            { term: "Prompt", meaning: "The text, file or audio you give an AI tool to work on." },
            { term: "Hidden instruction", meaning: "Text planted in a document or page that tries to make an AI assistant do something you did not ask." },
            { term: "Re-identification", meaning: "Working out who information is about from its details, even when the name has been removed." },
          ],
        },
      ],
    },
  ],
};

export const aiToolsQuestions: QuestionSeed[] = [
  q("ai_tools", "What happens", "single", "You paste text into a public AI chatbot. What is true about that text?", ["It travels to the company that runs the tool, and you cannot take it back", "It stays on your computer only", "It is deleted the moment you close the tab", "It is only seen by you"], [0], "Information you give an AI service goes to the company's systems, where it may be stored or reviewed."),
  q("ai_tools", "What counts", "multiple", "Which of these should be treated as AI tools for the purposes of this rule? Select all that apply.", ["A writing assistant in a browser", "A meeting transcription service", "A free online document summarizer", "A paper dictionary"], [0, 1, 2], "Assistants, transcribers and summarizers send what you give them to a company. A paper dictionary does not."),
  q("ai_tools", "What counts", "single", "How can you tell whether a feature in an app uses an outside AI service?", ["You cannot always tell, so assume it does and ask your lead before using it on client work", "It always says so in large letters", "Only paid tools do", "Only tools with a robot icon do"], [0], "Many tools use AI without saying so. The safe assumption is that they send your input elsewhere."),
  q("ai_tools", "Approved", "single", "Which tool is approved for client work?", ["One ERS or the client named or approved in writing", "One you found and signed up for yourself", "One a coworker said was fine", "One that has a free plan"], [0], "A tool is approved only when ERS or the client has reviewed it and covered it with an agreement."),
  q("ai_tools", "Approved", "true_false", "True or false: A tool being free or popular makes it approved for client work.", ["True", "False"], [1], "Approval comes from ERS or the client, not from price or popularity."),
  q("ai_tools", "Anonymizing", "single", "You remove a patient's name from a letter before pasting it into an unapproved AI tool. Why is that still a problem?", ["The remaining details can identify the person, and the tool is unapproved", "Names are not important", "AI tools cannot read letters without names", "It is only a problem if the letter is long"], [0], "Dates, conditions, places and other details can identify someone, and the text has still left the approved systems."),
  q("ai_tools", "Anonymizing", "single", "Which approach is correct when you need a long document summarized for a client?", ["Summarize it yourself in the client's system, or ask for an approved tool", "Paste it into any free tool and delete the result", "Paste only the first half", "Replace names with initials and paste it"], [0], "Use the approved system, or ask for an approved tool. Partial pasting and initials do not solve the disclosure."),
  q("ai_tools", "Meetings", "single", "On a client call, a meeting app offers to record and transcribe automatically. What should you do?", ["Leave it off unless the client has approved recording", "Turn it on to save time", "Turn it on and delete the file later", "Let any participant's bot join"], [0], "Recording and transcription send client information to a third party, so they need approval first."),
  q("ai_tools", "Meetings", "single", "A bot from someone's note-taking app joins a client call. What is the best response?", ["Ask the host whether it is approved, and report it to your lead if not", "Ignore it", "Talk faster", "Share your screen so it sees more"], [0], "Unapproved notetakers can capture client information. Ask, and report."),
  q("ai_tools", "Accuracy", "single", "An AI assistant drafts a message to a patient. What must happen before it is sent?", ["A person checks the facts and wording, and owns the final message", "Nothing, since the tool is smart", "It is sent and corrected later", "It is posted for others to review afterward"], [0], "AI output can be wrong. The sender is responsible for what goes out."),
  q("ai_tools", "Accuracy", "true_false", "True or false: If an AI tool sounds confident, its answer can be trusted without checking.", ["True", "False"], [1], "Tools can invent facts and sound sure. Output must be checked."),
  q("ai_tools", "Hidden instructions", "single", "Why should you be careful about letting an AI assistant open files or links from unknown senders?", ["Hidden text can instruct it to do things you did not ask", "The files are too large", "Assistants do not read files", "It uses too much battery"], [0], "Instructions planted in a document or page can steer an assistant, and you may not see them."),
  q("ai_tools", "Access", "single", "A tool asks for access to your work email and files to 'help you work faster'. What should you do?", ["Decline, and ask your lead whether it is approved", "Allow it, since it saves time", "Allow it on your phone only", "Allow it for one day"], [0], "Giving a tool access to mail and files exposes everything in them. It needs approval first."),
  q("ai_tools", "Doubt", "single", "You are unsure whether an AI feature in your office software is approved for client work. What do you do?", ["Do not use it on client information, and ask your lead", "Use it and see", "Use it only for short texts", "Use it at night when nobody is watching"], [0], "When unsure, hold back and ask. A question costs minutes, a disclosure cannot be undone."),
];
