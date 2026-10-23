import { q, type CourseModule, type QuestionSeed } from "../schema";

export const devicesModule: CourseModule = {
  key: "devices",
  title: "Devices, networks and working remotely",
  summary: "Locking and protecting your devices, securing your home network, using public Wi-Fi and video calls safely, and what to do when a device goes missing.",
  estimatedMinutes: 19,
  tracks: ["full"],
  keyPoints: [
    "Lock your screen, use a screen lock code, and encrypt your devices.",
    "Change your router's default password and use WPA2 or WPA3.",
    "Do not do work on public Wi-Fi unless your client gives you a secure connection for it.",
    "Use only approved devices for work, and keep them to yourself.",
    "A lost or stolen device is an emergency: tell your lead immediately.",
    "A work setup has a place, a device, a network and a sign-in, and each needs to be safe, even at home.",
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
      id: "va-setup",
      title: "Your remote setup, step by step",
      blocks: [
        { type: "paragraph", text: "Working from home means you are the one responsible for the room, the device and the network. A simple routine keeps all four in order:" },
        {
          type: "steps",
          items: [
            { title: "Place", text: "A space where screens and calls are not seen or heard by others." },
            { title: "Device", text: "An approved, updated, locked and encrypted device that you alone use for work." },
            { title: "Network", text: "A home network with a strong password and updated router, or an approved secure connection." },
            { title: "Sign-in", text: "Your own login, with the second step on, signed out when you finish." },
          ],
        },
      ],
    },
    {
      id: "check-the-remote-setup",
      title: "Check the setup: what is wrong with this home desk?",
      blocks: [
        {
          type: "hotspot",
          title: "A home desk before the shift",
          prompt: "A team member is about to start work from home. Tap everything on this setup that puts client information at risk, then check.",
          items: [
            { label: "Place", text: "A desk by a window that faces the street", problem: true, why: "Screens and calls should be where others cannot see or hear them." },
            { label: "Device", text: "A work laptop that is updated, encrypted and locked when away" },
            { label: "Router", text: "Still on the factory admin password", problem: true, why: "A router with the factory password is one of the easiest ways into a home network." },
            { label: "Wi-Fi", text: "WPA3 with a strong password" },
            { label: "Guest network", text: "Visitors and smart devices kept on a guest network" },
            { label: "Family", text: "A relative checks email on the work laptop", problem: true, why: "Work devices are for work, and only for you." },
            { label: "Phone", text: "A phone with a screen lock and updates" },
          ],
          explanation: "A safe remote setup has a place, a device, a network and a sign-in, and each needs to be safe, even at home.",
        },
      ],
    },
    {
      id: "shared-home",
      title: "Worked case: the shared family computer",
      blocks: [
        {
          type: "case",
          title: "My laptop is broken, but the family laptop works",
          scenario: "Your work laptop stops starting an hour before a client deadline. Your sister's laptop is on the kitchen table and works. She says you can use it, and the client's system is only a login away.",
          question: "What should you do, and why not use the family laptop?",
          answer: "Tell your lead at once and ask for an approved fix: a spare device, an extension, or someone to take over the work. A family computer has other people's accounts and apps, is not managed or encrypted for work, and may keep copies of what you open. A login is not the only exposure: browser history, downloads, and cached files remain behind.",
        },
      ],
    },
    {
      id: "byod",
      title: "Your own phone and the work",
      blocks: [
        { type: "paragraph", text: "Many people use their own phone for sign-in codes or work chat. That can be fine, if ERS or the client approves it, and the phone is itself protected." },
        {
          type: "list",
          items: [
            "Use a screen lock, and keep the phone updated.",
            "Use only approved apps for client communication.",
            "Do not take screenshots or photos of client information.",
            "Report a lost or replaced phone immediately, because it may hold sign-in codes.",
          ],
        },
      ],
    },
    {
      id: "habit-or-risk",
      title: "Quick sort: good habit or risk?",
      blocks: [
        {
          type: "cards",
          title: "Habit or risk",
          prompt: "Sort each card, one at a time.",
          groups: ["Good habit","Risk"],
          cards: [
            { text: "Lock your screen before you step away", group: 0, feedback: "A locked screen keeps others from seeing or using your session." },
            { text: "Connect a USB drive you found", group: 1, feedback: "Do not connect unknown USB drives." },
            { text: "Share one window on a call and close private ones first", group: 0, feedback: "Sharing one window avoids exposing other information by accident." },
            { text: "Use free public Wi-Fi at a cafe for client work", group: 1, feedback: "A public network and a public room are both risks for client work." },
            { text: "Keep the router software updated", group: 0, feedback: "An old router is an easy way in." },
            { text: "Let a family member use the work laptop", group: 1, feedback: "Use work devices for work, and only you." },
            { text: "Sign out of a remote session when you finish", group: 0, feedback: "Signing out ends the session so nobody else can use it." },
            { text: "Use a free consumer VPN app nobody approved", group: 1, feedback: "Do not use free consumer VPN apps for work unless they were approved." },
          ],
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
    {
      id: "missing-device-order",
      title: "Put it in order: a device goes missing",
      blocks: [
        {
          type: "sort",
          title: "A device goes missing",
          prompt: "Put these steps in the order you should do them.",
          items: ["Tell your lead immediately","Say what it is, when and where you last had it","Follow the instructions to lock or wipe it","Change the passwords of accounts that were signed in on it"],
          explanation: "Telling your lead comes first because seconds count: a lock or remote wipe only works while the device can still be reached.",
        },
      ],
    },
    {
      id: "quick-round-devices",
      title: "Quick round: devices and networks",
      blocks: [
        {
          type: "game",
          title: "Devices sprint",
          rounds: [
            { question: "You step away from your home desk with work open. What comes first?", options: [{ text: "Lock your screen", correct: true, feedback: "Right. Lock it yourself whenever you step away." }, { text: "Leave it, since you are at home", correct: false, feedback: "A device at home can be borrowed." }, { text: "Turn the brightness down", correct: false, feedback: "That does not stop anyone using it." }] },
            { question: "Which Wi-Fi security should your router use?", options: [{ text: "WPA2 or WPA3 with a strong password", correct: true, feedback: "Right." }, { text: "The factory setting, since it works", correct: false, feedback: "Change the default." }, { text: "No password, so guests can join", correct: false, feedback: "Use a guest network instead." }] },
            { question: "Your work phone is lost. Who do you tell first?", options: [{ text: "Your lead, immediately", correct: true, feedback: "Right. Do not wait to see if it turns up." }, { text: "Nobody until it is found", correct: false, feedback: "A day of delay is a day of exposure." }, { text: "A friend online", correct: false, feedback: "Report it through your lead." }] },
            { question: "What does a VPN not do?", options: [{ text: "Stop you from clicking a bad link", correct: true, feedback: "Right. A VPN protects traffic on a network you do not control." }, { text: "Protect traffic on a network you do not control", correct: false, feedback: "That is what it does." }, { text: "Create a private tunnel to your organization", correct: false, feedback: "That is what it does." }] },
            { question: "Which device may do client work?", options: [{ text: "An approved one that only you use", correct: true, feedback: "Right." }, { text: "The family computer in the kitchen", correct: false, feedback: "A shared family computer is not approved." }, { text: "Any device with internet", correct: false, feedback: "Use only approved devices." }] },
          ],
        },
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
  q("devices", "Setup", "multiple", "Which parts of a safe remote setup should you check? Select all that apply.", ["The place where you work", "The device and its updates", "The network", "The color of the walls"], [0, 1, 2], "Place, device, network and sign-in are the checks. Wall color is not."),
  q("devices", "Shared computers", "single", "Your work laptop fails before a deadline. A relative's laptop is available. What should you do?", ["Tell your lead and ask for an approved solution", "Use the relative's laptop, since it has internet", "Email the files to yourself and use it", "Use it in a private browser window"], [0], "A shared device is not managed or encrypted for work and may keep copies. Ask for an approved fix."),
  q("devices", "Shared computers", "true_false", "True or false: A private browsing window makes it safe to use someone else's computer for client work.", ["True", "False"], [1], "Private windows hide history but do not make the device safe or approved, and files can still be saved."),
  q("devices", "Phones", "single", "Which is a good habit for a personal phone that receives work sign-in codes?", ["Use a screen lock and report it at once if it is lost", "Share the phone with the family", "Turn off updates", "Store passwords in the notes app"], [0], "A phone that receives sign-in codes is part of your security and must be protected."),
  q("devices", "Phones", "single", "May you take a photo of a client's screen on your personal phone to help remember a step?", ["No, because that creates an unapproved copy of client information", "Yes, if it is a small photo", "Yes, if you delete it later", "Yes, if it has no names"], [0], "Photos create copies outside approved systems."),
  q("devices", "Network", "single", "Your home router has never been updated and still uses its default password. What should you do?", ["Change the password and update it, or ask for help", "Leave it, since it works", "Move to a neighbor's Wi-Fi", "Turn off the firewall"], [0], "Default passwords and old software leave a home network open."),
  q("devices", "Place", "single", "Which is the best place to take a client call at home?", ["A room with a door, away from others", "The kitchen with the family nearby", "The balcony", "The living room with the television on"], [0], "Choose a private space where the call cannot be overheard."),
  q("devices", "Phones", "single", "Your phone that receives work sign-in codes is replaced or lost. What should you do?", ["Report it immediately, because it may hold sign-in codes","Wait to see if it turns up","Change your wallpaper","Ask a friend to find it"], [0], "A phone that receives sign-in codes is part of your security."),
  q("devices", "Remote sessions", "single", "What should you do when you finish a remote work session?", ["Sign out of the remote session","Leave it open for the next shift","Share the session link with a teammate","Close the lid without signing out"], [0], "Signing out of remote sessions is part of using remote access as instructed."),
  q("devices", "VPN", "true_false", "True or false: A VPN stops you from being harmed by clicking a bad link.", ["True","False"], [1], "A VPN protects traffic on an untrusted network, but it does not stop a bad link from working."),
  q("devices", "USB", "single", "You find a USB drive in a shared space. What is the right choice?", ["Do not connect it, and tell your lead","Plug it in to find the owner","Use it for backups","Plug it into the work laptop only"], [0], "Do not connect unknown USB drives."),
];
