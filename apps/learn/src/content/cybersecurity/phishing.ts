import { q, type CourseModule, type QuestionSeed } from "../schema";

// Cybersecurity course, module 1: phishing and social engineering. Moved out of the HIPAA course (which is HIPAA only).
// Invented addresses use the reserved .example name only.

export const phishingModule: CourseModule = {
  key: "phishing",
  title: "Phishing and social engineering",
  summary: "How attackers trick people, the signs to look for, and what to do when something feels off.",
  estimatedMinutes: 13,
  tracks: ["full"],
  keyPoints: [
    "Attackers target people, not only computers.",
    "Urgency, fear and authority are the usual tricks.",
    "Check the sender and the link before you act. Use a known channel to verify.",
    "Never give a password or MFA code to anyone who contacts you.",
    "If you clicked or answered, report it immediately. Speed limits the damage.",
    "Requests to move money or change payment details are checked by phone on a number you already know.",
    "Unexpected calls from \"tech support\" are scams. Hang up and never give remote access.",
  ],
  screens: [
    {
      id: "people-target",
      title: "Attackers go after people",
      blocks: [
        { type: "paragraph", text: "It is often easier to trick a person than to break into a system. **Social engineering** is manipulating someone into giving access or information. It works because it feels natural and urgent." },
        { type: "callout", tone: "info", text: "Healthcare is a favorite target because patient information is valuable and clinics are busy. Your care is part of the defense." },
      ],
    },
    {
      id: "types",
      title: "The usual forms",
      blocks: [
        {
          type: "list",
          items: [
            "**Phishing**: an email that pretends to be someone you trust.",
            "**Spear phishing**: the same, but written for you, using real names and details.",
            "**Smishing**: the same by text message.",
            "**Vishing**: the same by phone call or voicemail.",
            "**Pretexting**: a made-up story, such as \"I am from IT and need your password\".",
            "**MFA fatigue**: sending many sign-in prompts hoping you approve one.",
          ],
        },
      ],
    },
    {
      id: "signs",
      title: "Signs to look for",
      blocks: [
        { type: "paragraph", text: "Pause when a message does any of these:" },
        {
          type: "list",
          items: [
            "Creates urgency or fear: \"your account closes in 15 minutes\".",
            "Asks for a password, code or payment.",
            "Comes from an address that is slightly off, such as a number in place of a letter.",
            "Has a link whose real address does not match the text.",
            "Has an unexpected attachment, or a tone that is not like the sender.",
          ],
        },
      ],
    },
    {
      id: "spot-the-phish",
      title: "Spot the phish",
      blocks: [
        { type: "paragraph", text: "Read this invented message:" },
        { type: "callout", tone: "warning", title: "From: support@ehr-security-check.example", text: "URGENT. Your account expires in 15 minutes. Verify now at ehr-security-check.example and enter your password and the code we just sent to your phone." },
        {
          type: "check",
          question: "What are the warning signs? Select all that apply.",
          multiple: true,
          options: [
            { text: "A short deadline that creates panic", correct: true, feedback: "Urgency is a classic trick to stop you from thinking." },
            { text: "A request for a password and an MFA code", correct: true, feedback: "No real service asks for both in an email." },
            { text: "A sender and link that are not your client's official domain", correct: true, feedback: "Unknown domains are a strong warning sign." },
            { text: "It was sent during working hours", correct: false, feedback: "The time of day is not the problem." },
          ],
        },
      ],
    },
    {
      id: "what-to-do",
      title: "What to do with a suspicious message",
      blocks: [
        {
          type: "steps",
          items: [
            { title: "Stop", text: "Do not click, open attachments, reply or call numbers in the message." },
            { title: "Check", text: "Look at the sender address and hover over links without clicking." },
            { title: "Verify", text: "Contact the sender through a number or address you already know." },
            { title: "Report", text: "Tell your lead and use your client's way to report phishing." },
          ],
        },
      ],
    },
    {
      id: "calls",
      title: "Calls and texts",
      blocks: [
        { type: "paragraph", text: "A caller who says they are from IT, the client, a bank or a government office has to prove it. A real organization will not be upset if you hang up and call back on a number you already have." },
        { type: "callout", tone: "tip", text: "Never give a password, MFA code, or patient information to someone who contacted you first." },
      ],
    },
    {
      id: "imposters",
      title: "Fake bosses, fake invoices and fake tech support",
      blocks: [
        { type: "paragraph", text: "Some of the most costly scams are not technical at all. They are well-written requests that look like normal business:" },
        {
          type: "list",
          items: [
            "**Business email imposters**: a message from a \"manager\" or \"supplier\" asking you to pay, change bank details or buy gift cards.",
            "**Tech support scams**: a call or pop-up about a problem with your computer, asking for remote access or payment.",
            "**Delivery and account tricks**: a \"missed delivery\" or \"account locked\" message with a link.",
          ],
        },
        { type: "callout", tone: "warning", title: "The rule", text: "Never act on a request to move money, change payment details or give access without confirming it by phone, on a number you already know to be right, not the one in the message." },
      ],
    },
    {
      id: "newer-tricks",
      title: "Newer tricks: QR codes, texts and cloned voices",
      blocks: [
        { type: "paragraph", text: "Attackers use whatever people have started to trust:" },
        {
          type: "list",
          items: [
            "**QR codes** on a poster, parking meter or in an email can lead to a fake page. Treat a QR code like a link.",
            "**Text messages** pretending to be a delivery, a bank or your manager, with a link.",
            "**Cloned voices and fake video** made by software can sound like someone you know. A voice is not proof.",
            "**Fake job or support chat** that moves you to a messaging app and asks for details.",
          ],
        },
        { type: "callout", tone: "tip", text: "If a call or message from someone you know asks for money, codes or secrets in a hurry, hang up and call them back on their usual number." },
      ],
    },
    {
      id: "clicked",
      title: "If you clicked",
      blocks: [
        { type: "paragraph", text: "Anyone can click. What matters is what you do next. Act fast and be honest:" },
        {
          type: "steps",
          items: [
            { title: "Disconnect if told to", text: "Follow your client's instructions. If unsure, disconnect from the network." },
            { title: "Report right away", text: "Tell your lead and HR. Say exactly what you did." },
            { title: "Change the password only through the official path", text: "Not through any link in the message." },
            { title: "Keep the message", text: "Do not delete it. It helps the response." },
          ],
        },
        { type: "callout", tone: "info", text: "Reporting quickly and honestly is protected. Hiding it is what makes things worse." },
      ],
    },
    {
      id: "scenario-ceo",
      title: "Try it: the urgent request",
      blocks: [
        {
          type: "scenario",
          title: "A message from the boss",
          prompt: "You get an email that looks like it is from your client's practice manager: \"I am in a meeting. Quickly send me the list of patients with outstanding balances. Reply here only.\" The sender address is almost right, but one letter is off.",
          choices: [
            { text: "Send it right away. The manager is busy and needs it.", feedback: "That could be a scam, and it would send PHI to an attacker.", best: false },
            { text: "Do not reply. Check the address, verify through a known phone number or chat, and report it to your lead.", feedback: "Correct. Verify through a known channel and report.", best: true },
            { text: "Reply asking if it is really them.", feedback: "Replying confirms the mailbox is active and may reach the attacker.", best: false },
          ],
        },
      ],
    },
  ],
};

