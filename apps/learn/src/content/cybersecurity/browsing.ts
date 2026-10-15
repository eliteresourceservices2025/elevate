import { q, type CourseModule, type QuestionSeed } from "../schema";

export const browsingModule: CourseModule = {
  key: "browsing",
  title: "Safe browsing, email and online privacy",
  summary: "Links, downloads, extensions, social media and AI tools: how to use the internet at work without handing attackers a way in.",
  estimatedMinutes: 11,
  tracks: ["full"],
  keyPoints: [
    "Check where a link really goes before you click. A padlock means the connection is private, not that the site is honest.",
    "Download only from approved sources, and be wary of free tools, extensions and add-ins.",
    "Keep work and personal accounts apart, and keep work details off social media.",
    "Do not paste work, client or personal information into public AI tools.",
    "What you post online can be used to trick you or your colleagues.",
    "Email, text and fax are common routes for patient information, so use only the channels your client approved.",
  ],
  screens: [
    {
      id: "links",
      title: "Look before you click",
      blocks: [
        { type: "paragraph", text: "Many attacks come down to one click on a link that is not what it seems. A few seconds of checking is cheap." },
        {
          type: "list",
          items: [
            "Hover over a link, or press and hold on a phone, to see the real address.",
            "Check the spelling of the domain: attackers register names that are one letter off.",
            "Be careful with shortened links and links in unexpected messages.",
            "If in doubt, go to the site yourself by typing the address, not by following the link.",
          ],
        },
        { type: "callout", tone: "tip", text: "The part of the address just before the first single slash is what matters. In \"login.mysite.example\" the owner is \"mysite.example\"; \"login\" is only a label put on the front." },
      ],
    },
    {
      id: "padlock",
      title: "What the padlock does and does not mean",
      blocks: [
        { type: "paragraph", text: "A padlock or \"https\" means the connection between you and the site is encrypted, so others cannot read it on the way. It does not mean the site is honest. Criminals use https too." },
        {
          type: "check",
          question: "A website shows a padlock. What does that tell you?",
          options: [
            { text: "The connection is private; it does not prove the site is genuine", correct: true, feedback: "Right. Check the address and whether you expected the site." },
            { text: "The site is safe and genuine", correct: false, feedback: "Fake sites can have a padlock too." },
            { text: "The site cannot contain malware", correct: false, feedback: "A padlock says nothing about what the site contains." },
          ],
        },
      ],
    },
    {
      id: "downloads",
      title: "Downloads, extensions and add-ins",
      blocks: [
        { type: "paragraph", text: "A browser extension or an add-in can read what you do and see what is on your screen. A fake one is a common way to capture logins and information." },
        {
          type: "list",
          items: [
            "Install extensions and add-ins only when ERS or your client approved them.",
            "Download files only from the official source, and open them only when you expected them.",
            "Be suspicious of \"free\" versions of paid software, and of files that ask you to enable macros.",
            "Remove extensions you no longer use.",
          ],
        },
      ],
    },
    {
      id: "social",
      title: "Social media and oversharing",
      blocks: [
        { type: "paragraph", text: "Attackers read public profiles to build convincing messages. A post about a client, a role, an upcoming trip or a new system gives them material." },
        {
          type: "list",
          items: [
            "Keep client names, systems, work details and screenshots of work off social media.",
            "Do not accept contact from people you do not know, especially if they ask about your work.",
            "Check your privacy settings, and assume anything public can be copied.",
            "A job offer, a survey or a quiz that asks for work details is a common trick.",
          ],
        },
      ],
    },
    {
      id: "ai-tools",
      title: "AI tools and online converters",
      blocks: [
        { type: "paragraph", text: "Public AI chatbots, translators and online converters are useful, and they receive whatever you paste into them. Treat anything you type into a public tool as shared with a stranger." },
        {
          type: "compare",
          left: { title: "Fine", items: ["General questions with no work or personal details", "Tools your organization has approved for work"], },
          right: { title: "Not fine", items: ["Pasting client, patient or personal information", "Uploading a work document to an online converter", "Entering passwords or codes"] },
        },
      ],
    },
    {
      id: "channels",
      title: "Email, text, fax and voicemail",
      blocks: [
        { type: "paragraph", text: "Patient information often travels by the simplest route available. The channel you choose decides who can read it on the way. Follow the client's rules for each:" },
        {
          type: "table",
          caption: "Common channels and the usual rule",
          columns: ["Channel", "Main risk", "Habit"],
          rows: [
            ["Email", "Wrong recipient, forwarding, copies in many inboxes", "Approved system, check the address, minimum only"],
            ["Text message", "Stored on phones, no control over who reads", "Only if the client allows it, and with no details"],
            ["Fax", "Wrong number, paper left in the tray", "Confirm the number, use a cover sheet, check receipt"],
            ["Voicemail", "Heard by others, no way to retract", "Callback number only, per the client's script"],
            ["Shared inbox or folder", "Many people see everything", "Only the access your job needs"],
          ],
        },
      ],
    },
    {
      id: "case-attachment",
      title: "Worked case: the unprotected attachment",
      blocks: [
        {
          type: "case",
          title: "A spreadsheet in a personal inbox",
          scenario: "A billing contact at a client emails you a spreadsheet of patient balances and asks you to \"send back the updated version when done\". You notice it came from her personal email address, not the clinic's.",
          question: "What is the concern, and how do you handle the reply?",
          answer: "Patient information is now in a personal mailbox that the clinic does not control, and replying would put it there again. Do not reply with the file. Tell your lead and ask the client for the approved way to return it, such as the portal or the clinic's own system. The contact may also need to be told that the channel is not approved, in the way the client prefers.",
        },
      ],
    },
    {
      id: "scenario-quiz",
      title: "Try it: the friendly quiz",
      blocks: [
        {
          type: "scenario",
          title: "A fun post",
          prompt: "A post on social media invites you to share your first job, the name of your first pet and the street you grew up on \"for a fun personality quiz\".",
          choices: [
            { text: "Join in. It is only a bit of fun.", feedback: "Those answers are the same as many security questions. They help attackers reset accounts.", best: false },
            { text: "Skip it, and avoid sharing details that double as security answers.", feedback: "Correct. Quizzes like this harvest answers to account recovery questions.", best: true },
          ],
        },
      ],
    },
  ],
};

