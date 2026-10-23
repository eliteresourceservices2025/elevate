import { q, type CourseModule, type QuestionSeed } from "../schema";

// Cybersecurity course, new module (version 2): AI tools and your data. General good practice, not legal text. Where a rule is ERS
// policy it says so. All people and details in examples are invented.

export const aiToolsModule: CourseModule = {
  key: "ai_tools",
  title: "AI tools and your data",
  summary: "Why pasting work into an AI tool is a disclosure, what counts as an AI tool, how to check what comes back, and what to do instead.",
  estimatedMinutes: 15,
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
      id: "cards-paste-or-not",
      title: "Quick sort: fine to type, or never paste?",
      blocks: [
        {
          type: "cards",
          title: "Fine to type, or never paste?",
          prompt: "Sort each thing you might put into an AI tool that nobody approved for client work.",
          groups: ["Fine to type", "Never paste"],
          cards: [
            { text: "A general question with no work or personal details", group: 0, feedback: "Nothing about a client or a person goes out." },
            { text: "A patient complaint letter with the name deleted", group: 1, feedback: "Removing a name is not enough: the details can still identify her." },
            { text: "A password or a code", group: 1, feedback: "Never enter passwords or codes into a tool." },
            { text: "A work document to a free online converter", group: 1, feedback: "Uploading a work document sends it to an outside company." },
            { text: "The last three emails of a client thread", group: 1, feedback: "Fewer emails is still client information sent to an unapproved tool." },
            { text: "A task in a tool named in your client's instructions", group: 0, feedback: "An approved tool, for approved purposes, is fine." },
          ],
        },
      ],
    },
    {
      id: "build-safe-request",
      title: "Build a safe way to get help",
      blocks: [
        {
          type: "build",
          title: "Handling the summary request",
          prompt: "A manager asks you for a summary of a long thread by the end of the hour. Pick the right piece for each part.",
          slots: [
            {
              label: "Which tool",
              options: [
                { text: "The tool named in my client's instructions", correct: true, feedback: "Approved tools are named by ERS or the client." },
                { text: "A free assistant I signed up for myself", correct: false, feedback: "A free account you made yourself is not approved." },
              ],
            },
            {
              label: "What goes in",
              options: [
                { text: "Only what that approved tool is approved for", correct: true, feedback: "Use an approved tool for approved purposes." },
                { text: "The thread with the names deleted", correct: false, feedback: "Details can still identify a person." },
              ],
            },
            {
              label: "Before it goes out",
              options: [
                { text: "I read it all and check the facts against the client's system", correct: true, feedback: "Output may be wrong, and what you send is your work." },
                { text: "I send it because it sounds sure", correct: false, feedback: "Tools can sound sure and be wrong." },
              ],
            },
            {
              label: "If I am unsure",
              options: [
                { text: "I ask my lead for the approved way", correct: true, feedback: "A question costs minutes. A disclosure cannot be undone." },
                { text: "I try it and see", correct: false, feedback: "You cannot take back what you paste." },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "spot-the-chat-slip",
      title: "Spot the slip in the chat",
      blocks: [
        {
          type: "spot",
          title: "A chat about a complaint letter",
          prompt: "Tap the line that puts patient information at risk.",
          lines: [
            { speaker: "Manager", text: "Can you summarize this patient complaint letter by the end of the hour?" },
            { speaker: "You", text: "Sure. I will write it in the client's system." },
            { speaker: "Coworker", text: "Just delete her name and paste it into the free assistant I use. It is quick.", wrong: true },
            { speaker: "You", text: "I will check with my lead about an approved tool first." },
          ],
          explanation: "A free assistant nobody approved is an outside company, and deleting the name does not stop the details from identifying her. Write it in the client's system and ask your lead.",
        },
      ],
    },
    {
      id: "quick-round-ai",
      title: "Quick round: AI tools and your data",
      blocks: [
        {
          type: "game",
          title: "AI tools sprint",
          seconds: 20,
          rounds: [
            { question: "You paste text into a public AI chatbot. What is true?", options: [{ text: "It goes to the company that runs the tool, and you cannot take it back", correct: true, feedback: "The information leaves your control." }, { text: "It stays on your computer", correct: false, feedback: "It travels to the company's systems." }] },
            { question: "What makes a tool approved for client work?", options: [{ text: "ERS or the client reviewed it and has an agreement limiting what the company may do", correct: true, feedback: "Approval comes from ERS or the client." }, { text: "It has a free plan", correct: false, feedback: "Price does not make a tool approved." }, { text: "A coworker recommended it", correct: false, feedback: "A recommendation is not approval." }] },
            { question: "Does removing a patient's name make a text safe to paste?", options: [{ text: "No, details can still identify the person", correct: true, feedback: "A date, a condition or a street can point to one person." }, { text: "Yes, names are the only risk", correct: false, feedback: "Context can identify someone." }] },
            { question: "A notetaker bot joins a client call. What do you do?", options: [{ text: "Ask the host if it is approved, and tell your lead if not", correct: true, feedback: "Unapproved notetakers can capture client information." }, { text: "Ignore it", correct: false, feedback: "It may store names and details with a third party." }] },
            { question: "An AI draft is ready to send to a patient. What first?", options: [{ text: "A person checks the facts and owns the message", correct: true, feedback: "Tools can sound sure and be wrong." }, { text: "Send it, the tool is smart", correct: false, feedback: "Output must be checked before it is used." }] },
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
  q("ai_tools", "Copying a colleague", "single", "A coworker says to delete the name from a patient letter and paste it into the free assistant they use. What is the right response?", ["Decline, and check with your lead for an approved way", "Do it, since the name is removed", "Paste only half of the letter", "Paste it from your personal phone instead"], [0], "A free assistant nobody approved is an outside company, and the details can still identify the patient."),
  q("ai_tools", "Approved", "single", "What makes an AI tool approved for a given use?", ["ERS or the client reviewed it and has an agreement that limits what the company may do with the information", "It has a free plan", "A coworker recommended it", "Many people use it"], [0], "Approval comes from ERS or the client, backed by an agreement."),
  q("ai_tools", "What not to paste", "multiple", "Which of these should never go into a tool that has not been approved? Select all that apply.", ["A client's patient information", "A password or code", "A work document to convert", "A general question with no work details"], [0, 1, 2], "Client information, credentials and work documents must stay out of unapproved tools. A general question reveals nothing."),
  q("ai_tools", "What happens", "true_false", "True or false: You can take back what you pasted into a public AI tool by deleting the chat.", ["True", "False"], [1], "You cannot take it back. The information has already reached the company that runs the tool."),
];
