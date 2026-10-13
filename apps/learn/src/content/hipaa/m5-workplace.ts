import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 5: protecting patient information where you work (HIPAA's physical safeguards for a remote workforce). HIPAA only:
// network and device hygiene (router, updates, public Wi-Fi) is in the separate Cybersecurity course. Version 2 of the course.
// Verified against 45 CFR 164.310 (workstation use and security, device and media controls) and HHS's Security Rule summary.

export const m5: CourseModule = {
  key: "workplace",
  title: "Protecting patient information where you work",
  summary: "How HIPAA's physical safeguards apply to your workspace: workstations, devices, approved tools, and what to do when a device goes missing.",
  estimatedMinutes: 9,
  tracks: ["full"],
  keyPoints: [
    "HIPAA's physical safeguards cover how a workstation is used and the space around it.",
    "Use only approved devices, accounts and tools for patient information.",
    "Do not save, download, print, photograph or forward patient information unless your client allows it.",
    "Patient information must be removed properly before a device or media is reused or disposed of.",
    "A lost or stolen device is a security incident: report it immediately.",
  ],
  screens: [
    {
      id: "workstation",
      title: "Your workstation is part of the client's workplace",
      blocks: [
        { type: "paragraph", text: "The Security Rule requires policies on how workstations that can reach patient information are **used**, and on the **physical safeguards** around them. Working from home does not lower the standard: for as long as patient information is on your screen, your workspace is part of the client's workplace." },
        {
          type: "list",
          items: [
            "Work in a space where others cannot see your screen or hear your calls.",
            "Position your screen away from windows and doorways.",
            "Keep family, roommates and visitors out of view of patient information.",
            "Lock your computer whenever you step away, even at home.",
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
      id: "storing",
      title: "Saving, downloading, printing and photographing",
      blocks: [
        { type: "paragraph", text: "The safest place for patient information is where it already is: inside the client's system. Every extra copy is another place it can leak, and another thing the client cannot control." },
        {
          type: "list",
          items: [
            "Do not save patient information on your own computer unless your client allows it.",
            "Do not put it in personal cloud storage or notes apps.",
            "Do not print unless the client permits it, and return or destroy printouts as instructed.",
            "Do not take photos or screen recordings of patient information.",
            "Do not forward it to yourself \"to work on later\".",
          ],
        },
        { type: "callout", tone: "tip", text: "This is minimum necessary in practice: use the information where it is, and do not make more copies than the task needs." },
      ],
    },
    {
      id: "media",
      title: "Devices and media",
      blocks: [
        { type: "paragraph", text: "The rule requires control over the hardware and media that hold patient information: how they are received and moved, how they are **disposed of**, and how information is **removed before reuse**." },
        {
          type: "list",
          items: [
            "Devices ERS or the client issued stay under their control. Do not let others use them.",
            "Do not connect unknown USB drives or storage devices.",
            "When a device is returned or retired, the client or ERS clears it the approved way. Never wipe, sell or bin work equipment yourself.",
            "Keep a record, if asked, of what equipment you have.",
          ],
        },
      ],
    },
    {
      id: "lost",
      title: "Lost, stolen or shared devices",
      blocks: [
        { type: "paragraph", text: "If a device you use for work is lost, stolen, or used by someone else, it is a **security incident**. Tell your lead and HR immediately. Do not wait to see if it turns up." },
        { type: "paragraph", text: "Fast reporting lets the client lock or wipe the device and limits the harm. Delay is what turns a small problem into a serious one." },
        { type: "callout", tone: "info", text: "Module 6 explains exactly what to do and what not to do when something goes wrong." },
      ],
    },
    {
      id: "away",
      title: "When you cannot work in your usual space",
      blocks: [
        { type: "paragraph", text: "Sometimes your usual space or connection is not available. Your client's rules decide what is allowed: a secure connection they provide, a different private location, or waiting." },
        {
          type: "steps",
          items: [
            { title: "Pause", text: "Do not improvise with patient information." },
            { title: "Tell your lead", text: "A late task can be explained. A disclosure cannot be undone." },
            { title: "Use only what is approved", text: "A secure option your client allows, in a private space." },
          ],
        },
        { type: "callout", tone: "tip", text: "Everyday network and device habits, such as router settings, updates and public Wi-Fi, are covered in ERS's separate Cybersecurity course." },
      ],
    },
    {
      id: "scenario-cafe",
      title: "Try it: the cafe",
      blocks: [
        {
          type: "scenario",
          title: "Working away from home",
          prompt: "Your internet at home is down and a deadline is near. A nearby cafe has free Wi-Fi and a table by the window.",
          choices: [
            { text: "Work there, since it is only for an hour.", feedback: "A public room exposes your screen, and a public network is not an approved connection.", best: false },
            { text: "Tell your lead, use a secure option your client allows, or wait until you are in a private space on a safe connection.", feedback: "Correct. Protect the information first and ask for help with the deadline.", best: true },
            { text: "Work there but only on non-urgent patients.", feedback: "The risk is the same for any patient. The setting is the problem.", best: false },
          ],
        },
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
  q("workplace", "Workstation", "single", "Which setup best protects patient information at home?", ["A private space where others cannot see your screen or hear your calls", "A shared living room with the television on", "A busy cafe", "A sofa near the front door"], [0], "The workstation rule is about how a workstation is used and the surroundings. A private space prevents others from seeing or hearing patient information."),
  q("workplace", "Approved systems", "single", "You want to translate a paragraph that contains patient details. Which is the right choice?", ["Do not paste it into an online tool; ask your lead for an approved way", "Paste it into a free online translator", "Paste it into a public AI chatbot", "Email it to yourself and translate it later"], [0], "Pasting patient information into a public tool discloses it to an unauthorized party."),
  q("workplace", "Approved systems", "multiple", "Which of these are NOT approved ways to handle patient information? Select all that apply.", ["Personal email", "A free notes app on your phone", "The client's approved portal", "A personal cloud storage folder"], [0, 1, 3], "Personal email, consumer notes apps and personal cloud storage are not approved. The client's portal is."),
  q("workplace", "Screen lock", "single", "You need to get a glass of water at home for two minutes while a patient record is open. What should you do?", ["Lock your screen first", "Leave it as is since you are home", "Turn the screen brightness down", "Minimize the window"], [0], "A locked screen prevents others in the home from seeing or using the session."),
  q("workplace", "Working away", "single", "Your home internet is down and you have urgent work with patient information. What is the best choice?", ["Tell your lead and wait for a secure connection or use an option your client allows", "Use free public Wi-Fi at a cafe", "Use a neighbor's open network", "Share patient information through a personal phone"], [0], "Public and open networks and rooms are not approved for patient information. Ask for help and use only allowed secure options."),
  q("workplace", "Storing", "true_false", "True or false: It is fine to save patient information to your own computer's desktop if you delete it at the end of the day.", ["True", "False"], [1], "Do not save patient information locally unless your client allows it. Keep it in the approved system."),
  q("workplace", "Photos", "single", "A bug appears on your screen with a patient chart open. A teammate asks you to take a picture with your phone. What do you do?", ["Decline and report the problem through the approved channel without patient details", "Take the photo and send it privately", "Take the photo and blur the name", "Record a video of the whole screen"], [0], "Photos of patient information on a personal device are unapproved copies of PHI."),
  q("workplace", "Lost device", "single", "You notice your work laptop is missing after a trip. What is the right action?", ["Tell your lead and HR immediately", "Wait a few days in case it turns up", "Buy a new one and say nothing", "Post on social media asking for help"], [0], "A lost device is a security incident. Immediate reporting lets the client lock or wipe it and limits harm."),
  q("workplace", "Shared devices", "single", "Your work laptop breaks and a family member offers their shared computer. What should you do?", ["Do not use it and ask your lead for an approved option", "Use it and log out afterward", "Use it only for non-urgent tasks", "Use it in a private browser window"], [0], "Only approved devices should be used for patient information. A shared home computer is not approved."),
  q("workplace", "Disposal and reuse", "single", "A laptop issued for client work is being returned and will be reused by someone else. What should happen to the patient information on it?", ["The client or ERS removes it in the approved way before reuse", "Nothing, since the next user is also an ERS employee", "You delete the files you remember and send it back", "You keep a copy first in case it is needed"], [0], "The Security Rule requires information to be removed from media before reuse and for disposal to be handled properly. It is done in the approved way, not by individuals improvising."),
];