export const browsingQuestions: QuestionSeed[] = [
  q("browsing", "Links", "single", "How can you see where a link really goes?", ["Hover over it, or press and hold on a phone, and read the address", "Click it and see", "Ask the sender to confirm by replying to the same message", "It always matches the text"], [0], "The visible text of a link can differ from the real address. Hovering shows where it leads."),
  q("browsing", "Links", "single", "Which web address belongs to the company that owns \"shop.example\"?", ["www.shop.example/login", "shop.example.secure-login.test/signin", "shop-example.login.test", "shopp.example/login"], [0], "The part just before the first single slash decides who owns an address. Only the first belongs to shop.example: the others are owned by other names, or are one letter off."),
  q("browsing", "Padlock", "single", "A site shows a padlock. What does that tell you?", ["The connection is encrypted, but the site may still be fake", "The site is genuine", "The site has no malware", "The owner has been verified by the government"], [0], "A padlock means a private connection, not an honest site."),
  q("browsing", "Downloads", "single", "A document asks you to \"enable macros\" to view it. What is the safest response?", ["Do not enable them, and report the file if it was unexpected", "Enable them, since the document is needed", "Enable them for this one time", "Forward it to a colleague to open"], [0], "Macros are a common way to run malware. Be wary of any file that asks you to turn them on."),
  q("browsing", "Extensions", "single", "Why can a browser extension be risky?", ["It can read what you do and see what is on your screen", "It makes the page load slower only", "It changes the color of the page", "It stops updates from working"], [0], "Extensions can see and change what you do in the browser, which is why only approved ones should be installed."),
  q("browsing", "Social media", "multiple", "Which of these should stay off public social media? Select all that apply.", ["Client names and work systems", "Screenshots of your work screen", "Details of your role that explain who you report to", "A photo of your lunch"], [0, 1, 2], "Work details help attackers build convincing messages. A lunch photo does not."),
  q("browsing", "Social media", "single", "A quiz online asks for your first pet's name and the street you grew up on. Why avoid answering?", ["They are common answers to account recovery questions", "They take too long to type", "They are not interesting", "They will slow your device"], [0], "Quizzes like this harvest answers that help attackers reset accounts."),
  q("browsing", "AI tools", "single", "Which is appropriate to paste into a public AI chatbot?", ["A general question with no work, client or personal details", "A client's contact list", "A password", "A screenshot of a work record"], [0], "Anything typed into a public tool is shared with a stranger. Only paste what you would be happy to publish."),
  q("browsing", "AI tools", "single", "You want to translate a paragraph that contains client details. What is the right choice?", ["Do not paste it into an online tool; ask your lead for an approved way", "Paste it into a free online translator", "Paste it into a public AI chatbot", "Email it to yourself and translate it later"], [0], "Pasting work or client information into a public tool discloses it to an unapproved party."),
  q("browsing", "Contacts", "single", "A stranger on a networking site asks detailed questions about your work systems. What do you do?", ["Do not answer, and tell your lead if it seems targeted", "Answer politely", "Share only what is not secret", "Send them a screenshot to be helpful"], [0], "Detailed questions about your work from a stranger are a common way to prepare an attack."),
  q("browsing", "Channels", "single", "A client contact emails patient information from a personal email address and asks you to reply with the updated file. What is the best response?", ["Do not reply with the file, tell your lead, and ask for the approved way", "Reply, since they asked", "Reply with the names removed", "Forward it to your own email first"], [0], "A personal mailbox is outside the client's control. Use the approved channel."),
  q("browsing", "Channels", "single", "A patient asks you to text her appointment details. What is the right approach?", ["Follow the client's messaging policy and the patient's recorded preferences", "Text from your personal phone", "Tell her HIPAA forbids texting", "Send everything including the diagnosis"], [0], "Allowed channels and content are set by the client's policy and the patient's recorded preferences."),
  q("browsing", "Fax", "single", "Which habit reduces the risk of faxing patient information to the wrong place?", ["Confirming the number from a reliable source and checking receipt", "Sending to every number you think might be right", "Leaving it in the tray until later", "Faxing it twice"], [0], "A wrong number sends information to a stranger. Confirm the destination before sending."),
  q("browsing", "Voicemail", "single", "What is the best content for a voicemail reminder?", ["A callback number and the clinic's name, as the client's script allows", "The reason for the visit", "The test result", "The patient's full date of birth"], [0], "Voicemail can be heard by others. Share as little as possible."),
  q("browsing", "Shared inbox", "true_false", "True or false: A shared inbox that everyone on the team can open is a good place to keep patient lists.", ["True", "False"], [1], "Access should be limited to what each person's job needs."),
  q("browsing", "Forwarding", "single", "You are about to forward a message thread that includes patient details to someone new. What should you check first?", ["That they are authorized and need it, and that the thread holds only the minimum", "That the subject is short", "That it is a weekday", "That it has an attachment"], [0], "A forward carries everything below it. Check the recipient and the content."),
];
