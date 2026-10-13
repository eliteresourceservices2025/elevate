import { q, type CourseModule, type QuestionSeed } from "../schema";

export const devicesModule: CourseModule = {
  key: "devices",
  title: "Devices, networks and working remotely",
  summary: "Locking and protecting your devices, securing your home network, using public Wi-Fi and video calls safely, and what to do when a device goes missing.",
  estimatedMinutes: 11,
  tracks: ["full"],
  keyPoints: [
    "Lock your screen, use a screen lock code, and encrypt your devices.",
    "Change your router's default password and use WPA2 or WPA3.",
    "Do not do work on public Wi-Fi unless your client gives you a secure connection for it.",
    "Use only approved devices for work, and keep them to yourself.",
    "A lost or stolen device is an emergency: tell your lead immediately.",
  ],
  screens: [
    {
      id: "lock-and-encrypt",
      title: "Lock it and encrypt it",
      blocks: [
        { type: "paragraph", text: "A device you carry can be lost; a device at home can be borrowed. Two protections turn a lost device from a disaster into an inconvenience:" },
        {
          type: "list",
          items: [
            "**A screen lock** with a strong code or passphrase, and a short automatic lock time. Lock it yourself whenever you step away.",
            "**Encryption** of the device's storage, so its contents are unreadable without the code. Most computers and phones can turn this on.",
            "A strong code, not 1234 or a birth year.",
            "Remote lock and wipe turned on, if your client provides it.",
          ],
        },
        { type: "callout", tone: "tip", text: "On Windows press the Windows key and L to lock. On a Mac press Control, Command and Q." },
      ],
    },
    {
      id: "home-network",
      title: "Your home network",
      blocks: [
        { type: "paragraph", text: "Your router is the front door to everything you do from home. Make it hard to open:" },
        {
          type: "list",
          items: [
            "Change the router's default admin password.",
            "Use WPA2 or WPA3 security and a strong Wi-Fi password.",
            "Keep the router's own software updated.",
            "Use a separate guest network for visitors and smart devices, if the router offers one.",
          ],
        },
        { type: "callout", tone: "info", text: "A router with the factory password and an old setting is one of the easiest ways into a home network." },
      ],
    },
    {
      id: "public-wifi",
      title: "Public places and public Wi-Fi",
      blocks: [
        { type: "paragraph", text: "Public Wi-Fi can be watched or imitated, and a public room puts your screen in view of strangers." },
        {
          type: "steps",
          items: [
            { title: "Do not rely on it for work", text: "Unless your client gives you a secure connection for it and you are in a private place." },
            { title: "Prefer your own connection", text: "A phone hotspot you control is better than an open network." },
            { title: "Ask when stuck", text: "If your internet is down, tell your lead rather than improvising." },
          ],
        },
        {
          type: "scenario",
          title: "Internet down at home",
          prompt: "Your home internet is down and you have client work to finish. A cafe nearby has free Wi-Fi.",
          choices: [
            { text: "Go to the cafe and work there.", feedback: "A public network and a public room are both risks for client work.", best: false },
            { text: "Tell your lead and use only an option your client allows, in a private space.", feedback: "Correct. Ask first; a late task can be explained.", best: true },
          ],
        },
      ],
    },
    {
      id: "vpn",
      title: "VPNs and secure remote access",
      blocks: [
        { type: "paragraph", text: "A **VPN** creates a private tunnel between your device and your organization. It protects the traffic on a network you do not control. It is not a cure for everything: a VPN does not stop you from clicking a bad link." },
        {
          type: "list",
          items: [
            "Use the VPN or remote access your client or ERS provides, and use it as instructed.",
            "Do not use free consumer VPN apps for work unless they were approved.",
            "Sign out of remote sessions when you finish.",
            "Remote access to sensitive areas should need a second sign-in step.",
          ],
        },
      ],
    },
    {
      id: "video-calls",
      title: "Video calls and screen sharing",
      blocks: [
        { type: "paragraph", text: "Calls are a place where information leaks quietly: a shared screen with the wrong window open, a call link shared too widely, a recording nobody planned." },
        {
          type: "list",
          items: [
            "Share one window, not your whole screen, and close anything private first.",
            "Join with the link or code you were sent and check who is in the call.",
            "Do not post call links or codes in public places.",
            "Do not record unless you were told you may.",
            "Check what is behind you and who can overhear.",
          ],
        },
      ],
    },
    {
      id: "work-and-personal",
      title: "Work devices and personal devices",
      blocks: [
        { type: "paragraph", text: "Mixing work and personal use is how risks cross over. Your children's games, a family member's browsing and an unknown app can all end up on the same device as client work." },
        {
          type: "compare",
          left: { title: "Do", items: ["Use work devices for work and only you", "Use only approved devices for client work", "Keep personal and work accounts separate", "Keep software and security tools current"] },
          right: { title: "Do not", items: ["Let family or friends use a work device", "Use a shared family computer for client work", "Sign in to personal accounts on a work device", "Connect unknown USB drives"] },
        },
      ],
    },
    {
      id: "lost-device",
      title: "A device goes missing",
      blocks: [
        { type: "paragraph", text: "If a device you use for work is lost or stolen, or someone else has used it, treat it as an emergency. Seconds count: a lock or a remote wipe is only possible while the device can still be reached." },
        {
          type: "steps",
          items: [
            { title: "Tell your lead immediately", text: "Say what it is, when and where you last had it." },
            { title: "Follow the instructions", text: "Remote lock, wipe and password changes are done by the right people." },
            { title: "Change what it could reach", text: "Passwords for accounts that were signed in on it." },
          ],
        },
        { type: "callout", tone: "warning", text: "Do not wait to see if it turns up. A day of delay is a day of exposure." },
      ],
    },
  ],
};

