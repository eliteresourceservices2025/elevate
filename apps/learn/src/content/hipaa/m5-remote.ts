import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 5: remote work and device security. Invented examples only. The ERS rules here are the floor; clients may add stricter ones.

export const m5: CourseModule = {
  key: "remote",
  title: "Working remotely and securing your devices",
  summary: "How to set up and use your home workspace, computer, network and phone so patient information stays private.",
  estimatedMinutes: 14,
  tracks: ["full"],
  keyPoints: [
    "Use only approved devices, accounts and tools for patient information.",
    "Keep your screen private and lock it whenever you step away.",
    "Never use personal email, messaging apps or cloud storage for patient information.",
    "Do not save, download, print or photograph patient information unless your client allows it.",
    "Report a lost or stolen device, or any suspicious activity, immediately.",
  ],
  screens: [
    {
      id: "workspace",
      title: "Your workspace",
      blocks: [
        { type: "paragraph", text: "Working from home does not lower the standard. Your workspace is part of the client's workplace for as long as patient information is on your screen." },
        {
          type: "list",
          items: [
            "Work in a space where others cannot see your screen or hear your calls.",
            "Position your screen away from windows and doorways.",
            "Keep family, roommates and visitors out of view of patient information.",
            "Keep a tidy desk: no notes or printouts with patient details left out.",
          ],
        },
      ],
    },
    {
      id: "approved-systems",
      title: "Approved systems only",
      blocks: [
        { type: "paragraph", text: "Use only the systems, tools and accounts your client and ERS approved. A convenient tool is not an approved tool." },
        {
          type: "compare",
          left: { title: "Approved", items: ["The client's EHR or portal", "The email and chat your client set up", "Devices and software ERS or the client provided or approved"] },
          right: { title: "Not approved", items: ["Personal email or messaging apps", "Free file-sharing or notes apps", "AI chatbots and online converters that receive pasted patient information"] },
        },
        { type: "callout", tone: "warning", text: "Pasting patient information into a public AI tool, translator or converter is a disclosure to an unauthorized party." },
      ],
    },
    {
      id: "screen-lock",
      title: "Screens and locking",
      blocks: [
        { type: "paragraph", text: "Lock your computer every time you step away, even for a minute at home. On Windows press the Windows key and L. On a Mac press Control, Command and Q." },
        { type: "paragraph", text: "Do not take photos or screen recordings of patient information. Do not share your screen in meetings that are not part of your task." },
      ],
    },
    {
      id: "network",
      title: "Your network",
      blocks: [
        { type: "paragraph", text: "Your home network is part of the security chain. Make it hard to break into:" },
        {
          type: "list",
          items: [
            "Change the default router password and use a strong Wi-Fi password.",
            "Use WPA2 or WPA3 security on your Wi-Fi.",
            "Keep your router and computer updated.",
            "Do not work with patient information on public Wi-Fi. If your client allows a secure connection (VPN), use it as instructed.",
          ],
        },
      ],
    },
    {
      id: "devices",
      title: "Computers and phones",
      blocks: [
        { type: "paragraph", text: "Your computer should have a screen lock, up-to-date updates, and security software as required by your client. Do not let family members use a device you use for work." },
        { type: "paragraph", text: "Do not connect unknown USB drives, and do not install software you were not told to install." },
        { type: "callout", tone: "tip", text: "If your client or ERS provided security software or settings, keep them on. Do not turn them off to make something faster." },
      ],
    },
    {
      id: "storing",
      title: "Saving, downloading and printing",
      blocks: [
        { type: "paragraph", text: "The safest place for patient information is where it already is: inside the client's system. Do not copy it somewhere else." },
        {
          type: "list",
          items: [
            "Do not save patient information on your own computer unless your client allows it.",
            "Do not put it in personal cloud storage or notes apps.",
            "Do not print unless the client permits it, and shred or return printouts as instructed.",
            "Do not forward it to yourself \"to work on later\".",
          ],
        },
      ],
    },
    {
      id: "lost",
      title: "Lost, stolen or shared devices",
      blocks: [
        { type: "paragraph", text: "If a device you use for work is lost, stolen, or used by someone else, tell your lead and HR immediately. Do not wait to see if it turns up." },
        { type: "paragraph", text: "Fast reporting lets the client lock or wipe the device and limits the harm. Delay is what turns a small problem into a serious one." },
      ],
    },
    {
      id: "scenario-wifi",
      title: "Try it: the cafe",
      blocks: [
        {
          type: "scenario",
          title: "Working away from home",
          prompt: "Your internet at home is down and a deadline is near. A nearby cafe has free Wi-Fi and a table by the window.",
          choices: [
            { text: "Work there, since it is only for an hour.", feedback: "Public Wi-Fi and a public room expose both the network and your screen.", best: false },
            { text: "Tell your lead, use a secure option your client allows, or wait until you are in a private space on a safe connection.", feedback: "Correct. Protect the information first and ask for help with the deadline.", best: true },
            { text: "Work there but only on non-urgent patients.", feedback: "The risk is the same for any patient. The setting is the problem.", best: false },
          ],
        },
        { type: "callout", tone: "info", text: "Examples like this are why asking early matters: a late task can be explained, a disclosure cannot be undone." },
      ],
    },
    {
      id: "scenario-family-computer",
      title: "Try it: the shared computer",
      blocks: [
        {
          type: "scenario",
          title: "A shared family computer",
          prompt: "Your work laptop breaks. A sibling offers their computer, which the whole family uses, to finish a task.",
          choices: [
            { text: "Use it, but sign out of everything afterward.", feedback: "Other people's access, software and files still make it unsafe, and it is not approved.", best: false },
            { text: "Do not use it. Contact your lead and the client about an approved replacement or another way.", feedback: "Correct. Only approved devices are used for patient information.", best: true },
          ],
        },
      ],
    },
  ],
};

