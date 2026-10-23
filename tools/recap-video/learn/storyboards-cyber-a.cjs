// Storyboards for the Cybersecurity recap videos, modules 1 to 5 (why, passwords, phishing, malware, browsing). Animated scenes with a few words
// on screen; the detail is in the narration (`say`). Every spoken line restates that module's lesson text: no new facts.
// Scene kinds are drawn in src/Cs.jsx and src/LearnScenes.jsx; what the voice says is read by customer-service/beats.cjs.
const { CYBER_OUTRO } = require("./shared.cjs");

const base = (n, module, title, tagline, icon) => ({ id: `cybersecurity-${module}`, course: "cybersecurity", module, n, count: 10, title, label: `CYBERSECURITY  |  MODULE ${n} OF 10`, tagline, icon, outroItems: CYBER_OUTRO });

module.exports = [
  {
    ...base(1, "why", "Why security is everyone's job", "Why people are the target, and what stops most attacks", "shield-check"),
    scenes: [
      {
        kind: "hero",
        icon: "shield-check",
        title: "Security is everyone's job",
        sub: "Attackers go after people",
        lead: "Attackers go after people because it is easier than breaking in by force.",
      },
      {
        kind: "icons",
        heading: "What attackers want",
        items: [
          { icon: "coins", label: "Money", say: "Money: payment fraud, fake invoices and ransomware." },
          { icon: "database", label: "Information", say: "Information: records, logins and personal details." },
          { icon: "key", label: "Access", say: "Access: your account as a stepping stone to a client." },
          { icon: "ban", label: "Disruption", say: "Disruption: locking systems so people cannot work." },
        ],
      },
      {
        kind: "flow",
        heading: "Four habits stop most attacks",
        items: [
          { big: "1", icon: "search", label: "Spot phishing", say: "Spot phishing." },
          { big: "2", icon: "lock", label: "Strong passwords", say: "Use strong passwords." },
          { big: "3", icon: "shield-check", label: "Second step", say: "Turn on a second sign-in step." },
          { big: "4", icon: "refresh-cw", label: "Updates", say: "Install updates." },
        ],
      },
      {
        kind: "icons",
        heading: "HHS's five main threats",
        cols: 5,
        lead: "HHS sorts the main threats to health care into five.",
        items: [
          { icon: "mail-warning", label: "Social engineering", say: "Social engineering." },
          { icon: "lock", label: "Ransomware", say: "Ransomware." },
          { icon: "laptop", label: "Lost or stolen", say: "Loss or theft of equipment or data." },
          { icon: "user-x", label: "Insider loss", say: "Insider data loss, accidental or intentional." },
          { icon: "activity", label: "Medical devices", say: "Attacks on network-connected medical devices that may affect patient safety." },
        ],
      },
      {
        kind: "compare",
        heading: "When something goes wrong",
        leftGood: true,
        left: { title: "Normal", items: [{ text: "Mistakes happen", say: "Mistakes are normal." }] },
        right: { title: "Expensive", items: [{ text: "Hiding them", say: "Hiding them is what makes them expensive." }] },
      },
    ],
  },
  {
    ...base(2, "passwords", "Passwords and signing in safely", "Long passphrases, a second step, and never sharing", "key-round"),
    scenes: [
      {
        kind: "hero",
        icon: "key-round",
        title: "Sign in safely",
        sub: "Length beats complexity",
        lead: "A long passphrase beats a short complicated password.",
      },
      {
        kind: "flow",
        heading: "How passwords get stolen",
        items: [
          { big: "1", icon: "repeat", label: "Reuse", say: "Reuse: a password leaked from one site is tried on every other site." },
          { big: "2", icon: "gauge", label: "Guessing", say: "Guessing: short or predictable passwords fall to automatic guessing." },
          { big: "3", icon: "mail-warning", label: "Phishing", say: "Phishing: a fake page asks you to type it yourself." },
          { big: "4", icon: "users", label: "Sharing", say: "Sharing: a person gives it away, often to someone pretending to help." },
        ],
      },
      {
        kind: "stack",
        heading: "The second sign-in step",
        items: [
          { icon: "smartphone", label: "Text message or call", sub: "better than nothing", say: "A text message or call is better than nothing, but easier to attack." },
          { icon: "clock", label: "Authenticator app", sub: "changes every half minute", say: "An authenticator app gives a code that changes every half minute." },
          { icon: "key-round", label: "Security key or passkey", sub: "the strongest", say: "A security key or passkey is the strongest: it cannot be typed into a fake page." },
        ],
      },
      {
        kind: "checklist",
        heading: "Codes and prompts",
        items: [
          { text: "Never share a password or a code", icon: "hand", say: "Never share a password or a code. No real support person asks for either." },
          { text: "Not yours? Deny it", icon: "x", say: "If a prompt or a code is not yours, deny it and report it." },
        ],
      },
    ],
  },
  {
    ...base(3, "phishing", "Phishing and social engineering", "Check it another way before you act", "mail-warning"),
    scenes: [
      {
        kind: "hero",
        icon: "mail-warning",
        title: "Phishing and social engineering",
        sub: "Urgency, fear and authority",
        lead: "Attackers target people, not only computers. Urgency, fear and authority are the usual tricks.",
      },
      {
        kind: "icons",
        heading: "The usual forms",
        items: [
          { icon: "mail", label: "Phishing", say: "Phishing: an email that pretends to be someone you trust." },
          { icon: "target", label: "Spear phishing", say: "Spear phishing: the same, but written for you." },
          { icon: "smartphone", label: "Smishing", say: "Smishing: the same by text message." },
        ],
      },
      {
        kind: "chain",
        heading: "Verify through a second channel",
        items: [
          { icon: "mail-warning", label: "A request", sub: "money, access or patient information", say: "When a request asks for money, access or patient information, stop." },
          { icon: "eye", label: "Not proof", sub: "a voice or a face", say: "A voice or a face is not proof of who is asking, because criminals use software to make convincing fake audio and video." },
          { icon: "phone-call", label: "Second channel", sub: "a number you already know", say: "Check it another way: call back on a number you already know, or ask in a chat channel the client already uses." },
          { icon: "users", label: "Tell your lead", say: "Never use the number or link that came with the request, and tell your lead." },
        ],
      },
      {
        kind: "checklist",
        heading: "If you clicked",
        items: [{ text: "Report it immediately", icon: "siren", say: "If you clicked or answered, report it immediately. Speed limits the damage." }],
      },
    ],
  },
  {
    ...base(4, "malware", "Malware, ransomware and updates", "How it gets in, and what to do if a device is hit", "bug"),
    scenes: [
      {
        kind: "hero",
        icon: "bug",
        title: "Malware and ransomware",
        sub: "Software that works against you",
        lead: "Malware is software that works against you. It usually arrives through a message, a download or an unpatched hole.",
      },
      {
        kind: "icons",
        heading: "What malware is",
        items: [
          { icon: "copy", label: "Virus and worm", say: "Viruses and worms spread from file to file." },
          { icon: "package", label: "Trojan", say: "A trojan looks useful and hides something harmful." },
          { icon: "eye", label: "Spyware", say: "Spyware quietly records what you do and type." },
          { icon: "lock", label: "Ransomware", say: "Ransomware locks your files and demands payment." },
        ],
      },
      {
        kind: "flow",
        heading: "If a device is hit",
        items: [
          { big: "1", icon: "wifi", label: "Disconnect", sub: "do not shut it down", say: "Disconnect the device from the network and off Wi-Fi, but do not shut it down." },
          { big: "2", icon: "siren", label: "Report at once", say: "Tell your lead and follow the client's instructions." },
          { big: "3", icon: "ban", label: "Do not pay or reply", say: "Do not pay or reply." },
          { big: "4", icon: "archive", label: "Backups", sub: "kept apart", say: "Your organization restores from backups that were kept apart." },
        ],
      },
      {
        kind: "checklist",
        heading: "Stay protected",
        items: [
          { text: "Install updates promptly", icon: "refresh-cw", say: "Updates close holes attackers already know about, so install them promptly." },
          { text: "Keep security software on", icon: "shield-check", say: "Keep security software on." },
          { text: "Install only what you were told to", icon: "check", say: "Install only what you were told to install." },
        ],
      },
    ],
  },
  {
    ...base(5, "browsing", "Safe browsing, email and online privacy", "Look before you click", "globe"),
    scenes: [
      {
        kind: "hero",
        icon: "globe",
        title: "Look before you click",
        sub: "A few seconds of checking is cheap",
        lead: "Check where a link really goes before you click. A few seconds of checking is cheap.",
      },
      {
        kind: "compare",
        heading: "The padlock",
        leftGood: true,
        left: { title: "It means", items: [{ text: "The connection is private", say: "A padlock means the connection is private." }] },
        right: { title: "It does not mean", items: [{ text: "The site is honest", say: "It does not mean the site is honest. Criminals use https too." }] },
      },
      {
        kind: "flow",
        heading: "Before you click",
        items: [
          { big: "1", icon: "mouse-pointer-click", label: "Hover", sub: "see the real address", say: "Hover over a link to see the real address." },
          { big: "2", icon: "search", label: "Check", sub: "the domain spelling", say: "Check the spelling of the domain." },
          { big: "3", icon: "pen-line", label: "Type it", sub: "if in doubt", say: "If in doubt, go to the site yourself by typing the address." },
        ],
      },
      {
        kind: "icons",
        heading: "Keep work safe online",
        items: [
          { icon: "package", label: "Approved sources", say: "Download only from approved sources." },
          { icon: "users", label: "Social media", say: "Keep client names and work details off social media." },
          { icon: "brain", label: "AI tools", say: "Do not paste work, client or personal information into public AI tools." },
          { icon: "mail", label: "Approved channels", say: "Use only the channels your client approved for email, text and fax." },
        ],
      },
    ],
  },
];
