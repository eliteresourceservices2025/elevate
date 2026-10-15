import { q, type CourseModule, type QuestionSeed } from "../schema";

// Cybersecurity course, new module (version 2): how everyday security habits connect to HIPAA. Plain connection only: the legal
// content is in the HIPAA course. All people and details in examples are invented.

export const securityHipaaModule: CourseModule = {
  key: "security_hipaa",
  title: "Security and HIPAA together",
  summary: "How the habits in this course carry out HIPAA's Security Rule, why training is itself a requirement, and a daily check you can use.",
  estimatedMinutes: 8,
  tracks: ["full"],
  keyPoints: [
    "The Security Rule asks for administrative, physical and technical safeguards, and your daily habits are part of all three.",
    "Training is itself a requirement of HIPAA, so completing it is part of the organization's compliance.",
    "A habit that fails can turn a security slip into a reportable breach.",
    "Report fast: the deadlines start when anyone in the workforce knows.",
    "A short daily check keeps the habits in place.",
  ],
  screens: [
    {
      id: "why-connect",
      title: "Why the two courses belong together",
      blocks: [
        { type: "paragraph", text: "The HIPAA course explains what the law asks of ERS and its clients. This course explains how people actually do it: with a strong password, a careful click and a locked screen. HIPAA's Security Rule is the point where the two meet." },
        { type: "callout", tone: "info", text: "You do not need to memorize rule numbers. You need to see that each habit has a reason, and that the reason is a legal duty your organization carries." },
      ],
    },
    {
      id: "map",
      title: "Each habit, and the safeguard it carries out",
      blocks: [
        {
          type: "table",
          caption: "Habits and the Security Rule",
          columns: ["Habit", "What it protects", "Kind of safeguard"],
          rows: [
            ["Strong, unique passwords and a second sign-in step", "Only the right person gets in", "Technical"],
            ["Spotting phishing and reporting it", "Stops attackers from getting a login", "Administrative: training"],
            ["Installing updates, avoiding unapproved software", "Closes holes and keeps malware out", "Technical and administrative"],
            ["Locking the screen and keeping a tidy desk", "Others cannot see or touch information", "Physical"],
            ["Using only approved tools and channels", "Information stays within agreements", "Administrative and technical"],
            ["Reporting a lost device or a mistake at once", "Lets the organization act before harm grows", "Administrative: incident response"],
          ],
        },
      ],
    },
    {
      id: "training-is-required",
      title: "Training is itself a requirement",
      blocks: [
        { type: "paragraph", text: "HIPAA requires organizations to train their whole workforce on the policies that apply to their jobs, and to document that training. The Security Rule adds specific topics: security reminders, protection from malicious software, log-in monitoring and password management." },
        { type: "paragraph", text: "When you finish this course, a record is kept. That record is one of the things a client or a regulator can ask ERS to show." },
      ],
    },
    {
      id: "when-habit-fails",
      title: "When a habit fails",
      blocks: [
        { type: "paragraph", text: "Most breaches start as a small slip that a habit could have stopped. Here is how a single click can travel:" },
        {
          type: "timeline",
          title: "From one click to a reportable event",
          items: [
            { when: "The slip", text: "A convincing email gets a click, and a password is typed into a fake page." },
            { when: "A little later", text: "The attacker signs in as you, and no second step stops them." },
            { when: "Hours or days", text: "They read, copy or lock information the account can reach." },
            { when: "When it is noticed", text: "The organization must assess it, and may have to notify the client, patients and HHS." },
          ],
        },
        { type: "callout", tone: "tip", text: "Each earlier step is a place a habit could have broken the chain: noticing the email, using a second sign-in step, or reporting a strange prompt." },
      ],
    },
    {
      id: "case-prompt",
      title: "Worked case: the prompt at midnight",
      blocks: [
        {
          type: "case",
          title: "A sign-in approval you did not start",
          scenario: "At 11:40 pm your phone shows a sign-in approval request for your work account. You are not signing in. It repeats four times in ten minutes, and then a message says: \"IT here, please approve the request to stop the alerts.\"",
          question: "What do you do, and why does it matter beyond you?",
          answer: "Do not approve it, and do not reply. A request you did not start means someone has your password and is trying to get past the second step. Change your password the official way and report it to your lead and HR right away, even at night. It matters beyond you because the account may reach client systems, and the organization's clock for any needed notification starts when the workforce knows.",
        },
      ],
    },
    {
      id: "speed",
      title: "Why speed is part of security",
      blocks: [
        { type: "paragraph", text: "A breach is treated as discovered on the first day anyone in the workforce knows of it, or would have known with reasonable care. The organization's own deadlines run from then, and clients' contracts are often much shorter than the legal limit." },
        { type: "callout", tone: "warning", text: "Waiting a day to \"be sure\" is not neutral. It uses time that belongs to the client, and it can turn a contained problem into a reportable one." },
      ],
    },
    {
      id: "daily-check",
      title: "A ten-second daily check",
      blocks: [
        { type: "paragraph", text: "Use this at the start of every work session:" },
        {
          type: "steps",
          items: [
            { title: "Place", text: "Is this a private place where screens and calls cannot be seen or heard?" },
            { title: "Device", text: "Is it updated, locked when I step away, and one I am allowed to use?" },
            { title: "Sign-in", text: "Is it my own login, with the second step on?" },
            { title: "Tools", text: "Am I using only approved tools and channels?" },
            { title: "Report", text: "If anything looked wrong yesterday, have I reported it?" },
          ],
        },
      ],
    },
    {
      id: "scenario-shortcut",
      title: "Try it: the shortcut",
      blocks: [
        {
          type: "scenario",
          title: "Disabling the lock",
          prompt: "Your laptop locks after five minutes of no activity, and it is annoying when you are reading long documents. A teammate shows you a setting that turns the lock off.",
          choices: [
            { text: "Turn it off while you read, and turn it back on later.", feedback: "An unlocked, unattended screen is exactly what the automatic lock is for.", best: false },
            { text: "Leave it on, and ask your lead if the time can be changed through the approved settings.", feedback: "Correct. The control stays, and the right person can adjust it properly.", best: true },
            { text: "Turn it off only at home.", feedback: "Home is still a place others can walk past, and the rule follows the information.", best: false },
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
            { term: "Safeguard", meaning: "A measure, administrative, physical or technical, that protects information." },
            { term: "Security Rule", meaning: "The HIPAA rule that requires safeguards for electronic protected health information." },
            { term: "Workforce training", meaning: "The training HIPAA requires every organization to give and document." },
            { term: "Discovery", meaning: "The first day a breach is known, or would have been known with reasonable care." },
          ],
        },
      ],
    },
  ],
};