export const q5: QuestionSeed[] = [
  q("remote", "Workspace", "single", "Which setup best protects patient information at home?", ["A private space where others cannot see your screen or hear your calls", "A shared living room with the television on", "A busy cafe", "A sofa near the front door"], [0], "A private space prevents others from seeing or hearing patient information."),
  q("remote", "Approved systems", "single", "You want to translate a paragraph that contains patient details. Which is the right choice?", ["Do not paste it into an online tool; ask your lead for an approved way", "Paste it into a free online translator", "Paste it into a public AI chatbot", "Email it to yourself and translate it later"], [0], "Pasting patient information into a public tool discloses it to an unauthorized party."),
  q("remote", "Approved systems", "multiple", "Which of these are NOT approved ways to handle patient information? Select all that apply.", ["Personal email", "A free notes app on your phone", "The client's approved portal", "A personal cloud storage folder"], [0, 1, 3], "Personal email, consumer notes apps and personal cloud storage are not approved. The client's portal is."),
  q("remote", "Screen lock", "single", "You need to get a glass of water at home for two minutes while a patient record is open. What should you do?", ["Lock your screen first", "Leave it as is since you are home", "Turn the screen brightness down", "Minimize the window"], [0], "A locked screen prevents others in the home from seeing or using the session."),
  q("remote", "Network", "single", "Which is the best choice if your home internet is down and you have urgent work with patient information?", ["Tell your lead and wait for a secure connection or use an option your client allows", "Use free public Wi-Fi at a cafe", "Use a neighbor's open network", "Share patient information through a personal phone"], [0], "Public and open networks are not safe for patient information. Ask for help and use only allowed secure options."),
  q("remote", "Network", "single", "Which of these makes your home Wi-Fi safer?", ["Changing the default router password and using WPA2 or WPA3", "Keeping the default router password", "Leaving the network open", "Turning off all updates"], [0], "A strong router password and modern Wi-Fi security reduce the chance of break-ins."),
  q("remote", "Storing", "true_false", "True or false: It is fine to save patient information to your own computer's desktop if you delete it at the end of the day.", ["True", "False"], [1], "Do not save patient information locally unless your client allows it. Keep it in the approved system."),
  q("remote", "Photos", "single", "A bug appears on your screen with a patient chart open. A teammate asks you to take a picture with your phone. What do you do?", ["Decline and report the problem through the approved channel without patient details", "Take the photo and send it privately", "Take the photo and blur the name", "Record a video of the whole screen"], [0], "Photos of patient information on a personal device are unapproved copies of PHI."),
  q("remote", "Lost device", "single", "You notice your work laptop is missing after a trip. What is the right action?", ["Tell your lead and HR immediately", "Wait a few days in case it turns up", "Buy a new one and say nothing", "Post on social media asking for help"], [0], "Immediate reporting lets the client lock or wipe the device and limits harm."),
  q("remote", "Shared devices", "single", "Your work laptop breaks and a family member offers their shared computer. What should you do?", ["Do not use it and ask your lead for an approved option", "Use it and log out afterward", "Use it only for non-urgent tasks", "Use it in a private browser window"], [0], "Only approved devices should be used for patient information. A shared home computer is not approved."),
];