export const devicesQuestions: QuestionSeed[] = [
  q("devices", "Lock", "single", "You need to leave your desk at home for two minutes with work open. What should you do?", ["Lock your screen first", "Leave it, since you are at home", "Turn the brightness down", "Minimize the window"], [0], "A locked screen keeps others from seeing or using your session, even at home."),
  q("devices", "Encryption", "single", "Why does encrypting a laptop's storage matter if it is stolen?", ["Its contents cannot be read without the code", "It makes the laptop faster", "It stops the thief from using the laptop at all", "It deletes the files"], [0], "Encryption makes the data unreadable without the code, which turns a stolen device into a much smaller problem."),
  q("devices", "Home network", "single", "Which of these makes your home Wi-Fi safer?", ["Changing the router's default password and using WPA2 or WPA3", "Keeping the default router password", "Leaving the network open", "Turning off all updates"], [0], "A strong router password and modern Wi-Fi security reduce the chance of break-ins."),
  q("devices", "Home network", "single", "Why use a separate guest network for visitors and smart devices?", ["To keep them away from the devices you use for work", "To make the internet faster", "To save electricity", "Because guests need a different password every day"], [0], "A guest network keeps less-trusted devices apart from your work devices."),
  q("devices", "Public Wi-Fi", "single", "Your home internet is down and you have client work to do. What is the best choice?", ["Tell your lead and use only a secure option your client allows", "Use free public Wi-Fi at a cafe", "Use a neighbor's open network", "Use a free VPN app you found"], [0], "Public and open networks are not safe for client work. Ask for help and use only allowed secure options."),
  q("devices", "VPN", "single", "What does a VPN do?", ["Creates a private tunnel for your traffic on a network you do not control", "Makes you immune to phishing", "Updates your software", "Backs up your files"], [0], "A VPN protects traffic on an untrusted network, but it does not stop you from clicking a bad link."),
  q("devices", "Video calls", "single", "You are about to share your screen on a call. What is the best practice?", ["Share only the window you need, and close anything private first", "Share the whole desktop", "Share nothing and read it aloud", "Share and record without telling anyone"], [0], "Sharing one window avoids exposing other information by accident."),
  q("devices", "Personal devices", "single", "A family member offers their shared computer when your work laptop breaks. What should you do?", ["Do not use it and ask your lead for an approved option", "Use it and log out afterward", "Use it only for non-urgent tasks", "Use it in a private browser window"], [0], "Only approved devices should be used for client work. A shared family computer is not approved."),
  q("devices", "Lost device", "single", "You notice your work laptop is missing after a trip. What is the right action?", ["Tell your lead immediately", "Wait a few days in case it turns up", "Buy a new one and say nothing", "Post on social media asking for help"], [0], "Immediate reporting lets the right people lock or wipe it and limits harm."),
  q("devices", "Lost device", "multiple", "After a device is lost, which of these should be done? Select all that apply.", ["Tell your lead immediately", "Change passwords for accounts signed in on it", "Follow instructions to lock or wipe it", "Wait to see if it is returned"], [0, 1, 2], "Fast reporting, changing passwords and a remote lock or wipe limit the harm. Waiting only adds exposure."),
];
