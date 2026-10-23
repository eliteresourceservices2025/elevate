// Storyboards for the Cybersecurity recap videos, modules 6 to 10 (ai_tools, devices, physical, response, security_hipaa). Animated scenes with
// a few words on screen; the detail is in the narration (`say`). Every spoken line restates that module's approved lesson text: no new facts.
// Scene kinds are drawn in src/Cs.jsx and src/LearnScenes.jsx; what the voice says is read by customer-service/beats.cjs.
const { CYBER_OUTRO } = require("./shared.cjs");

const base = (n, module, title, tagline, icon) => ({
  id: `cybersecurity-${module}`,
  course: "cybersecurity",
  module,
  n,
  count: 10,
  title,
  label: `CYBERSECURITY  |  MODULE ${n} OF 10`,
  tagline,
  icon,
  outroItems: CYBER_OUTRO,
});

module.exports = [
  {
    ...base(6, "ai_tools", "AI tools and your data", "What you type leaves your control", "sparkles"),
    scenes: [
      {
        kind: "hero",
        icon: "sparkles",
        title: "What you type leaves your control",
        sub: "It goes to the company that runs the tool",
        lead: "Anything you type or upload into an AI tool leaves your control and goes to the company that runs it.",
      },
      {
        kind: "chain",
        heading: "Where it goes",
        items: [
          { icon: "user", label: "You", sub: "paste or upload", say: "You paste text, upload a file or record audio." },
          { icon: "cloud", label: "The tool", sub: "someone else's servers", say: "It travels to the company's systems." },
          { icon: "database", label: "Stored or reviewed", sub: "or exposed in a breach", say: "It may be stored, reviewed by people, or exposed if the company is breached." },
        ],
      },
      {
        kind: "compare",
        heading: "Approved or not?",
        leftGood: true,
        left: {
          title: "Approved",
          items: [
            { text: "Named in your client's instructions", say: "A tool named in your client's instructions is approved." },
            { text: "Approved by ERS in writing", say: "So is a tool ERS has approved in writing." },
          ],
        },
        right: {
          title: "Not approved",
          items: [
            { text: "A free account you made", say: "A free account you made yourself is not approved." },
            { text: "A coworker's tip", say: "Nor is a tool a coworker recommended." },
          ],
        },
      },
      {
        kind: "flow",
        heading: "Check what comes back",
        items: [
          { big: "1", icon: "eye", label: "Read it all", sub: "do not skim", say: "Read it all. Do not skim." },
          { big: "2", icon: "search", label: "Check the facts", sub: "against the source", say: "Check the facts against the source in the client's system." },
          { big: "3", icon: "eye-off", label: "Remove extras", sub: "what should not be there", say: "Remove anything that should not be there." },
          { big: "4", icon: "badge-check", label: "Own it", sub: "your work", say: "Own it. What you send is your work, whoever drafted it." },
        ],
      },
    ],
  },
  {
    ...base(7, "devices", "Devices, networks and working remotely", "A safe place, device, network and sign-in", "laptop"),
    scenes: [
      {
        kind: "hero",
        icon: "laptop",
        title: "Working from home is your job to secure",
        sub: "Place, device, network and sign-in",
        lead: "Working from home means you are the one responsible for the room, the device and the network.",
      },
      {
        kind: "icons",
        heading: "Four things to keep in order",
        items: [
          { icon: "door-closed", label: "Place", say: "A place where screens and calls are not seen or heard by others." },
          { icon: "laptop", label: "Device", say: "An approved, updated, locked and encrypted device that you alone use for work." },
          { icon: "wifi", label: "Network", say: "A home network with a strong password and an updated router, or an approved secure connection." },
          { icon: "key-round", label: "Sign-in", say: "Your own login, with the second step on, signed out when you finish." },
        ],
      },
      {
        kind: "compare",
        heading: "Work devices",
        leftGood: true,
        left: {
          title: "Do",
          items: [
            { text: "Keep it to yourself", say: "Use work devices for work and only you." },
            { text: "Keep accounts separate", say: "Keep personal and work accounts separate." },
          ],
        },
        right: {
          title: "Do not",
          items: [
            { text: "Share it with family", say: "Do not let family or friends use a work device." },
            { text: "Plug in unknown USB drives", say: "Do not connect unknown USB drives." },
          ],
        },
      },
      {
        kind: "timeline",
        heading: "A device goes missing",
        items: [
          { when: "Now", label: "Tell your lead", icon: "siren", say: "A lost or stolen device is an emergency: tell your lead immediately." },
          { when: "Then", label: "Locked and encrypted", icon: "lock", say: "Because it was locked and encrypted, a lost device is an inconvenience, not a disaster." },
        ],
      },
    ],
  },
  {
    ...base(8, "physical", "Handling information and physical security", "Paper, screens and people leak too", "folder-lock"),
    scenes: [
      {
        kind: "hero",
        icon: "folder-lock",
        title: "Paper, screens and talk leak too",
        sub: "Keep them out of sight and earshot",
        lead: "Information on paper, on a screen or in a conversation can be seen or heard by people nearby.",
      },
      {
        kind: "flow",
        heading: "Before you share",
        items: [
          { big: "1", icon: "users", label: "Who needs it?", sub: "part of the task?", say: "Who needs it? Is this person part of the task?" },
          { big: "2", icon: "hash", label: "How much?", sub: "only what answers", say: "How much? Only what answers the question." },
          { big: "3", icon: "send", label: "By which way?", sub: "the approved system", say: "By which way? The approved system, not personal email or chat." },
        ],
      },
      {
        kind: "swap",
        heading: "At the door",
        items: [
          {
            bad: "Hold the door. They look like they are working.",
            good: "Politely ask them to use their own access, or to check in with the front desk.",
            badSay: "Do not hold the door because someone looks like they are working. A uniform proves nothing.",
            goodSay: "Politely ask them to use their own access, or to ring or check in with the front desk.",
          },
        ],
      },
      {
        kind: "icons",
        heading: "What happens to it",
        items: [
          { icon: "scissors", label: "Shred", say: "Shred paper with sensitive details, or return it as instructed." },
          { icon: "folder-lock", label: "Lock away", say: "Keep notes with sensitive details locked away when you are done." },
          { icon: "circle-question-mark", label: "Not sure? Ask", say: "If you are not sure how to dispose of something, keep it safe and ask." },
        ],
      },
    ],
  },
  {
    ...base(9, "response", "When something goes wrong", "Stop, tell, describe and preserve", "siren"),
    scenes: [
      {
        kind: "hero",
        icon: "siren",
        title: "Report fast, even if unsure",
        sub: "You do not have to be sure",
        lead: "Many incidents are noticed first by the person involved. Treat the signs as worth reporting even when you are not sure.",
      },
      {
        kind: "timeline",
        heading: "The first hour",
        items: [
          { when: "Minute 0", label: "Stop", icon: "hand", say: "At minute zero you notice something wrong. Stop what you are doing." },
          { when: "Minutes", label: "Tell your lead", icon: "message-circle", say: "Within minutes, tell your lead and HR. Do not wait to be sure." },
          { when: "The hour", label: "Write the facts", icon: "pen-line", say: "Within the hour, write down the facts: what, when and which system. Keep evidence." },
          { when: "As asked", label: "Follow steps", icon: "list-checks", say: "As instructed, change passwords, sign out sessions or isolate the device." },
        ],
      },
      {
        kind: "compare",
        heading: "Do and do not",
        leftGood: true,
        left: {
          title: "Do",
          items: [
            { text: "Report straight away", say: "Report straight away." },
            { text: "Keep the file as it is", say: "Keep the message or file as it is." },
          ],
        },
        right: {
          title: "Do not",
          items: [
            { text: "Fix it quietly", say: "Do not try to fix it quietly." },
            { text: "Delete or reply", say: "Do not delete the message or reply to the attacker." },
          ],
        },
      },
      {
        kind: "checklist",
        heading: "A useful report says",
        items: [
          { text: "What happened", icon: "file-text", say: "What happened." },
          { text: "When", icon: "clock", say: "When it happened and when you noticed." },
          { text: "Where", icon: "map-pin", say: "Where: which system, and how it was sent." },
          { text: "What you did so far", icon: "clipboard-check", say: "And what you have done so far, and not done." },
        ],
      },
    ],
  },
  {
    ...base(10, "security_hipaa", "Security and HIPAA together", "Each habit carries out a safeguard", "shield-check"),
    scenes: [
      {
        kind: "hero",
        icon: "shield-check",
        title: "Two courses, one purpose",
        sub: "Your habits carry out a legal duty",
        lead: "The Security Rule asks for administrative, physical and technical safeguards, and your daily habits are part of all three.",
      },
      {
        kind: "icons",
        heading: "Habit and safeguard",
        items: [
          { icon: "key-round", label: "Technical", say: "Strong passwords and a second sign-in step are a technical safeguard." },
          { icon: "lock", label: "Physical", say: "Locking the screen and a tidy desk are a physical safeguard." },
          { icon: "graduation-cap", label: "Administrative", say: "Spotting phishing, reporting and training are administrative safeguards." },
        ],
      },
      {
        kind: "timeline",
        heading: "From one click to a reportable event",
        items: [
          { when: "The slip", label: "A click", icon: "mouse-pointer-click", say: "A convincing email gets a click, and a password is typed into a fake page." },
          { when: "Later", label: "Signed in as you", icon: "user-x", say: "The attacker signs in as you, and no second step stops them." },
          { when: "Days", label: "Information reached", icon: "folder-open", say: "They read, copy or lock information the account can reach." },
          { when: "Noticed", label: "Reportable", icon: "siren", say: "When it is noticed, the organization may have to notify the client, patients and HHS." },
        ],
      },
      {
        kind: "compare",
        heading: "Why speed matters",
        leftGood: false,
        left: {
          title: "Wait to be sure",
          icon: "hourglass",
          items: [{ text: "Uses the client's time", say: "Waiting a day to be sure is not neutral. It uses time that belongs to the client." }],
        },
        right: {
          title: "Report today",
          icon: "siren",
          items: [{ text: "Starts the clock early", say: "A breach counts as discovered on the first day anyone in the workforce knows. Report it today." }],
        },
      },
    ],
  },
];
