import { q, type CourseModule, type QuestionSeed } from "../schema";

export const physicalModule: CourseModule = {
  key: "physical",
  title: "Handling information and physical security",
  summary: "Knowing what is sensitive, sharing only what is needed, protecting paper and screens, and the in-person tricks attackers use.",
  estimatedMinutes: 13,
  tracks: ["full"],
  keyPoints: [
    "Know what you are handling, and treat client and personal information as sensitive by default.",
    "Share with the people who need it, through the approved way, and no more.",
    "Paper, screens and conversations leak too. Keep them out of sight and earshot.",
    "Do not hold a door for someone you do not know, and do not leave anything unattended.",
    "Dispose of information properly, and ask when you are not sure how.",
    "Information is not secure just because it is on paper or in a bin: keep it only as long as needed and destroy it properly.",
  ],
  screens: [
    {
      id: "what-is-sensitive",
      title: "What counts as sensitive",
      blocks: [
        { type: "paragraph", text: "Not everything needs the same care, but a good rule is: if it would hurt someone, or a client, to see it in the wrong hands, treat it as sensitive." },
        {
          type: "list",
          items: [
            "Client information, contracts and plans",
            "Personal information: names with ID numbers, contact details, addresses, dates of birth",
            "Account details, passwords, codes and keys",
            "Anything marked confidential, or that your client told you to protect",
          ],
        },
      ],
    },
    {
      id: "need-to-know",
      title: "Need to know, and the approved way",
      blocks: [
        { type: "paragraph", text: "Access is meant to match a job. If you can open something you do not need, that is not permission to look. Share information only with people who need it for their work, and only through the channel the client or ERS set up." },
        {
          type: "steps",
          items: [
            { title: "Who needs it?", text: "Is this person part of the task?" },
            { title: "How much?", text: "Only what answers the question." },
            { title: "By which way?", text: "The approved system, not personal email or chat." },
          ],
        },
      ],
    },
    {
      id: "paper-and-screens",
      title: "Paper, screens and conversations",
      blocks: [
        { type: "paragraph", text: "Information on paper, on a screen or in a conversation can be seen or heard by people nearby. Keep a clean workspace:" },
        {
          type: "list",
          items: [
            "Keep notes and printouts with sensitive details locked away when you are done.",
            "Do not leave a screen showing information when you step away.",
            "Take calls where others cannot hear the details.",
            "Do not photograph screens or documents with a personal phone.",
          ],
        },
      ],
    },
    {
      id: "check-the-desk",
      title: "Check the desk: what leaks information?",
      blocks: [
        {
          type: "hotspot",
          title: "A desk during a client call",
          prompt: "A team member takes a call at home. Tap everything that puts information at risk, then check.",
          items: [
            { label: "Screen", text: "Left open on a billing summary while the team member steps away", problem: true, why: "Do not leave a screen showing information when you step away." },
            { label: "Printout", text: "A client summary left in the printer tray", problem: true, why: "Keep printouts with sensitive details locked away when you are done." },
            { label: "Sticky note", text: "A password written on a note under the keyboard", problem: true, why: "Passwords and codes are sensitive, and a note under the keyboard is easy to find." },
            { label: "Drawer", text: "Notes locked away when the work is finished" },
            { label: "Call", text: "Taken on a headset in a room with the door closed" },
            { label: "Phone", text: "A personal phone kept off the documents, not used to photograph them" },
          ],
          explanation: "A clean workspace keeps paper, screens and conversations out of sight and earshot.",
        },
      ],
    },
    {
      id: "tailgating",
      title: "People in person",
      blocks: [
        { type: "paragraph", text: "Social engineering works face to face too. **Tailgating** is walking in behind someone who opened a door. Attackers pose as delivery staff, repair people or a new colleague with their hands full." },
        {
          type: "scenario",
          title: "Someone follows you in",
          prompt: "You are entering a shared building and a person in a uniform carrying boxes says \"hold the door, please\". You do not recognize them.",
          choices: [
            { text: "Hold the door. They look like they are working.", feedback: "A uniform proves nothing. Attackers rely on politeness.", best: false },
            { text: "Politely ask them to use their own access, or to ring or check in with the front desk.", feedback: "Correct. Politeness is fine; letting strangers in is not.", best: true },
          ],
        },
      ],
    },
    {
      id: "disposal",
      title: "Getting rid of information",
      blocks: [
        { type: "paragraph", text: "Throwing information away is a way to lose it. Anyone can read what goes into a bin, and old devices keep what was on them." },
        {
          type: "list",
          items: [
            "Shred paper with sensitive details, or return it as instructed.",
            "Do not sell, give away or recycle a work device. It is cleared the approved way.",
            "Delete files from approved systems only as your instructions say.",
            "If you are not sure how to dispose of something, keep it safe and ask.",
          ],
        },
      ],
    },
    {
      id: "retention",
      title: "Keep only what you need, for as long as you need it",
      blocks: [
        { type: "paragraph", text: "Every copy of information is a risk, on screen or on paper. The safest information is the information you no longer hold. Follow your client's instructions on how long something may be kept and where." },
        {
          type: "steps",
          items: [
            { title: "Do the task", text: "Work in the client's system where you can." },
            { title: "Do not copy", text: "No extra files, notes or printouts unless told to." },
            { title: "Clear up", text: "Remove downloads and working copies as instructed." },
            { title: "Destroy properly", text: "Shred or use the approved method, not the bin." },
          ],
        },
      ],
    },
    {
      id: "shred-keep-ask",
      title: "Quick sort: shred, lock away or follow instructions?",
      blocks: [
        {
          type: "cards",
          title: "What happens to it",
          prompt: "Sort each item, one at a time.",
          groups: ["Shred or return it","Lock it away","Follow instructions or ask"],
          cards: [
            { text: "A printout with sensitive details that you have finished with", group: 0, feedback: "Shred paper with sensitive details, or return it as instructed." },
            { text: "Notes with sensitive details that you will need tomorrow", group: 1, feedback: "Keep notes with sensitive details locked away when you are done." },
            { text: "A retired work laptop", group: 2, feedback: "Do not sell, give away or recycle a work device. It is cleared the approved way." },
            { text: "Something you are not sure how to dispose of", group: 2, feedback: "If you are not sure how to dispose of something, keep it safe and ask." },
            { text: "A download you no longer need", group: 2, feedback: "Remove downloads and working copies as instructed." },
            { text: "A printout you need to keep until the task is done", group: 1, feedback: "Keep printouts locked away when you are not using them." },
          ],
        },
        {
          type: "sort",
          title: "Keep only what you need",
          prompt: "Put the steps of handling information in order.",
          items: ["Do the task, working in the client system where you can","Do not copy: no extra files, notes or printouts unless told to","Clear up downloads and working copies as instructed","Destroy properly: shred or use the approved method"],
          explanation: "Do the task without making copies, then clear up and destroy what is left the approved way, not in the bin.",
        },
      ],
    },
    {
      id: "case-home-printer",
      title: "Worked case: the home printer",
      blocks: [
        {
          type: "case",
          title: "Three pages, one tired evening",
          scenario: "You need to read a client's three-page billing summary carefully, and the screen is tiring. You print it on your home printer, read it, and leave it in a drawer to \"deal with in the morning\". In the morning a visitor is staying and the drawer is open.",
          question: "What went wrong, and what should happen to the pages?",
          answer: "Printing created an extra copy outside the client's system, which the client probably did not allow and cannot control, and it was left where others could reach it. The pages should be secured now, and the print reported to your lead so the client can decide what to do. Next time, ask whether printing is permitted and how paper must be destroyed. Throwing it in the bin is not destruction.",
        },
      ],
    },
    {
      id: "quick-round-physical",
      title: "Quick round: handling information",
      blocks: [
        {
          type: "game",
          title: "Handling information sprint",
          rounds: [
            { question: "A stranger in a uniform asks you to hold the door. What is the best response?", options: [{ text: "Politely ask them to use their own access or check in at the front desk", correct: true, feedback: "Right. A uniform proves nothing." }, { text: "Hold the door", correct: false, feedback: "Attackers rely on politeness." }, { text: "Ask them to promise they work here", correct: false, feedback: "A promise proves nothing." }] },
            { question: "Where do old printouts with sensitive details go?", options: [{ text: "Shredded, or returned as instructed", correct: true, feedback: "Right." }, { text: "The normal bin", correct: false, feedback: "Anyone can read what goes in the bin." }, { text: "A drawer at home for ever", correct: false, feedback: "Keep only what you need, for as long as you need it." }] },
            { question: "You are not sure how to dispose of something. What now?", options: [{ text: "Keep it safe and ask", correct: true, feedback: "Right." }, { text: "Throw it in the bin", correct: false, feedback: "Ask first." }, { text: "Give it away", correct: false, feedback: "Devices and papers keep what was on them." }] },
            { question: "Which way may you share a document with sensitive details?", options: [{ text: "The approved system, with those who need it", correct: true, feedback: "Right." }, { text: "Personal chat", correct: false, feedback: "Use the approved system." }, { text: "A public channel", correct: false, feedback: "Share only with people who need it." }] },
            { question: "May you photograph a work document with your personal phone?", options: [{ text: "No: it is an unapproved copy", correct: true, feedback: "Right." }, { text: "Yes, if it is small", correct: false, feedback: "A photo is still a copy." }, { text: "Yes, if you delete it later", correct: false, feedback: "It still sat outside approved systems." }] },
          ],
        },
      ],
    },
    {
      id: "check",
      title: "Quick check",
      blocks: [
        {
          type: "check",
          question: "Which of these are good ways to protect sensitive information? Select all that apply.",
          multiple: true,
          options: [
            { text: "Lock away printouts when you finish", correct: true, feedback: "Right. Paper is easy to forget." },
            { text: "Take calls out of earshot", correct: true, feedback: "Right. Conversations leak too." },
            { text: "Share only with those who need it", correct: true, feedback: "Right. Need to know." },
            { text: "Put old printouts in the normal bin", correct: false, feedback: "Anyone can read what goes in the bin. Shred or return it." },
          ],
        },
      ],
    },
  ],
};

