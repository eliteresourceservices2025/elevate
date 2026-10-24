// Storyboard for the welcome video of the HIPAA Privacy, Security and Awareness course (about 60 seconds), same style and scene kinds as
// welcome-storyboard.cjs. Every statement restates the course itself (apps/learn/src/content/hipaa: module 1 and the module summaries): no new
// facts, no patient information.
module.exports = [
  {
    id: "hipaa-00-welcome",
    title: "HIPAA Privacy, Security and Awareness",
    label: "WELCOME  |  ELEVATE LEARN",
    tagline: "Protecting patient information, from your first day",
    introSay: "Welcome to HIPAA Privacy, Security and Awareness.",
    outroItems: [
      { icon: "hand", word: "Stop" },
      { icon: "eye-off", word: "Do not share" },
      { icon: "message-circle", word: "Ask" },
      { icon: "megaphone", word: "Report" },
    ],
    scenes: [
      {
        kind: "hero",
        icon: "shield-check",
        title: "Patient information is protected",
        sub: "It applies to you from your first day",
        lead: "Many of our clients are healthcare organizations. When you work for them, you may see information about real patients. That information belongs to the patient, and HIPAA applies to you from your first day.",
      },
      {
        kind: "checklist",
        heading: "What you will learn",
        lead: "In this course, you will learn:",
        items: [
          { icon: "file-text", text: "What counts as patient information", say: "What counts as patient information." },
          { icon: "scale", text: "When it may be used or shared", say: "When it may be shared, and how to share only the minimum." },
          { icon: "lock", text: "How to keep it secure", say: "How to keep it secure." },
          { icon: "siren", text: "What to do when something goes wrong", say: "And what to do when something goes wrong." },
        ],
      },
      {
        kind: "flow",
        heading: "Three rules, three questions",
        lead: "Three HIPAA rules, three questions.",
        items: [
          { big: "1", icon: "scale", label: "Privacy Rule", say: "Privacy: who may use or share it?" },
          { big: "2", icon: "lock", label: "Security Rule", say: "Security: how is it kept safe?" },
          { big: "3", icon: "bell-ring", label: "Breach Notification", say: "Breach notification: who is told when it is exposed?" },
        ],
      },
      {
        kind: "hero",
        icon: "message-circle",
        title: "When in doubt, stop and ask",
        sub: "Asking is never a mistake",
        lead: "When you are unsure, stop, do not share, and ask your team lead or your client contact. Asking is never a mistake. Let us begin.",
      },
    ],
  },
];
