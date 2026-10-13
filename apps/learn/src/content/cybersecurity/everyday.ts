import { q, type CourseModule, type QuestionSeed } from "../schema";

// Cybersecurity course, module 2: everyday habits. Moved out of the HIPAA course, which covers only what HIPAA itself says.
// General good practice (not HIPAA text); ERS and client rules are the floor and may be stricter. Invented examples only.

export const everydayModule: CourseModule = {
  key: "everyday",
  title: "Everyday cybersecurity habits",
  summary: "Passwords, sign-in codes, updates, your home network and public places: the habits that keep your work and devices safe.",
  estimatedMinutes: 12,
  tracks: ["full"],
  keyPoints: [
    "Long, unique passphrases and a second sign-in step stop most account takeovers.",
    "Install updates and keep security software on.",
    "Secure your router and use only networks your client allows for work.",
    "Do not install software or connect devices you were not told to use.",
    "If something looks wrong, report it quickly. You will not be blamed for speaking up.",
  ],
  screens: [
    {
      id: "why",
      title: "Why these habits matter",
      blocks: [
        { type: "paragraph", text: "Most attacks do not break into a computer by force. They use weak passwords, old software and tired people. A few steady habits close most of those doors." },
        { type: "callout", tone: "info", text: "ERS and your clients set the rules for work. These habits are the baseline underneath them, and they protect your own accounts too." },
      ],
    },
    {
      id: "passwords",
      title: "Passwords that hold up",
      blocks: [
        { type: "paragraph", text: "Length beats complexity. A passphrase of several unrelated words is stronger and easier to remember than a short password full of symbols." },
        {
          type: "compare",
          left: { title: "Do", items: ["Use a long passphrase, different for every account", "Use a password manager if your client allows one", "Change a password at once if you think it leaked"] },
          right: { title: "Do not", items: ["Reuse your work password anywhere else", "Share it, even with someone from IT", "Keep it on a sticky note or in a chat"] },
        },
      ],
    },
    {
      id: "mfa",
      title: "The second step",
      blocks: [
        { type: "paragraph", text: "**Multi-factor authentication (MFA)** adds a second proof, such as a code from an app. Even if someone steals your password, they still cannot sign in." },
        { type: "callout", tone: "warning", title: "Prompts you did not start", text: "If you receive a sign-in prompt or code you did not ask for, deny it and report it. Attackers send many prompts hoping you will approve one to make them stop." },
        {
          type: "check",
          question: "You get a sign-in approval request while you are not signing in. What do you do?",
          options: [
            { text: "Deny it and report it to your lead", correct: true, feedback: "Right. An unexpected prompt means someone may have your password." },
            { text: "Approve it to make it stop", correct: false, feedback: "That would let the attacker in." },
            { text: "Ignore it", correct: false, feedback: "It should be reported so the account can be protected." },
          ],
        },
      ],
    },
    {
      id: "updates",
      title: "Updates and security software",
      blocks: [
        { type: "paragraph", text: "Updates close holes that attackers already know about. Install them when your device asks, and keep the security software ERS or your client provided turned on." },
        {
          type: "list",
          items: [
            "Restart when an update asks you to, at a safe moment.",
            "Do not turn off security software to make something run faster.",
            "Install only software you were told to install.",
            "Do not plug in unknown USB drives, even if you find one.",
          ],
        },
      ],
    },
    {
      id: "home-network",
      title: "Your home network",
      blocks: [
        { type: "paragraph", text: "Your router is the front door to everything you do from home. Make it hard to open:" },
        {
          type: "list",
          items: [
            "Change the router's default admin password.",
            "Use WPA2 or WPA3 security and a strong Wi-Fi password.",
            "Keep the router's software updated.",
            "Do not let guests onto the same network you use for work if you can use a guest network instead.",
          ],
        },
      ],
    },
    {
      id: "public",
      title: "Public places and public Wi-Fi",
      blocks: [
        { type: "paragraph", text: "Public Wi-Fi can be watched or imitated, and public rooms put your screen in view of strangers." },
        { type: "paragraph", text: "Do not do client work on public Wi-Fi unless your client provides a secure connection for it and you are in a private space. If your internet is down, tell your lead rather than improvising." },
      ],
    },
    {
      id: "devices",
      title: "Shared and personal devices",
      blocks: [
        { type: "paragraph", text: "A device you use for work should be used only by you. Family members, friends and shared computers bring their own software, habits and accounts into the same machine." },
        {
          type: "scenario",
          title: "A sibling asks to borrow your work laptop",
          prompt: "Your sibling's laptop is broken and they ask to use yours to finish an assignment, \"just for ten minutes\".",
          choices: [
            { text: "Let them, but stay beside them.", feedback: "Even supervised use adds risk, and your work accounts are signed in.", best: false },
            { text: "Say no kindly, and suggest another option.", feedback: "Correct. A work device is for work and for you only.", best: true },
          ],
        },
      ],
    },
    {
      id: "report",
      title: "Speak up early",
      blocks: [
        { type: "paragraph", text: "Anyone can click something they should not have, or lose a device. What matters is how fast you tell someone." },
        {
          type: "steps",
          items: [
            { title: "Stop", text: "Do not try to fix it quietly." },
            { title: "Tell", text: "Your team lead and HR, right away." },
            { title: "Keep evidence", text: "Do not delete the message or file." },
          ],
        },
      ],
    },
  ],
};

