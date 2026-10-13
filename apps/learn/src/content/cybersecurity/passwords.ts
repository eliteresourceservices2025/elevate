import { q, type CourseModule, type QuestionSeed } from "../schema";

export const passwordsModule: CourseModule = {
  key: "passwords",
  title: "Passwords and signing in safely",
  summary: "Strong passphrases, password managers, the second sign-in step, and what to do when a prompt or a code is not yours.",
  estimatedMinutes: 9,
  tracks: ["full"],
  keyPoints: [
    "A long passphrase beats a short complicated password.",
    "Use a different password for every account, and a password manager to keep them.",
    "Turn on a second sign-in step wherever it is offered. An app or a security key is stronger than a text message.",
    "Never share a password or a code. No real support person asks for either.",
    "If a prompt or code is not yours, deny it and report it.",
  ],
  screens: [
    {
      id: "how-attacks-work",
      title: "How passwords get stolen",
      blocks: [
        { type: "paragraph", text: "Attackers rarely guess one password by hand. They use lists of leaked passwords from other sites, programs that try thousands of guesses, and fake login pages that capture what you type." },
        {
          type: "list",
          items: [
            "**Reuse**: the password leaked from one site is tried on every other site.",
            "**Guessing**: short or predictable passwords fall to automatic guessing.",
            "**Phishing**: a fake page asks you to type it yourself.",
            "**Sharing**: a person gives it away, often to someone pretending to help.",
          ],
        },
      ],
    },
    {
      id: "passphrases",
      title: "Length beats complexity",
      blocks: [
        { type: "paragraph", text: "A **passphrase** of several unrelated words is longer, stronger and easier to remember than a short password full of symbols. The longer, the better." },
        {
          type: "compare",
          left: { title: "Strong", items: ["Four or more unrelated words, joined together", "Different for every account", "Not about you: no names, dates or pets", "Changed when you think it leaked"] },
          right: { title: "Weak", items: ["A name, a birthday or a favorite team", "A common word with a number on the end", "The same password on many sites", "Something written on a sticky note"] },
        },
      ],
    },
    {
      id: "managers",
      title: "Password managers",
      blocks: [
        { type: "paragraph", text: "No one can remember dozens of long, unique passwords. A **password manager** remembers them for you, fills them in only on the real website, and creates new random ones." },
        {
          type: "list",
          items: [
            "It needs one strong passphrase of your own, and a second sign-in step on it.",
            "It will not fill in a password on a fake site, which is a useful warning in itself.",
            "Use the one your client or ERS provides. If none is provided, ask your lead before using another.",
          ],
        },
        { type: "callout", tone: "tip", text: "Do not keep passwords in a notes file, a spreadsheet, a chat or an email. Those are the first places an attacker looks." },
      ],
    },
    {
      id: "mfa",
      title: "The second step",
      blocks: [
        { type: "paragraph", text: "**Multi-factor authentication (MFA)** asks for something besides the password: a code from an app, a prompt on your phone, a security key, or a fingerprint. If someone steals your password, they still cannot sign in." },
        {
          type: "steps",
          items: [
            { title: "Security key or passkey", text: "The strongest: cannot be typed into a fake page." },
            { title: "Authenticator app", text: "A code that changes every half minute." },
            { title: "Text message or call", text: "Better than nothing, but easier to attack." },
          ],
        },
        { type: "callout", tone: "info", text: "Any second step is far better than none. Turn it on for work accounts, email and anything with money or personal details." },
      ],
    },
    {
      id: "prompt-bombing",
      title: "Prompts and codes you did not ask for",
      blocks: [
        { type: "paragraph", text: "If someone has your password, they will try to sign in. You then get a sign-in prompt or a code you did not request. Attackers may send many in a row, hoping you approve one to make them stop. This is sometimes called **MFA fatigue**." },
        {
          type: "check",
          question: "You get a sign-in approval request while you are not signing in. What do you do?",
          options: [
            { text: "Deny it and report it to your lead", correct: true, feedback: "Right. An unexpected prompt means someone may have your password." },
            { text: "Approve it to make it stop", correct: false, feedback: "That would let the attacker in." },
            { text: "Ignore it", correct: false, feedback: "It should be reported so the account can be protected." },
          ],
        },
        { type: "callout", tone: "warning", text: "Never read a code to anyone who contacts you, even someone who says they are from IT or from the bank." },
      ],
    },
    {
      id: "recovery",
      title: "If a password may have leaked",
      blocks: [
        { type: "paragraph", text: "If you think a password has been exposed, or you entered it on a page you now doubt:" },
        {
          type: "steps",
          items: [
            { title: "Change it", text: "Through the official site or app, not through a link in a message." },
            { title: "Change it anywhere you reused it", text: "Reuse is how one leak becomes many." },
            { title: "Tell your lead", text: "So they can check for anything unusual and protect the rest." },
          ],
        },
      ],
    },
    {
      id: "scenario-it-call",
      title: "Try it: the helpful caller",
      blocks: [
        {
          type: "scenario",
          title: "A call from \"IT\"",
          prompt: "Someone calls and says he is from IT. \"Your account was flagged. I will send a code to your phone: read it back to me so I can fix it.\"",
          choices: [
            { text: "Read the code. He knows your name and account.", feedback: "Knowing a name proves nothing. The code lets him into your account.", best: false },
            { text: "Hang up, do not share anything, and report the call to your lead.", feedback: "Correct. No real IT person asks you to read a code or a password.", best: true },
            { text: "Ask him to prove it by reading your last login time.", feedback: "He may well know it. Do not try to test him: hang up.", best: false },
          ],
        },
      ],
    },
  ],
};

