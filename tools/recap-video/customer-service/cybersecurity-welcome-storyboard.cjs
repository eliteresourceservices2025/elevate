// Storyboard for the welcome video of the Cybersecurity basics course (about 60 seconds), same style and scene kinds as
// welcome-storyboard.cjs. Every statement restates the course itself (apps/learn/src/content/cybersecurity: "Why security is everyone's job",
// the module summaries and "Security and HIPAA together"): no new facts, no patient information.
module.exports = [
  {
    id: "cybersecurity-00-welcome",
    title: "Cybersecurity basics for the ERS team",
    label: "WELCOME  |  ELEVATE LEARN",
    tagline: "Four habits that stop most attacks",
    introSay: "Welcome to Cybersecurity basics for the ERS team.",
    outroItems: [
      { icon: "search", word: "Spot" },
      { icon: "lock", word: "Lock" },
      { icon: "refresh-cw", word: "Update" },
      { icon: "megaphone", word: "Report" },
    ],
    scenes: [
      {
        kind: "hero",
        icon: "shield-check",
        title: "Security is everyone's job",
        sub: "A few simple habits stop most attacks",
        lead: "Ordinary people are the target of most attacks. Four simple habits stop most of them.",
      },
      {
        kind: "flow",
        heading: "Four habits",
        lead: "Four habits.",
        items: [
          { big: "1", icon: "mail-warning", label: "Spot phishing", say: "Recognize and report phishing." },
          { big: "2", icon: "key-round", label: "Strong passwords", say: "Use strong passwords." },
          { big: "3", icon: "shield-check", label: "Second sign-in step", say: "Turn on a second sign-in step." },
          { big: "4", icon: "refresh-cw", label: "Updates", say: "And install updates." },
        ],
      },
      {
        kind: "checklist",
        heading: "What else you will learn",
        lead: "You will also learn to:",
        items: [
          { icon: "globe-lock", text: "Browse and use email safely", say: "Browse and use email safely." },
          { icon: "sparkles", text: "Use AI tools with care", say: "Know why pasting work into an AI tool is a disclosure." },
          { icon: "laptop", text: "Protect devices and home network", say: "Protect your devices and home network." },
          { icon: "shield", text: "See how it fits HIPAA", say: "And see how it fits HIPAA's Security Rule." },
        ],
      },
      {
        kind: "hero",
        icon: "megaphone",
        title: "Report fast",
        sub: "Speed and honesty matter more than being sure",
        lead: "If something looks wrong, report it to your team lead and HR right away. Speed and honesty matter more than being sure. Let us begin.",
      },
    ],
  },
];