export const securityHipaaQuestions: QuestionSeed[] = [
  q("security_hipaa", "Connection", "single", "Which statement best describes how this course relates to the HIPAA Security Rule?", ["Its habits carry out the safeguards the Security Rule asks organizations to put in place", "It replaces the Security Rule", "It has nothing to do with HIPAA", "It applies only to paper records"], [0], "Everyday security habits are how administrative, physical and technical safeguards work in practice."),
  q("security_hipaa", "Safeguards", "single", "Locking your screen when you step away is best described as which kind of safeguard?", ["Physical", "Administrative", "Legal", "Financial"], [0], "Controlling who can see or reach a workstation is a physical safeguard."),
  q("security_hipaa", "Safeguards", "single", "Using a second sign-in step is best described as which kind of safeguard?", ["Technical", "Physical", "Administrative", "Marketing"], [0], "Authentication measures are technical safeguards."),
  q("security_hipaa", "Training", "single", "Why does ERS keep a record that you completed this training?", ["HIPAA requires organizations to train and document it, and clients may ask to see it", "To rank staff", "To set pay", "To track personal time"], [0], "Workforce training and its documentation are part of HIPAA compliance."),
  q("security_hipaa", "Training", "multiple", "Which topics does the Security Rule name for security awareness training? Select all that apply.", ["Security reminders", "Protection from malicious software", "Log-in monitoring", "Choosing a company logo"], [0, 1, 2], "The rule names reminders, protection from malicious software, log-in monitoring and password management."),
  q("security_hipaa", "When a habit fails", "single", "An attacker signs in with a stolen password because no second step was set up. What does this show?", ["A missing technical safeguard let a small slip become a bigger event", "That passwords are unnecessary", "That the attacker was unlucky", "That nobody can be responsible"], [0], "A second step would have stopped the stolen password from being enough."),
  q("security_hipaa", "Sign-in prompt", "single", "You get repeated sign-in approval requests you did not start. What do you do?", ["Do not approve, change your password the official way, and report it", "Approve one to make them stop", "Reply to the message asking for the approval", "Ignore it until morning"], [0], "Unrequested prompts mean someone has your password. Do not approve, and report."),
  q("security_hipaa", "Speed", "single", "Why does the timing of a report matter for HIPAA?", ["Deadlines for notification run from when anyone in the workforce knows", "Reports are only read on Mondays", "Nobody reads them", "It matters only to the person who reports"], [0], "A breach is considered discovered when anyone in the workforce knows, so a delay uses the organization's time."),
  q("security_hipaa", "Controls", "single", "A control that locks your screen after a few minutes gets in your way. What is the right response?", ["Keep it on and ask your lead about changing the time through the approved settings", "Turn it off while you read", "Turn it off at home", "Ask a coworker how to bypass it"], [0], "The control is a safeguard. Changes go through the approved route."),
  q("security_hipaa", "Daily check", "multiple", "Which of these belong in a quick check at the start of a work session? Select all that apply.", ["Is my place private?", "Am I signed in with my own login and second step?", "Am I using only approved tools?", "Is my desktop wallpaper nice?"], [0, 1, 2], "Place, sign-in and tools are checks. Wallpaper is not."),
  q("security_hipaa", "Reporting", "true_false", "True or false: If something looked wrong yesterday and you did not report it, it is too late and not worth mentioning.", ["True", "False"], [1], "Report it now. Late reports are better than none, and honest ones are protected."),
  q("security_hipaa", "Habits", "single", "Which habit most directly helps stop an attacker from getting a login in the first place?", ["Spotting and reporting phishing messages", "Choosing a bright wallpaper", "Sharing your password with a trusted teammate", "Turning off updates"], [0], "Phishing is how most logins are stolen. Spotting it breaks the chain at the first step."),
];
