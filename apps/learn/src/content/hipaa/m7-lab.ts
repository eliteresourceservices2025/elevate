import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 7: the scenario lab. Mixed situations that combine the earlier modules. All people and details are invented.

export const m7: CourseModule = {
  key: "lab",
  title: "Scenario lab and readiness check",
  summary: "Realistic situations that mix everything you learned, then a short checklist before the exam.",
  estimatedMinutes: 10,
  tracks: ["full"],
  keyPoints: [
    "Real situations combine several rules at once. Slow down and run the five questions: Who, What, Why, Where, How.",
    "The safest answer is rarely the fastest. It is the one that keeps information where it belongs.",
    "Report problems early. Silence is the one answer that is always wrong.",
  ],
  screens: [
    {
      id: "intro",
      title: "Put it all together",
      blocks: [
        { type: "paragraph", text: "Real situations rarely say which rule applies. In this lab you will meet six everyday situations. Choose what you would do, read the feedback, and notice what each one reminds you of." },
        { type: "callout", tone: "tip", text: "Use the 5-point send check: Who, What, Why, Where, How. If any answer is \"not sure\", stop and ask." },
      ],
    },
    {
      id: "lab-1",
      title: "Scenario 1: the quick favor",
      blocks: [
        {
          type: "scenario",
          title: "A coworker's request",
          prompt: "A coworker on another client's team messages you: \"Can you send me the appointment list from your clinic? I want to see how they format theirs.\"",
          choices: [
            { text: "Send it. They work at ERS too.", feedback: "Working at ERS does not give anyone access to another client's patients.", best: false },
            { text: "Decline, and suggest asking your lead for a sample with no patient information.", feedback: "Correct. Same company is not the same need to know.", best: true },
            { text: "Remove the last names and send it.", feedback: "First names plus appointments can still identify patients.", best: false },
          ],
        },
      ],
    },
    {
      id: "lab-2",
      title: "Scenario 2: the email draft",
      blocks: [
        {
          type: "scenario",
          title: "Autofill surprise",
          prompt: "You are about to send a billing summary to the client's accounting contact. The email program has filled in a different, similar address you do not recognize.",
          choices: [
            { text: "Send it. The program probably knows best.", feedback: "Autofill is a common cause of misdirected PHI.", best: false },
            { text: "Stop, check the address against the client's contact list, correct it, and then send.", feedback: "Correct. The Where? of the 5-point check.", best: true },
          ],
        },
      ],
    },
    {
      id: "lab-3",
      title: "Scenario 3: the home visitor",
      blocks: [
        {
          type: "scenario",
          title: "A visitor in the room",
          prompt: "A friend comes by while you are working. Your screen shows a patient list, and your friend sits next to you to chat.",
          choices: [
            { text: "Keep working. They are not paying attention.", feedback: "They can still see the screen.", best: false },
            { text: "Lock the screen or switch to a private space before they come near, and finish work when they are gone.", feedback: "Correct. Control who can see your screen.", best: true },
            { text: "Turn the screen brightness down.", feedback: "That does not stop someone from reading it.", best: false },
          ],
        },
      ],
    },
    {
      id: "lab-4",
      title: "Scenario 4: the helpful stranger",
      blocks: [
        {
          type: "scenario",
          title: "A call from \"the vendor\"",
          prompt: "A caller says he is from the software company that supports your client's system. \"We saw a problem on your account. I just need your password to fix it.\"",
          choices: [
            { text: "Give the password. They know the account name.", feedback: "Knowing an account name is not proof. Real support never needs your password.", best: false },
            { text: "Decline, hang up, and report the call to your lead.", feedback: "Correct. This is vishing.", best: true },
            { text: "Give a fake password to test them.", feedback: "That is risky and unnecessary. Just hang up and report.", best: false },
          ],
        },
      ],
    },
    {
      id: "lab-5",
      title: "Scenario 5: the late-night mistake",
      blocks: [
        {
          type: "scenario",
          title: "You notice it after hours",
          prompt: "Late at night you realize that earlier you uploaded a patient file to your personal cloud storage to \"work on it later\". Nobody else knows.",
          choices: [
            { text: "Delete it now and say nothing. No harm done.", feedback: "Deleting without telling means the incident never gets handled.", best: false },
            { text: "Report it to your lead and HR right away, and follow their instructions on the file.", feedback: "Correct. Report even when it feels small or embarrassing.", best: true },
            { text: "Wait until morning so you do not bother anyone.", feedback: "A report at night is welcome. Delay uses up valuable time.", best: false },
          ],
        },
      ],
    },
    {
      id: "lab-6",
      title: "Scenario 6: the helpful reply",
      blocks: [
        {
          type: "scenario",
          title: "A patient writes to you",
          prompt: "A patient emails your personal work address: \"Can you tell me my last test results? I forgot my portal password.\"",
          choices: [
            { text: "Reply with the results to be helpful.", feedback: "You cannot confirm who is writing, and email is not the approved way.", best: false },
            { text: "Do not share anything. Follow the client's process, for example pointing them to the clinic's phone line or portal reset.", feedback: "Correct. Stay kind, share nothing, use the approved process.", best: true },
            { text: "Ask them to send a copy of their ID by email.", feedback: "That creates more sensitive data in an unapproved channel.", best: false },
          ],
        },
      ],
    },
    {
      id: "ready",
      title: "Are you ready for the exam?",
      blocks: [
        { type: "paragraph", text: "You can take the exam when you feel ready. It has questions drawn from all the modules, you need 85% to pass, and you have 3 tries. If a try does not go well, you will see which topics to revisit." },
        {
          type: "list",
          items: [
            "I can tell what counts as PHI, including screenshots and spoken information.",
            "I use only the minimum information and the approved channels.",
            "I keep my login, screen and devices private and locked.",
            "I use my own login, keep it private, and never share a password or code.",
            "I know to report any possible incident immediately to my lead and HR.",
          ],
        },
      ],
    },
  ],
};

