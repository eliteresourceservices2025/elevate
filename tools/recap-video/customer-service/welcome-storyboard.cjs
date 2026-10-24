// Storyboard for the welcome video of the Customer Service & Family Support Certification (60 seconds), narrated with the owner's own
// voice through VoiceStudio. Same scene kinds as storyboards.cjs (drawn in src/Cs.jsx). The words restate the approved welcome script
// and the course roadmap: no new facts.
module.exports = [
  {
    id: "cs-00-welcome",
    title: "Customer Service & Family Support Certification",
    label: "WELCOME  |  ELEVATE LEARN",
    tagline: "Your certification journey begins here",
    // spoken as the opening line and again on the intro card
    introSay: "Welcome to the Customer Service and Family Support Certification.",
    scenes: [
      {
        kind: "hero",
        icon: "headset",
        title: "Support that builds trust",
        sub: "Professional, compassionate and effective",
        lead: "In this course you will learn to give professional, compassionate and effective support to the families we serve.",
      },
      {
        kind: "checklist",
        heading: "What you will learn",
        lead: "Every interaction matters. How we communicate, listen and respond builds trust. You will learn how to:",
        items: [
          { icon: "message-circle", text: "Communicate professionally", say: "Communicate professionally and confidently." },
          { icon: "ear", text: "Listen actively", say: "Practice active listening." },
          { icon: "heart", text: "Show empathy", say: "Show empathy." },
          { icon: "handshake", text: "Manage difficult conversations", say: "Manage difficult conversations." },
          { icon: "heart-handshake", text: "Handle healthcare calls with care", say: "Handle healthcare calls with care." },
          { icon: "clipboard-list", text: "Resolve and document", say: "Resolve concerns and document accurately." },
        ],
      },
      {
        kind: "flow",
        heading: "How the course works",
        lead: "In every module, you will practice and prove what you have learned.",
        items: [
          { big: "1", icon: "circle-question-mark", label: "Knowledge checks", say: "Knowledge checks and games." },
          { big: "2", icon: "message-circle", label: "Real scenarios", say: "Real scenarios." },
          { big: "3", icon: "phone-call", label: "A mock call", say: "A mock call." },
          { big: "4", icon: "badge-check", label: "Final exam", say: "And a final exam." },
        ],
      },
      {
        kind: "hero",
        icon: "heart-handshake",
        title: "It is about trust",
        sub: "Listening, communicating clearly and building trust",
        lead: "Great customer service is not about having all the answers. It is about listening, communicating clearly, and building trust. Let us begin.",
      },
    ],
  },
];