export const passwordsQuestions: QuestionSeed[] = [
  q("passwords", "Passphrases", "single", "Which is the strongest choice for a password?", ["A long passphrase of several unrelated words", "Your birth date", "The word \"Password1!\"", "Your pet's name"], [0], "Length and unpredictability matter most. A long passphrase of unrelated words is both strong and memorable."),
  q("passwords", "Reuse", "true_false", "True or false: It is fine to use the same strong password for your work account and your personal accounts.", ["True", "False"], [1], "If one site leaks the password, every account that shares it is exposed. Use a different one for each."),
  q("passwords", "Reuse", "single", "Why is reusing a password across sites dangerous?", ["A leak at one site lets attackers try it everywhere else", "It makes the password longer", "It slows your computer", "It is against copyright law"], [0], "Attackers try leaked passwords on other sites. Reuse turns one leak into many."),
  q("passwords", "Managers", "single", "What does a password manager do well?", ["Creates and remembers unique passwords and fills them in only on the real site", "Shares your passwords with your team", "Removes the need for any sign-in", "Stores passwords in a public notes file"], [0], "A password manager keeps unique passwords for you and warns you when a site is not the real one."),
  q("passwords", "Storage", "single", "Where is it safest to keep passwords?", ["In a password manager", "In a spreadsheet on your desktop", "In a chat with yourself", "On a sticky note under the keyboard"], [0], "A notes file, chat or note is the first place an attacker or snoop looks."),
  q("passwords", "MFA", "single", "What does multi-factor authentication add?", ["A second proof of identity, so a stolen password alone is not enough", "A faster way to sign in", "A backup copy of your files", "A way to share your account safely"], [0], "MFA requires something beyond the password, so a stolen password alone cannot sign in."),
  q("passwords", "MFA", "single", "Which second step is generally the strongest?", ["A security key or passkey", "A text message code", "A security question about your pet", "A shorter password"], [0], "Security keys and passkeys cannot be typed into a fake page, so they resist phishing best."),
  q("passwords", "Prompts", "single", "You receive a sign-in approval prompt on your phone that you did not start. What should you do?", ["Deny it and report it to your lead right away", "Approve it to make the prompts stop", "Ignore it and keep working", "Approve it, then change your password tomorrow"], [0], "An unexpected prompt may mean someone has your password. Deny it and report it."),
  q("passwords", "Codes", "single", "A person from \"IT\" calls and asks you to read out a code just sent to your phone. What do you do?", ["Refuse, hang up, and report the call", "Read it, since they know your name", "Read half of it", "Ask them to email you first"], [0], "Real IT staff never need your codes or passwords. This is a social engineering attempt."),
  q("passwords", "Leak", "single", "You typed your password on a page you now think was fake. What is the best first step?", ["Change it through the official site or app and tell your lead", "Wait and see if anything happens", "Close the browser and forget it", "Change it through the link on the page"], [0], "Change it by the official route, never through the suspicious page, and report it."),
];
