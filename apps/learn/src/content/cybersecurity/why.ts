import { q, type CourseModule, type QuestionSeed } from "../schema";

// Cybersecurity course, module 1. General good practice for everyone at ERS (not HIPAA text). Sources: docs/learn/09-cybersecurity-sources.md.

export const whyModule: CourseModule = {
  key: "why",
  title: "Why security is everyone's job",
  summary: "What attackers want, why ordinary people are the target, and the four habits that stop most attacks.",
  estimatedMinutes: 6,
  tracks: ["full"],
  keyPoints: [
    "Attackers go after people because it is easier than breaking in by force.",
    "Four habits stop most attacks: spot phishing, use strong passwords, turn on a second sign-in step, install updates.",
    "Mistakes are normal. Hiding them is what makes them expensive.",
    "Insiders are a risk too, mostly by accident. Report anything that looks wrong.",
  ],
  screens: [
    {
      id: "what-attackers-want",
      title: "What attackers want",
      blocks: [
        { type: "paragraph", text: "Attackers are rarely after you personally. They want what your accounts can reach: money, customer and patient information, access to a company's systems, or simply a way to lock files and demand payment." },
        {
          type: "list",
          items: [
            "**Money**: payment fraud, fake invoices, ransomware.",
            "**Information**: records, logins and personal details that can be sold or used for fraud.",
            "**Access**: your account as a stepping stone to a client or a bigger target.",
            "**Disruption**: locking or destroying systems so people cannot work.",
          ],
        },
        { type: "callout", tone: "info", text: "Size does not protect anyone. Small teams and remote workers are targeted because they are easier to reach." },
      ],
    },
    {
      id: "people-first",
      title: "Why people are the target",
      blocks: [
        { type: "paragraph", text: "It is usually easier to trick a person than to break into a system. Most successful attacks start with a message, a call or a link that someone acted on without a second thought." },
        { type: "paragraph", text: "Attackers rely on a few feelings: urgency, fear, curiosity, and the wish to be helpful. A well-made message uses them on purpose." },
        {
          type: "check",
          question: "Why do attackers so often start with a person rather than a system?",
          options: [
            { text: "Tricking a person is usually easier than breaking in by force", correct: true, feedback: "Right. People are the easiest way in." },
            { text: "Systems have no passwords", correct: false, feedback: "Most systems do, which is why attackers want yours." },
            { text: "People never check what they click", correct: false, feedback: "Many do check. A convincing message only needs one person who does not." },
          ],
        },
      ],
    },
    {
      id: "four-habits",
      title: "Four habits that stop most attacks",
      blocks: [
        { type: "paragraph", text: "National cybersecurity agencies boil advice down to four things everyone can do. This course teaches each one:" },
        {
          type: "steps",
          items: [
            { title: "Recognize and report phishing", text: "Learn the warning signs before you click or share anything." },
            { title: "Use strong passwords", text: "Long, unique, and kept in a password manager." },
            { title: "Turn on a second sign-in step", text: "Multi-factor authentication, wherever it is offered." },
            { title: "Update your software", text: "Updates close holes attackers already know about." },
          ],
        },
      ],
    },
    {
      id: "big-picture",
      title: "How organizations think about it",
      blocks: [
        { type: "paragraph", text: "Security is not one tool. Organizations follow a simple cycle, and every person plays a part in each step:" },
        {
          type: "list",
          items: [
            "**Identify**: know what you have and what matters most.",
            "**Protect**: passwords, updates, training, locked doors.",
            "**Detect**: notice when something looks wrong.",
            "**Respond**: act quickly and tell the right people.",
            "**Recover**: restore from backups and learn from it.",
          ],
        },
        { type: "callout", tone: "tip", text: "You are most of \"protect\" and nearly all of \"detect\": you are the one who sees the odd message, the strange prompt, the file that behaves badly." },
      ],
    },
    {
      id: "insiders",
      title: "Mistakes and insiders",
      blocks: [
        { type: "paragraph", text: "An **insider threat** is a risk that comes from inside an organization: someone with legitimate access. Almost all of it is accidental: a wrong recipient, a lost laptop, a shared password, a click on the wrong link." },
        { type: "paragraph", text: "A small number are deliberate: someone copying information they should not, or misusing access. Warning signs include accessing things without a work reason, copying large amounts of information, and trying to get around controls." },
        { type: "callout", tone: "warning", text: "If you see something that looks wrong, report it to your lead. You do not have to be sure. Reporting is not accusing." },
      ],
    },
    {
      id: "no-blame",
      title: "Speed matters, blame does not",
      blocks: [
        { type: "paragraph", text: "Everyone makes mistakes. What decides the damage is how fast it is reported. A password changed within the hour is a small event. The same password left for a week can be a disaster." },
        {
          type: "scenario",
          title: "You think you made a mistake",
          prompt: "You clicked a link in a message and then realized it looked wrong. Nothing seems to have happened.",
          choices: [
            { text: "Say nothing. If nothing happened there is nothing to report.", feedback: "Attacks are often silent at first. A report now costs minutes; silence can cost much more.", best: false },
            { text: "Tell your lead straight away, say exactly what you did, and follow their instructions.", feedback: "Correct. Fast and honest is always right.", best: true },
            { text: "Delete the message so nobody sees it.", feedback: "Deleting it removes evidence that helps the response.", best: false },
          ],
        },
      ],
    },
  ],
};