export const q7: QuestionSeed[] = [
  q("lab", "Scenario", "scenario", "A coworker from a different client team asks you to send them your clinic's appointment list \"just for formatting ideas\". What do you do?", ["Decline and suggest a sample with no patient information", "Send it, because they also work at ERS", "Send it with last names removed", "Send it by personal email so it is not logged"], [0], "Being at the same company is not a need to know. First names and appointments can still identify patients."),
  q("lab", "Scenario", "scenario", "Before sending a billing summary, you notice the email program autofilled a similar address you do not recognize. What do you do?", ["Check the address against the client's contact list and correct it first", "Send it and fix it if anyone complains", "Send it to both addresses", "Send it without the attachment and add it later"], [0], "Misdirected email is a common cause of incidents. Verify the destination before sending."),
  q("lab", "Scenario", "scenario", "A friend comes into your workspace while a patient list is on your screen. What is the best response?", ["Lock the screen or move before they see it", "Keep working and angle the monitor slightly", "Ask them to look away", "Cover the screen with a book"], [0], "The safe action is to prevent exposure by locking the screen or moving to a private space."),
  q("lab", "Scenario", "scenario", "A caller says he is from a vendor and needs your password to fix a problem. What should you do?", ["Hang up and report the call to your lead", "Give the password but ask them to call back", "Give a different password", "Ask for their phone number and call them later"], [0], "Real support never needs your password. This is a social engineering attempt and should be reported."),
  q("lab", "Scenario", "scenario", "Late at night you realize you saved a patient file to your personal cloud storage earlier. What should you do?", ["Report it right away to your lead and HR and follow their instructions", "Delete it and say nothing", "Wait until morning in case it was nothing", "Move it to another personal folder"], [0], "A report is needed even when you delete the copy, because the exposure may already have happened."),
  q("lab", "Scenario", "scenario", "A patient emails you asking for their test results because they forgot their portal password. What do you do?", ["Share nothing and point them to the client's approved process", "Reply with the results", "Ask for a copy of their ID by email", "Call the number in the email signature and read the results"], [0], "You cannot verify the sender and email is not an approved channel. Use the client's process."),
  q("lab", "Scenario", "scenario", "Your client's instructions say to send claim files only through the secure portal, but a coworker suggests email \"because it is faster\". What do you do?", ["Use the portal as instructed", "Use email this once", "Use a personal messaging app", "Split the file into smaller parts and email them"], [0], "Client instructions define approved channels. Convenience does not override them."),
  q("lab", "Scenario", "scenario", "You spot your own name on a patient list because you are also a patient at the client's clinic. What may you do with your own record?", ["Nothing beyond your assigned task; use the clinic's patient process for your own information", "Open your record and check it", "Share your record with your family", "Update it yourself"], [0], "Your work access is not for personal use, even for your own record. Use the clinic's patient process."),
  q("lab", "Scenario", "scenario", "A message in a client chat group asks everyone to \"reply with your password to confirm your account\". What do you do?", ["Do not reply, and report it", "Reply because it is in the official group", "Reply with an old password", "Reply with only the first half of your password"], [0], "No legitimate service requests passwords this way, and group chats can be compromised. Report it."),
  q("lab", "Scenario", "scenario", "Your lead asks you to prepare a spreadsheet with only the invoice number and amount. You also have the patients' names available. What should the spreadsheet contain?", ["Only the invoice number and amount", "Invoice number, amount and patient names for convenience", "Everything, filtered later by the recipient", "A copy of the full billing report"], [0], "Minimum necessary: provide only what the task needs."),
];