export const phishingQuestions: QuestionSeed[] = [
  q("phishing", "Types", "single", "An attacker sends a text message with a link that pretends to be a delivery notice. This is called:", ["Smishing", "Vishing", "Tailgating", "Backup"], [0], "Smishing is phishing by SMS or text message."),
  q("phishing", "Types", "single", "A caller says \"I am from IT; read me the code on your phone so we can fix your account.\" This is:", ["Vishing and social engineering", "A normal security check", "Required by HIPAA", "A system update"], [0], "Voice phishing uses a made-up story to get codes or passwords. IT would never need your code."),
  q("phishing", "Signs", "multiple", "Which of these are warning signs of a phishing email? Select all that apply.", ["A threat that your account closes in 10 minutes", "A link whose real address does not match the text", "A request for your password", "A message from a known colleague about a meeting you expected"], [0, 1, 2], "Urgency, mismatched links and requests for credentials are classic signs."),
  q("phishing", "What to do", "single", "You receive a suspicious email that asks you to log in through a link. What is the best action?", ["Do not click, and report it through your client's way and to your lead", "Click to see where it goes", "Reply to ask if it is real", "Forward it to coworkers for their opinion"], [0], "Do not interact with it. Report it so others are protected."),
  q("phishing", "Verify", "single", "An email appears to be from your client's manager and asks for a patient list. What should you do before replying?", ["Verify through a phone number or channel you already know", "Reply and ask if it is really them", "Send only half the list", "Call the number in the email signature"], [0], "Use a known channel. Details inside the message could be controlled by the attacker."),
  q("phishing", "MFA fatigue", "single", "You receive repeated MFA approval requests you did not start. What do you do?", ["Deny them and report it immediately", "Approve one so they stop", "Turn off MFA for the day", "Ask a coworker to approve it"], [0], "Repeated prompts mean someone has your password. Deny and report."),
  q("phishing", "Clicked", "single", "You realize you entered your password on a fake page. What is the best response?", ["Report it immediately to your lead and HR, and change the password through the official path", "Say nothing in case nothing happens", "Delete the email and move on", "Wait until the end of the day to report"], [0], "Speed limits damage. Report right away and use the official path to reset."),
  q("phishing", "Clicked", "true_false", "True or false: After clicking a bad link, you should delete the email so nobody finds out.", ["True", "False"], [1], "Do not delete it. The message helps the response, and hiding the event makes harm worse."),
  q("phishing", "Attachments", "single", "An unexpected attachment named \"Invoice.zip\" arrives from an unknown sender. What do you do?", ["Do not open it and report it", "Open it in a safe-looking window", "Forward it to your personal email to check", "Save it and open it later"], [0], "Unexpected attachments are a common way to deliver malware. Do not open them."),
  q("phishing", "Imposters", "single", "An email that looks like it is from your manager asks you to buy gift cards urgently and send the codes. What should you do?", ["Confirm by phone on a number you already know, and report the message", "Buy them quickly, since it is your manager", "Reply to ask if it is really them", "Ask a coworker to buy them instead"], [0], "Urgent payment requests that appear to come from a boss are a classic scam. Confirm independently."),
  q("phishing", "Tech support", "single", "A pop-up says your computer is infected and tells you to call a number and allow remote access. What do you do?", ["Close it, do not call, and report it to your lead", "Call and follow the instructions", "Allow remote access to be safe", "Give them your password to check"], [0], "Unexpected tech support messages are scams. Never give remote access or passwords to someone who contacted you."),
  q("phishing", "QR codes", "single", "You find a QR code on a poster that promises a prize and asks you to sign in. What is the safest approach?", ["Do not scan it, or treat the destination like any untrusted link", "Scan it and sign in with your work password", "Scan it and share it with colleagues", "Scan it with a work phone only"], [0], "A QR code is just a link. Never enter work passwords on a page you reached from one."),
  q("phishing", "Calls", "single", "A caller claims to be from a government office and demands payment now or you face penalties. What is the right response?", ["Hang up and contact the organization through an official number you find yourself", "Pay to avoid the penalties", "Give your bank details to confirm", "Read back your patient list"], [0], "Pressure and payment demands are signs of fraud. Verify independently."),
];