export const everydayQuestions: QuestionSeed[] = [
  q("everyday", "Passwords", "single", "Which is the strongest choice for a password?", ["A long passphrase of several unrelated words", "Your birth date", "The word \"Password1!\"", "Your pet's name"], [0], "Length and unpredictability matter most. A long passphrase of unrelated words is both strong and memorable."),
  q("everyday", "Passwords", "true_false", "True or false: It is fine to use the same password for your work account and your personal accounts if it is a strong one.", ["True", "False"], [1], "If one site leaks the password, every account that shares it is exposed. Use a different one for each."),
  q("everyday", "MFA", "single", "You receive a sign-in approval prompt on your phone that you did not start. What should you do?", ["Deny it and report it to your lead right away", "Approve it to make the prompts stop", "Ignore it and keep working", "Approve it, then change your password tomorrow"], [0], "An unexpected prompt may mean someone has your password. Deny it and report it."),
  q("everyday", "MFA", "single", "What does multi-factor authentication add?", ["A second proof of identity, so a stolen password alone is not enough", "A faster way to sign in", "A backup copy of your files", "A way to share your account safely"], [0], "MFA requires something beyond the password, so a stolen password alone cannot sign in."),
  q("everyday", "Updates", "single", "Your computer asks to install a security update. What is the best response?", ["Install it at the next safe moment and restart when asked", "Postpone it for months", "Turn off updates so you are not interrupted", "Ask a coworker to ignore it for you"], [0], "Updates close holes attackers already know about."),
  q("everyday", "Software", "single", "A website offers a free tool that would make your work faster. What should you do?", ["Do not install it; ask your lead if it is approved", "Install it, since it is free", "Install it on your personal phone instead and copy files across", "Install it and tell nobody"], [0], "Install only software you were told to use. Unknown tools can hide malware or capture information."),
  q("everyday", "Home network", "single", "Which of these makes your home Wi-Fi safer?", ["Changing the router's default password and using WPA2 or WPA3", "Keeping the default router password", "Leaving the network open", "Turning off all updates"], [0], "A strong router password and modern Wi-Fi security reduce the chance of break-ins."),
  q("everyday", "Public Wi-Fi", "single", "Your home internet is down and you have client work to do. What is the best choice?", ["Tell your lead and wait for a secure connection, or use an option your client provides", "Use free public Wi-Fi at a cafe", "Use a neighbor's open network", "Use a personal hotspot you do not control"], [0], "Public and open networks are not safe for client work. Ask for help and use only allowed secure options."),
  q("everyday", "USB drives", "single", "You find a USB drive in a parking lot. What should you do?", ["Do not plug it in; hand it to your lead or IT", "Plug it in to find the owner", "Plug it in on a spare computer", "Keep it for personal use"], [0], "Unknown USB drives are a common way to deliver malware."),
  q("everyday", "Shared devices", "single", "A family member asks to use your work laptop for ten minutes. What is the right answer?", ["Kindly decline; a work device is only for you and for work", "Agree if you sit beside them", "Agree if you sign out of your accounts first", "Agree but only for schoolwork"], [0], "Other people's accounts, software and habits make the device less safe, and your work access may still be reachable."),
  q("everyday", "Reporting", "single", "You realize you installed an unapproved program on your work computer yesterday. What should you do?", ["Report it to your lead right away", "Uninstall it and say nothing", "Wait to see if anything happens", "Ask a friend whether it is safe"], [0], "Report it so it can be checked. Quietly removing it hides what may already have happened."),
  q("everyday", "Passwords", "single", "A person from \"IT\" calls and asks for your password so they can fix your account. What do you do?", ["Refuse, hang up, and report the call", "Give it, since they know your name", "Give half of it", "Ask them to email you first"], [0], "Real IT staff never need your password. This is a social engineering attempt."),
];
