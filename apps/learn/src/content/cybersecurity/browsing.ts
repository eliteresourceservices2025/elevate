import { q, type CourseModule, type QuestionSeed } from "../schema";

export const browsingModule: CourseModule = {
  key: "browsing",
  title: "Safe browsing, email and online privacy",
  summary: "Links, downloads, extensions, social media and AI tools: how to use the internet at work without handing attackers a way in.",
  estimatedMinutes: 8,
  tracks: ["full"],
  keyPoints: [
    "Check where a link really goes before you click. A padlock means the connection is private, not that the site is honest.",
    "Download only from approved sources, and be wary of free tools, extensions and add-ins.",
    "Keep work and personal accounts apart, and keep work details off social media.",
    "Do not paste work, client or personal information into public AI tools.",
    "What you post online can be used to trick you or your colleagues.",
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
];