export const whyQuestions: QuestionSeed[] = [
  q("why", "Attackers", "single", "Why do attackers target small teams and remote workers?", ["They are often easier to reach and less protected", "They hold the most money", "They are the only ones with passwords", "They are required to use weak security"], [0], "Size does not protect anyone. Smaller teams and remote workers are often easier to reach."),
  q("why", "Attackers", "multiple", "Which of these might an attacker want? Select all that apply.", ["Money", "Information that can be sold or used for fraud", "Access to other systems through your account", "Your favorite color"], [0, 1, 2], "Attackers want money, information and access, or to disrupt work. A favorite color is of no use to them."),
  q("why", "People", "single", "Which feelings do attackers most often use to rush people?", ["Urgency and fear", "Boredom", "Sleepiness", "Curiosity about the weather"], [0], "Urgency, fear, curiosity and the wish to be helpful are the usual levers."),
  q("why", "Four habits", "multiple", "Which of these are among the four core habits? Select all that apply.", ["Recognize and report phishing", "Use strong passwords", "Turn on multi-factor authentication", "Install updates"], [0, 1, 2, 3], "Spotting phishing, strong passwords, a second sign-in step and updates are the four core habits."),
  q("why", "Four habits", "single", "What does multi-factor authentication add to a password?", ["A second proof that you are you", "A longer password", "A faster login", "A backup of your files"], [0], "A second proof means a stolen password alone is not enough."),
  q("why", "Cycle", "single", "In the cycle Identify, Protect, Detect, Respond, Recover, which step is most about noticing something odd and speaking up?", ["Detect", "Identify", "Recover", "Protect"], [0], "Detect is noticing that something looks wrong, and people are often the first to notice."),
  q("why", "Insiders", "single", "Most insider-related incidents are:", ["Accidental, such as a wrong recipient or a click on a bad link", "Planned by senior managers", "Caused by fire", "Done by customers"], [0], "Most insider incidents are honest mistakes, which is why fast reporting matters so much."),
  q("why", "Insiders", "single", "You notice a coworker copying a large number of files they do not seem to need. What is the best action?", ["Report it to your lead without accusing anyone", "Confront them in public", "Ignore it", "Copy the files yourself to compare"], [0], "Reporting is not accusing. The lead can look at it properly."),
  q("why", "Reporting", "true_false", "True or false: If nothing seems to have happened after a mistake, you do not need to report it.", ["True", "False"], [1], "Attacks are often silent at first. Report anyway."),
  q("why", "Reporting", "single", "You realize you shared a password with someone who claimed to be from IT. What should you do first?", ["Tell your lead and change the password through the official way", "Wait and see", "Delete your browser history", "Tell no one in case you get in trouble"], [0], "Fast, honest reporting limits the damage."),
];