export const physicalQuestions: QuestionSeed[] = [
  q("physical", "Sensitive", "multiple", "Which of these should be treated as sensitive? Select all that apply.", ["Client contracts and plans", "A list of names with ID numbers", "Account passwords and codes", "A public holiday calendar"], [0, 1, 2], "Anything that would hurt a person or client in the wrong hands is sensitive. A public calendar is not."),
  q("physical", "Need to know", "single", "Your login can open a folder that is not part of your task. What is the right response?", ["Do not open it and tell your lead so access can be corrected", "Open it once to look around", "Use it if a friend asks", "Say nothing so nobody removes your access"], [0], "Being able to open something is not permission. Report extra access so it can be fixed."),
  q("physical", "Sharing", "single", "Which is the best way to send a document with sensitive details to a colleague who needs it?", ["Through the approved system your client or ERS set up", "Through a personal chat app", "By personal email", "By posting it in a public channel"], [0], "Use the approved system, to the person who needs it, with no more than is needed."),
  q("physical", "Paper", "single", "You have finished with a printout that contains sensitive details. What should you do?", ["Shred it or return it as instructed", "Put it in the normal bin", "Leave it on the desk", "Take a photo and throw it away"], [0], "Anything in a normal bin can be read by anyone. Shred or return sensitive paper."),
  q("physical", "Screens", "single", "You get a phone call about a client at home and family members are nearby. What is the best practice?", ["Move to a private space or use a headset", "Put the call on speaker", "Repeat the details aloud to confirm", "Continue in a shared kitchen"], [0], "Conversations leak too. Take calls where others cannot overhear."),
  q("physical", "Tailgating", "single", "A stranger in a uniform asks you to hold the door of a secure area. What should you do?", ["Politely ask them to use their own access or check in at the front desk", "Hold the door", "Let them in if they are carrying something heavy", "Ask them to promise they work here"], [0], "Tailgating relies on politeness. A uniform proves nothing."),
  q("physical", "Social engineering", "single", "Someone you do not know calls and says they are from a vendor and asks for details of your work setup. What do you do?", ["Share nothing and report the call", "Answer to be polite", "Give only some details", "Ask them to email you the question"], [0], "Detailed questions about your setup from someone you do not know are a common first step of an attack."),
  q("physical", "Disposal", "single", "A work laptop is being retired. What should happen to it?", ["It is cleared the approved way by ERS or the client", "You give it to a relative", "You sell it online after deleting files", "You keep it as is"], [0], "Devices keep what was on them. Clearing is done the approved way, not by individuals."),
  q("physical", "Photos", "true_false", "True or false: It is fine to photograph a work document with your personal phone to save time.", ["True", "False"], [1], "A photo on a personal phone is an unapproved copy outside the systems that protect the information."),
  q("physical", "Clean desk", "single", "Which habit best protects information at your desk?", ["Locking away notes and printouts, and locking your screen when you leave", "Leaving notes in plain view for convenience", "Writing passwords under the keyboard", "Leaving your screen open all day"], [0], "A clean, locked workspace stops casual and opportunistic exposure."),
  q("physical", "Retention", "single", "Why should you avoid keeping extra copies of client information?", ["Every copy is another place it can leak, and the client cannot control it", "Copies take up space on the desk", "Copies cost money", "Clients dislike paper"], [0], "Extra copies multiply risk and sit outside the client's control."),
  q("physical", "Printing", "single", "May you print a client's document at home to read it?", ["Only if the client allows it and tells you how to destroy the pages", "Yes, if you keep it in a drawer", "Yes, if you throw it in the bin afterward", "Yes, if it is short"], [0], "Printing creates a copy outside the approved system and needs permission and a destruction method."),
  q("physical", "Destruction", "single", "Which is an acceptable way to dispose of printed client information?", ["Shredding it or using the method the client approved", "Throwing it in the household bin", "Tearing it once", "Leaving it for the cleaner"], [0], "Only proper destruction protects the information from being reassembled."),
  q("physical", "Destruction", "true_false", "True or false: Deleting a file from your desktop and emptying the recycle bin permanently destroys it in every case.", ["True", "False"], [1], "Deleted files can remain on a device or in backups, so media must be cleared the approved way."),
  q("physical", "Clean desk", "multiple", "Which of these belong to a clean-desk habit? Select all that apply.", ["Putting papers away when you leave", "Locking your screen", "Keeping passwords off sticky notes", "Leaving a list of patient names beside the keyboard"], [0, 1, 2], "A clean desk limits what anyone passing can see or take."),
  q("physical", "Retention", "single", "Who decides how long a copy of client information may be kept, and where?", ["Your client's instructions","You, as you see fit","Whoever prints it","Nobody, copies can be kept for ever"], [0], "Follow your client's instructions on how long something may be kept and where."),
  q("physical", "Retention", "multiple", "Which of these belong in keeping only what you need? Select all that apply.", ["Work in the client system where you can","Do not make extra copies unless told to","Clear up downloads and working copies as instructed","Make a spare copy for safekeeping"], [0,1,2], "Extra copies multiply the risk and sit outside the client's control."),
  q("physical", "Tailgating", "true_false", "True or false: A uniform shows that a person may enter a secure area.", ["True","False"], [1], "A uniform proves nothing, and attackers rely on politeness."),
  q("physical", "Paper", "single", "Where should a printout with sensitive details be when you finish for the day?", ["Locked away","On the desk","In the printer tray","In the normal bin"], [0], "Keep printouts with sensitive details locked away when you are done."),
];
