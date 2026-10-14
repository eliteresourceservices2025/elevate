import { q, type CourseModule, type QuestionSeed } from "../schema";

// Cybersecurity course, module 1. General good practice for everyone at ERS (not HIPAA text). Sources: docs/learn/09-cybersecurity-sources.md.

export const whyModule: CourseModule = {
  key: "why",
  title: "Why security is everyone's job",
  summary: "What attackers want, why ordinary people are the target, and the four habits that stop most attacks.",
  estimatedMinutes: 9,
  tracks: ["full"],
  keyPoints: [
    "Attackers go after people because it is easier than breaking in by force.",
    "Four habits stop most attacks: spot phishing, use strong passwords, turn on a second sign-in step, install updates.",
    "Mistakes are normal. Hiding them is what makes them expensive.",
    "Insiders are a risk too, mostly by accident. Report anything that looks wrong.",
    "Healthcare organizations are targeted because patient information and disrupted care are valuable to attackers.",
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
      id: "why-healthcare",
      title: "Why healthcare is a target",
      blocks: [
        { type: "paragraph", text: "Attackers know that a clinic cannot simply close for a week. Patients need appointments, prescriptions and records, so pressure to pay or to act quickly is high. Patient files also hold names, dates of birth, insurance numbers and addresses, which are useful for fraud and last a long time." },
        {
          type: "layers",
          title: "What makes healthcare attractive",
          items: [
            { label: "Urgency", text: "Care cannot wait, so downtime is costly and people feel pressure." },
            { label: "Rich records", text: "One file can hold identity, insurance and medical details." },
            { label: "Many connections", text: "Clinics, labs, billers and vendors all exchange information." },
            { label: "Busy people", text: "Staff handle many messages and calls, and click fast." },
          ],
        },
      ],
    },
    {
      id: "small-slip",
      title: "Worked case: a small slip, a large week",
      blocks: [
        {
          type: "case",
          title: "How one message disrupted a clinic",
          scenario: "A scheduler at a small clinic received an email that looked like a notice from the billing software. She entered her login on the page it linked to. Two days later the clinic's computers showed a message demanding payment, appointment screens were blank, and staff had to call patients to reschedule.",
          question: "Where could the chain have been broken, and by whom?",
          answer: "At several points. The scheduler could have noticed that the link did not go to the real site, or that a login was being requested out of the blue. A second sign-in step would have stopped the stolen password from being enough. A report within minutes of clicking would have let the clinic change the password and watch for damage. Most of those steps are simple habits, which is why this course is about everyone, not only about IT.",
        },
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
  q("why", "Healthcare", "single", "Why are healthcare organizations attractive targets for attackers?", ["Care cannot wait, so pressure is high, and records hold valuable personal information", "Their buildings are large", "They have no computers", "They never use email"], [0], "Urgency and rich, lasting records make healthcare a common target."),
  q("why", "Healthcare", "multiple", "Which of these make a clinic's information valuable to attackers? Select all that apply.", ["It combines identity and insurance details", "It stays useful for a long time", "Downtime puts pressure on the clinic to act fast", "It is always stored on paper only"], [0, 1, 2], "Identity plus insurance details last long, and downtime creates pressure to pay or comply."),
  q("why", "Chain of events", "single", "A person enters a work password on a page reached from an unexpected email. Which later habit could still limit the damage?", ["A second sign-in step, and reporting the click immediately", "Waiting to see if anything happens", "Deleting the email and saying nothing", "Changing nothing"], [0], "A second step can stop a stolen password being enough, and fast reporting lets the organization respond."),
  q("why", "Everyone", "single", "Why is security described as everyone's job and not only IT's?", ["Most attacks begin with an ordinary person's click, call or reply", "IT staff are not available", "Only large companies have IT", "Security is only about hardware"], [0], "Attackers go after people, so people are part of the defense."),
  q("why", "Pressure", "single", "A message says an account will close in one hour unless you click. What is the most useful thing to know?", ["Urgency is a common tool of attackers, so slow down and verify another way", "Urgent messages are always legitimate", "You must click to be safe", "Clicking later is not possible"], [0], "Artificial urgency is meant to stop you thinking. Verify through an official route."),
];
