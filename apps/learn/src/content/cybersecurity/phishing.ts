import { q, type CourseModule, type QuestionSeed } from "../schema";

// Cybersecurity course, module 1: phishing and social engineering. Moved out of the HIPAA course (which is HIPAA only).
// Invented addresses use the reserved .example name only.

export const phishingModule: CourseModule = {
  key: "phishing",
  title: "Phishing and social engineering",
  summary: "How attackers trick people, the signs to look for, and what to do when something feels off.",
  estimatedMinutes: 21,
  tracks: ["full"],
  keyPoints: [
    "Attackers target people, not only computers.",
    "Urgency, fear and authority are the usual tricks.",
    "Check the sender and the link before you act. Use a known channel to verify.",
    "Never give a password or MFA code to anyone who contacts you.",
    "If you clicked or answered, report it immediately. Speed limits the damage.",
    "Requests to move money or change payment details are checked by phone on a number you already know.",
    "Unexpected calls from \"tech support\" are scams. Hang up and never give remote access.",
    "Healthcare lures often pose as a payer, a patient, a clinic or a supplier, so verify through a route you already know.",
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
      id: "healthcare-lures",
      title: "Lures that fit healthcare work",
      blocks: [
        { type: "paragraph", text: "Attackers tailor messages to the work you do. In healthcare they often pose as the people you expect to hear from:" },
        {
          type: "table",
          caption: "Common healthcare lures",
          columns: ["The message says it is from", "What it asks", "What to do"],
          rows: [
            ["A payer or insurer", "Log in to see a held or denied claim", "Go to the payer's site yourself, never through the link"],
            ["A patient", "Open an attached form or record request", "Do not open it; route it as the client instructs"],
            ["A clinic's manager", "Urgent change to bank details or a payment", "Call back on a number you already have"],
            ["A supplier or vendor", "An invoice or a shared document link", "Check with the vendor through a known contact"],
            ["IT or the EHR vendor", "Reset your password or install a tool", "Report it, and use the official support route"],
          ],
        },
      ],
    },
    {
      id: "case-payer",
      title: "Worked case: the held claim",
      blocks: [
        {
          type: "case",
          title: "A payer portal that is not the payer",
          scenario: "You manage claims for a clinic. An email arrives: \"Action required: 14 claims on hold. Sign in to the Provider Portal to release payment today.\" The logo looks right and the sender's name matches an insurer you work with. The button leads to a login page.",
          question: "How do you check it, and what do you do if you already entered your password?",
          answer: "Do not use the button. Open the insurer's portal by typing its address or using the bookmark you already have, and look for the same notice there. If it is not there, report the email to your lead. If you already entered a password, change it the official way at once, tell your lead and HR immediately, and say which account it was, because the clinic's claims and payment details may be at risk.",
        },
      ],
    },
    {
      id: "case-bec",
      title: "Worked case: the changed bank details",
      blocks: [
        {
          type: "case",
          title: "A familiar voice in an email",
          scenario: "A message arrives from what looks like a clinic owner's email: \"Please update the account for our supplier payments before Friday. New details attached. I am in a meeting and cannot take calls.\" The writing is right and the request is polite.",
          question: "What makes this suspicious, and what is the safe step?",
          answer: "A change to payment details, urgency, an unusual channel and the sender being unavailable are all classic signs of fraud called business email compromise. The safe step is to verify through a different route: call the owner on a number you already have, not one in the message, and follow the client's process for changing payment details. Do not change anything until it is confirmed.",
        },
      ],
    },
    {
      id: "voice",
      title: "Voice phishing: the helpful caller",
      blocks: [
        { type: "paragraph", text: "Calls can be just as convincing as email. A caller may sound friendly, use real names and know a little about your work. Common stories are a payer representative who \"needs to verify\" your portal login, or an IT person who \"needs to install a tool\" to fix a problem." },
        {
          type: "steps",
          items: [
            { title: "Do not give anything", text: "No passwords, codes or patient details on an incoming call." },
            { title: "Do not install anything", text: "No remote-access tools at a caller's request." },
            { title: "Hang up", text: "You may end any call that feels wrong." },
            { title: "Call back", text: "Use a number you already trust, and tell your lead." },
          ],
        },
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
    {
      id: "verify-second-channel",
      title: "Verify through a second channel",
      blocks: [
        { type: "paragraph", text: "A voice or a face is not proof of who is asking. Criminals use software to make convincing fake audio and video, so a call or a video chat that looks and sounds like your manager can still be a fake. A joint FBI and CISA alert of October 2026 advises confirming requests for sensitive information through a second channel, if possible, and using phishing-resistant sign-in." },
        { type: "callout", tone: "tip", title: "The habit", text: "When a request asks for money, access or patient information, stop and check it another way: call the person back on a number you already know, or ask in a chat channel the client already uses. Never use the number or link that came with the request." },
        {
          type: "cards",
          title: "Second channel or same channel?",
          prompt: "Is this a real way to check a request, or just more of the same message?",
          groups: ["A second channel", "Not a check"],
          cards: [
            { text: "Call the manager on the number you already have", group: 0, feedback: "A number you already trust is a second channel." },
            { text: "Call the number written in the message", group: 1, feedback: "The attacker chose that number, so it proves nothing." },
            { text: "Ask in the chat channel the client already uses", group: 0, feedback: "A known chat channel is a different path from the message." },
            { text: "Reply to the message and ask whether it is really them", group: 1, feedback: "Replying may reach the attacker and shows the mailbox is active." },
            { text: "Trust the face on the video call", group: 1, feedback: "Software can fake a face and a voice. It is not proof." },
            { text: "Tell your lead and let them check with the client", group: 0, feedback: "Reporting is always part of the answer, and your lead can confirm another way." },
          ],
        },
      ],
    },
    {
      id: "video-call-boss",
      title: "Practice: the video call from the boss",
      blocks: [
        {
          type: "branch",
          title: "A payment request on a video call",
          intro: "A video call comes in. The face and voice look like your client's practice manager. They ask you to pay a supplier invoice today.",
          startMood: 50,
          turns: [
            {
              caller: "Quick favor. I need you to pay a supplier invoice today. I will message you the account details.",
              choices: [
                { text: "Pay it. I can see and hear the manager.", mood: -30, reply: "Great, sending the details now. (A familiar face and voice are not proof.)" },
                { text: "I will call you back on the number I already have to confirm.", mood: 25, reply: "There is no need, just do it. (A real manager will not mind a call back.)" },
                { text: "Message me the details first and I will decide.", mood: -10, reply: "Here they are. (You now hold payment details from the same unverified source.)" },
              ],
            },
            {
              caller: "I am travelling and cannot take calls. This is urgent, so just do it this one time.",
              choices: [
                { text: "Do it this one time.", mood: -30, reply: "Thank you. (Urgency and a reason you cannot call are the warning signs.)" },
                { text: "End the call, confirm through a known number or chat, and tell my lead.", mood: 25, reply: "(The call ends. Verifying through a second channel is the right move.)" },
                { text: "Ask a coworker if it looks right.", mood: -5, reply: "(A coworker cannot confirm it. Check with the manager through a channel you already trust.)" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "fake-message-check",
      title: "Check the message: what gives it away?",
      blocks: [
        {
          type: "hotspot",
          title: "A message about a held claim",
          prompt: "This invented message says a claim is on hold. Tap every part that is a warning sign, then check.",
          items: [
            { label: "Sender", text: "Billing Support, from an address with a zero where a letter o should be", problem: true, why: "An address that is slightly off, such as a number in place of a letter, is a warning sign." },
            { label: "Subject", text: "Your account closes in 15 minutes", problem: true, why: "Urgency or fear is meant to stop you from thinking." },
            { label: "Sent", text: "During working hours" },
            { label: "Button", text: "Sign in now, but the link's real address does not match the text", problem: true, why: "A link whose real address does not match the text is a warning sign." },
            { label: "Request", text: "Enter your password and the code we just sent to your phone", problem: true, why: "No real service asks for a password and a code in a message." },
            { label: "Footer", text: "A standard privacy notice at the bottom" },
          ],
          explanation: "Stop, check, verify through a number or address you already know, and report. Do not click or reply.",
        },
      ],
    },
    {
      id: "quick-round-phishing",
      title: "Quick round: phishing and social engineering",
      blocks: [
        {
          type: "game",
          title: "Phish sprint",
          seconds: 20,
          rounds: [
            {
              question: "A message says your account closes in 15 minutes. What is the best move?",
              options: [
                { text: "Stop and verify through a known channel", correct: true, feedback: "Urgency is a trick to stop you thinking." },
                { text: "Click quickly to save the account", correct: false, feedback: "That is what the attacker hopes for." },
                { text: "Reply asking if it is real", correct: false, feedback: "Replying may reach the attacker." },
              ],
            },
            {
              question: "A video call shows your manager asking for an urgent payment. What do you do?",
              options: [
                { text: "Confirm through a number you already know", correct: true, feedback: "A face and a voice are not proof." },
                { text: "Pay because you can see them", correct: false, feedback: "Fake audio and video can look convincing." },
                { text: "Ask for the details to be messaged first", correct: false, feedback: "That keeps you inside the same unverified channel." },
              ],
            },
            {
              question: "Which number do you use to check a request?",
              options: [
                { text: "One you already know to be right", correct: true, feedback: "Never the one in the message." },
                { text: "The one in the message", correct: false, feedback: "The attacker chose it." },
                { text: "Any number from a quick search", correct: false, feedback: "Use a number you already trust." },
              ],
            },
            {
              question: "You clicked a bad link. What now?",
              options: [
                { text: "Report it to your lead right away", correct: true, feedback: "Fast and honest is always right." },
                { text: "Delete the message so nobody sees", correct: false, feedback: "It helps the response, so keep it." },
                { text: "Wait to see what happens", correct: false, feedback: "Attacks are often silent at first." },
              ],
            },
            {
              question: "A QR code on a poster asks you to sign in. How should you treat it?",
              options: [
                { text: "Like any other link: do not trust it", correct: true, feedback: "It can lead to a fake page." },
                { text: "As safe, because it is printed", correct: false, feedback: "Printing does not make it safe." },
                { text: "As a reason to share your code", correct: false, feedback: "Never share a code." },
              ],
            },
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
  q("phishing", "Healthcare lures", "single", "An email says claims are on hold and asks you to sign in to a payer portal through a button. What is the safest first step?", ["Open the payer's portal yourself using a bookmark or an address you know", "Click the button, since the logo looks right", "Forward it to a friend to check", "Reply asking if it is real"], [0], "Go to the site yourself through a route you trust, never through the message."),
  q("phishing", "Healthcare lures", "single", "A patient emails an attached 'records request form' you were not expecting. What should you do?", ["Not open it, and route it the way the client instructs", "Open it to see what it is", "Forward it to the whole team", "Print it"], [0], "Attachments from unexpected senders can carry malware, and records requests are handled by the client."),
  q("phishing", "Business email compromise", "single", "A message from what looks like a clinic owner asks you to change a supplier's bank details urgently and says they cannot take calls. What is the safe step?", ["Verify by calling a number you already have and follow the client's process", "Make the change quickly to meet the deadline", "Reply to confirm the new details", "Ask the sender to send a scan of the new bank letter"], [0], "Payment changes with urgency and no call are classic fraud. Verify through another route."),
  q("phishing", "Business email compromise", "multiple", "Which of these are signs of business email compromise? Select all that apply.", ["A request to change payment details", "Strong urgency", "The sender says they cannot be reached by phone", "A message with a friendly greeting only"], [0, 1, 2], "A payment change, pressure and avoiding a call are common signs."),
  q("phishing", "Voice phishing", "single", "A caller says he is from IT and asks you to install a remote tool to fix a problem. What is the best response?", ["Decline, hang up and report it to your lead", "Install it quickly", "Install it on your personal device", "Give him your password so he can do it"], [0], "Remote-access tools give full control. Legitimate IT will use approved routes."),
  q("phishing", "Voice phishing", "true_false", "True or false: It is rude to hang up on a caller who is asking for a password, so you should stay on the line.", ["True", "False"], [1], "You may end any call that feels wrong, and a legitimate caller will understand."),
  q("phishing", "Clicked", "single", "You entered your password on a page you now think was fake. What is the most important next step?", ["Change the password the official way and report it immediately", "Close the browser and hope for the best", "Wait to see if anything happens", "Clear your history only"], [0], "The password is exposed. Change it and report it right away so the account can be watched."),
  q("phishing", "Second channel", "single", "A video call shows your client's manager asking for an urgent payment and saying they cannot take calls. What is the best response?", ["End the call, verify through a number you already know, and tell your lead", "Pay, because you can see and hear them", "Ask them to message the account details first", "Ask a coworker whether it looks right"], [0], "A face and a voice are not proof, so confirm through a second channel you already trust and report it."),
  q("phishing", "Second channel", "single", "Why is a familiar voice or face on a call not proof of who is asking?", ["Software can make convincing fake audio and video", "Calls cannot be recorded", "Managers never use video", "Fake voices are always easy to hear"], [0], "Convincing deepfake audio and video exist, so confirm requests another way."),
  q("phishing", "Second channel", "multiple", "Which are good ways to confirm a request for money or sensitive information? Select all that apply.", ["Call the person on a number you already know", "Ask in a chat channel the client already uses", "Call the number written in the message", "Reply to the message and ask if it is real"], [0, 1], "Use a channel you already trust. The number or reply path in the message belongs to the sender, who may be the attacker."),
  q("phishing", "Signs", "single", "A message has a button whose real address does not match the text shown. What does that suggest?", ["It may be phishing, so do not click", "It is a normal tracking link", "The message is safe if the logo looks right", "You should click once to see where it goes"], [0], "A link whose real address does not match the text is a classic warning sign."),
];
