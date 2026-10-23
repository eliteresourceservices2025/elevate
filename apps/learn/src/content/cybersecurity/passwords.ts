import { q, type CourseModule, type QuestionSeed } from "../schema";

export const passwordsModule: CourseModule = {
  key: "passwords",
  title: "Passwords and signing in safely",
  summary: "Strong passphrases, password managers, the second sign-in step, and what to do when a prompt or a code is not yours.",
  estimatedMinutes: 16,
  tracks: ["full"],
  keyPoints: [
    "A long passphrase beats a short complicated password.",
    "Use a different password for every account, and a password manager to keep them.",
    "Turn on a second sign-in step wherever it is offered. An app or a security key is stronger than a text message.",
    "Never share a password or a code. No real support person asks for either.",
    "If a prompt or code is not yours, deny it and report it.",
    "A sign-in approval you did not start means someone has your password: do not approve it, and report it.",
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
      id: "mfa-fatigue-case",
      title: "Worked case: the approval that would not stop",
      blocks: [
        {
          type: "case",
          title: "Twelve prompts in ten minutes",
          scenario: "A VA's phone keeps showing \"Approve sign-in?\" notifications. She did not start any of them. After the twelfth one, she gets a text: \"This is the IT desk. Approve the next request so we can stop the alerts and secure your account.\" She is tired and wants the buzzing to stop.",
          question: "What should she do, and what does this tell her?",
          answer: "She should deny the requests, not reply, and report it to her lead right away. Someone already has her password and is trying to wear her down so that she approves one. A real IT desk would never ask her to approve a request she did not start. She should also change her password through the official route.",
        },
      ],
    },
    {
      id: "passkeys",
      title: "Passkeys and security keys",
      blocks: [
        { type: "paragraph", text: "Some services offer **passkeys** or physical **security keys**. They replace or strengthen the password with a cryptographic proof that stays on your device or key. They are hard to phish because there is no password to type into a fake page." },
        {
          type: "compare",
          left: { title: "Stronger", items: ["A passkey or security key", "An authenticator app code", "Number-matching prompts"] },
          right: { title: "Weaker", items: ["A text message code", "A simple \"approve\" tap", "No second step at all"] },
        },
        { type: "callout", tone: "tip", text: "Use the strongest option your client or ERS offers, and set up a second method in case you lose your device." },
      ],
    },
    {
      id: "shared-accounts",
      title: "Shared accounts, and why they are refused",
      blocks: [
        { type: "paragraph", text: "Sometimes a team shares one login \"to keep it simple\". It breaks the most basic control: nobody can tell who did what. If something goes wrong, nobody can be sure who was responsible, and nobody can close one person's access when they leave." },
        {
          type: "list",
          items: [
            "Each person gets their own account, even for a shared mailbox or tool.",
            "If a tool has only one login, ask your lead how access should be set up.",
            "Never accept a password in a chat, a note or a spreadsheet.",
            "Never hand a code to a teammate who asks for it.",
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
    {
      id: "stronger-weaker",
      title: "Quick sort: stronger or weaker second step?",
      blocks: [
        {
          type: "cards",
          title: "Stronger or weaker?",
          prompt: "Sort each sign-in choice by how well it protects you.",
          groups: ["Stronger", "Weaker"],
          cards: [
            { text: "A passkey or a security key", group: 0, feedback: "The strongest: it cannot be typed into a fake page." },
            { text: "A text message code", group: 1, feedback: "Better than nothing, but easier to attack." },
            { text: "An authenticator app code", group: 0, feedback: "A code that changes every half minute is a solid choice." },
            { text: "A simple \"approve\" tap", group: 1, feedback: "Easy to approve by mistake, or to wear down with repeated prompts." },
            { text: "A prompt that asks you to match a number", group: 0, feedback: "Number-matching prompts are stronger than a plain approve tap." },
            { text: "No second step at all", group: 1, feedback: "Any second step is far better than none." },
          ],
        },
      ],
    },
    {
      id: "it-desk-call",
      title: "Practice: the call from \"IT\"",
      blocks: [
        {
          type: "branch",
          title: "A caller who wants your code",
          intro: "Your phone rings. A man says he is from the IT desk and that your account was flagged. Pick what you say, and watch how the caller reacts.",
          startMood: 50,
          turns: [
            {
              caller: "This is the IT desk. Your account was flagged. I am sending a code to your phone. Read it back to me so I can fix it.",
              choices: [
                { text: "Read the code. He knows my name.", mood: -30, reply: "Thanks, that is all I needed. (He now has the code that lets him into your account.)" },
                { text: "I will not share a code. I am hanging up and reporting this call to my lead.", mood: 25, reply: "Wait, I am only trying to help... (The call ends. You did exactly the right thing.)" },
                { text: "Prove you are IT by telling me my last login time.", mood: -10, reply: "Of course, it was this morning. (He may well know that. Testing him does not make him safe.)" },
              ],
            },
            {
              caller: "If you hang up now, your account will be locked within ten minutes and you will not be able to work.",
              choices: [
                { text: "Give in, just this once.", mood: -30, reply: "Good. Now read me the code. (Pressure and a deadline are how it works.)" },
                { text: "End the call and tell my lead what was said.", mood: 25, reply: "(The line goes dead. A real IT desk never asks for a code, and a deadline is a warning sign.)" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "setup-check",
      title: "Check the setup: what puts accounts at risk?",
      blocks: [
        {
          type: "hotspot",
          title: "A teammate's sign-in habits",
          prompt: "A teammate describes how they handle sign-ins. Tap every habit that puts an account at risk, then check.",
          items: [
            { label: "Passwords", text: "Kept in a password manager with a long passphrase and a second step" },
            { label: "Reuse", text: "The same password for the work account and a personal shopping site", problem: true, why: "If one site leaks the password, every account that shares it is exposed." },
            { label: "Storage", text: "Client logins saved in a spreadsheet on the desktop", problem: true, why: "A notes file or spreadsheet is the first place an attacker looks." },
            { label: "Second step", text: "An authenticator app on every work account" },
            { label: "Team tool", text: "One login for the whole team \"to keep it simple\"", problem: true, why: "Nobody can tell who did what, and one person's access cannot be closed on its own." },
            { label: "Prompts", text: "Unexpected approval prompts are denied and reported to the lead" },
          ],
          explanation: "Strong sign-in habits are a password manager, a second step, one account per person and a quick report of anything unexpected.",
        },
      ],
    },
    {
      id: "quick-round-passwords",
      title: "Quick round: passwords and signing in",
      blocks: [
        {
          type: "game",
          title: "Sign-in sprint",
          seconds: 20,
          rounds: [
            {
              question: "Which is the better password?",
              options: [
                { text: "A long passphrase of several unrelated words", correct: true, feedback: "Length beats complexity." },
                { text: "Your birth date", correct: false, feedback: "Easy to guess." },
                { text: "The word Password1!", correct: false, feedback: "Short and predictable." },
              ],
            },
            {
              question: "A caller from \"IT\" asks you to read back a code. What do you do?",
              options: [
                { text: "Hang up and report it to your lead", correct: true, feedback: "No real IT person asks for a code." },
                { text: "Read it quickly", correct: false, feedback: "The code lets him into your account." },
                { text: "Ask him to prove it", correct: false, feedback: "He may well know the details. Do not test him." },
              ],
            },
            {
              question: "Twelve approval prompts arrive and you did not start any. What now?",
              options: [
                { text: "Deny them and report it", correct: true, feedback: "Someone may already have your password." },
                { text: "Approve one to make them stop", correct: false, feedback: "That lets the attacker in." },
                { text: "Ignore them", correct: false, feedback: "It should be reported so the account can be protected." },
              ],
            },
            {
              question: "You think a password leaked. What is the first thing to do?",
              options: [
                { text: "Change it through the official site or app", correct: true, feedback: "Then change it anywhere you reused it, and tell your lead." },
                { text: "Wait and see", correct: false, feedback: "Speed matters." },
                { text: "Change it through a link in a message", correct: false, feedback: "Always use the official site or app." },
              ],
            },
            {
              question: "Why are passkeys hard to phish?",
              options: [
                { text: "There is no password to type into a fake page", correct: true, feedback: "The proof stays on your device or key." },
                { text: "They are very long", correct: false, feedback: "Length is not the reason." },
                { text: "They are shared with the team", correct: false, feedback: "Never share them." },
              ],
            },
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
  q("passwords", "Unrequested prompts", "single", "Your phone shows several sign-in approval requests you did not start. What should you do?", ["Deny them and report it to your lead", "Approve one so they stop", "Reply to the message asking why", "Turn off the phone and say nothing"], [0], "Prompts you did not start mean someone has your password. Deny, and report."),
  q("passwords", "Unrequested prompts", "true_false", "True or false: A real IT desk may ask you to approve a sign-in request that you did not start in order to stop alerts.", ["True", "False"], [1], "A real IT desk would never ask you to approve a request you did not start."),
  q("passwords", "Passkeys", "single", "Why are passkeys and security keys harder to phish than passwords?", ["There is no password to type into a fake page, and the proof stays on the device or key", "They are longer", "They change every minute", "They are shared with IT"], [0], "A passkey is bound to the real site and to your device, so a fake page cannot collect it."),
  q("passwords", "Second step", "single", "Which second sign-in option is generally strongest?", ["A passkey or a security key", "A text message code", "A simple tap to approve", "No second step"], [0], "Passkeys and security keys resist phishing better than texts or taps."),
  q("passwords", "Shared accounts", "single", "A tool has only one login, and your team wants to share it. What is the best response?", ["Ask your lead how to give each person their own access", "Share the password in a team chat", "Put it on a sticky note", "Use it only at night"], [0], "Each person needs their own access so actions can be traced and access can end when work ends."),
  q("passwords", "Shared accounts", "multiple", "Which problems come from a shared login? Select all that apply.", ["Nobody can tell who did what", "One person's access cannot be closed on its own", "A leaked password affects everyone who shares it", "It makes the login stronger"], [0, 1, 2], "A shared login removes accountability and makes access hard to control."),
  q("passwords", "Codes", "single", "A caller says they are from IT and asks you to read out the code that just arrived on your phone. What do you do?", ["Refuse, end the call, and report it", "Read it quickly so they can fix the issue", "Read only the first three digits", "Text it to them instead"], [0], "A code is a password. No legitimate caller needs you to read it out."),
  q("passwords", "Weaker steps", "multiple", "Which of these are weaker second sign-in steps? Select all that apply.", ["A text message code", "A simple approve tap", "A passkey", "A security key"], [0, 1], "A text code is easier to attack, and a plain approve tap is easy to approve by mistake. Passkeys and security keys are the stronger choices."),
  q("passwords", "Managers", "single", "A password manager will not fill in your password on a page. What might that tell you?", ["The page may be fake, so stop and check", "The manager is broken and you should type it", "The password has expired", "Nothing at all"], [0], "A manager fills in passwords only on the real website, so a refusal is a useful warning."),
  q("passwords", "Shared accounts", "true_false", "True or false: Sharing one login across a team makes it easier to tell who did what.", ["True", "False"], [1], "A shared login breaks the most basic control: nobody can tell who did what."),
  q("passwords", "Reuse", "single", "After a password may have leaked, what should you do about other accounts that use the same one?", ["Change it there too, because reuse turns one leak into many", "Leave them, since only one site leaked", "Add a number to the end", "Wait a month"], [0], "Reuse is how one leak becomes many, so change it everywhere it was used and tell your lead."),
];
