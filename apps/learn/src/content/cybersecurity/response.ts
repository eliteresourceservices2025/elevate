import { q, type CourseModule, type QuestionSeed } from "../schema";

export const responseModule: CourseModule = {
  key: "response",
  title: "When something goes wrong",
  summary: "How to recognize that something is wrong, what to do in the first minutes, and why speed and honesty matter more than being sure.",
  estimatedMinutes: 8,
  tracks: ["full"],
  keyPoints: [
    "Signs of trouble: unexpected prompts, locked files, strange messages sent from your account, odd pop-ups.",
    "Stop, disconnect if told to, and tell your lead right away. You do not have to be sure.",
    "Do not try to fix it quietly, delete evidence or reply to the attacker.",
    "Say exactly what you did and when. Facts help the response.",
    "Nobody is punished for reporting in good faith.",
  ],
  screens: [
    {
      id: "signs",
      title: "Signs that something is wrong",
      blocks: [
        { type: "paragraph", text: "Many incidents are noticed first by the person involved. Learn the signs, and treat them as worth reporting even when you are not sure." },
        {
          type: "list",
          items: [
            "A sign-in prompt, code or password-reset message you did not ask for",
            "Files that will not open, or that have changed names",
            "Messages that your contacts say they received from you, which you did not send",
            "Programs you did not install, or a computer that has suddenly become very slow",
            "A pop-up or call insisting your computer is infected",
            "A lost or stolen device, or a message sent to the wrong person",
          ],
        },
      ],
    },
    {
      id: "first-minutes",
      title: "The first minutes",
      blocks: [
        {
          type: "steps",
          items: [
            { title: "Stop", text: "Stop what you are doing. Do not click further or reply." },
            { title: "Disconnect if told to", text: "Take the device off the network if your instructions say so, but do not switch it off unless told to." },
            { title: "Tell your lead", text: "Right away, by the quickest way. Follow your client's own steps as well." },
            { title: "Write down what happened", text: "What you saw, what you did, and when." },
            { title: "Follow instructions", text: "Do what you are asked, and nothing more." },
          ],
        },
      ],
    },
    {
      id: "not-to-do",
      title: "What not to do",
      blocks: [
        {
          type: "compare",
          left: { title: "Do", items: ["Report straight away", "Keep the message or file as it is", "Write down facts", "Cooperate fully"] },
          right: { title: "Do not", items: ["Try to fix it quietly", "Delete the message or file", "Reply to the attacker or pay", "Warn everyone in a public chat first"] },
        },
        { type: "callout", tone: "warning", text: "Trying to hide a mistake is far worse than the mistake. Honest and fast is always the right answer." },
      ],
    },
    {
      id: "what-happens",
      title: "What the organization does",
      blocks: [
        { type: "paragraph", text: "Once you report, others take over. They check what was reached, contain it, change passwords or keys, restore from backups if needed, and decide whether anyone else has to be told. That is why your fast, accurate report matters: they can only start when they know." },
        { type: "paragraph", text: "Afterwards the organization learns from it. The question is \"what would have prevented this?\", not \"who is to blame?\"." },
      ],
    },
    {
      id: "scenario-wrong-recipient",
      title: "Try it: the message to the wrong person",
      blocks: [
        {
          type: "scenario",
          title: "It went to the wrong address",
          prompt: "You emailed a file with sensitive details to a contact, and a minute later you realize autofill picked a similar address at another company.",
          choices: [
            { text: "Send a second email asking them to ignore the first.", feedback: "That does not report the problem, and it creates another message.", best: false },
            { text: "Tell your lead and describe what you sent and where, right away.", feedback: "Correct. The earlier it is reported, the more can be done.", best: true },
            { text: "Say nothing and fix autofill so it does not happen again.", feedback: "Fixing autofill is good but the incident still needs to be reported.", best: false },
          ],
        },
      ],
    },
    {
      id: "scenario-clicked",
      title: "Try it: you clicked",
      blocks: [
        {
          type: "scenario",
          title: "A click you regret",
          prompt: "You clicked a link in a message and typed your password on the page that opened. Then you noticed the address looked wrong.",
          choices: [
            { text: "Change the password through the official site and tell your lead right away.", feedback: "Correct. Change it the official way and report: both, quickly.", best: true },
            { text: "Hope nothing happens and carry on.", feedback: "The password is already in the attacker's hands. Act now.", best: false },
            { text: "Close the browser and delete your history.", feedback: "That does not undo anything and removes useful evidence.", best: false },
          ],
        },
      ],
    },
  ],
};

export const responseQuestions: QuestionSeed[] = [
  q("response", "Signs", "multiple", "Which of these could be a sign that something is wrong? Select all that apply.", ["A sign-in prompt you did not ask for", "Files that suddenly will not open", "Contacts saying they got a message from you that you did not send", "A calendar reminder you set yourself"], [0, 1, 2], "Unexpected prompts, locked files and messages you did not send are warning signs. Your own reminder is not."),
  q("response", "First steps", "single", "You suspect your account was used by someone else. What is the best first step?", ["Tell your lead right away", "Wait a few days to see", "Change nothing and keep working", "Reply to the strange messages to ask who sent them"], [0], "Fast reporting limits the damage, and you do not have to be sure."),
  q("response", "First steps", "single", "Your device may be infected. What should you do?", ["Disconnect it from the network if told to, and report it", "Keep working on it", "Plug in a USB drive to copy your files first", "Restart it repeatedly"], [0], "Contain the problem and report it. Copying files or restarting can spread or destroy evidence."),
  q("response", "Evidence", "single", "You received a suspicious email and clicked a link. What should you do with the email?", ["Keep it and report it", "Delete it immediately", "Forward it to everyone", "Print it and throw it away"], [0], "Do not delete evidence. The message helps responders understand what happened."),
  q("response", "Evidence", "true_false", "True or false: After a mistake, you should delete anything that shows what happened so nobody finds out.", ["True", "False"], [1], "Hiding or deleting evidence makes the response harder and the outcome worse. Report and preserve it."),
  q("response", "Honesty", "single", "Why does it matter to say exactly what you did and when?", ["Facts let the response start in the right place quickly", "So you can be blamed", "So it can be forgotten", "It does not matter"], [0], "An accurate account helps responders find out what was reached and what to fix."),
  q("response", "Blame", "true_false", "True or false: People are punished for reporting a possible incident in good faith, even if it turns out to be nothing.", ["True", "False"], [1], "Good-faith reporting is encouraged. Fast reporting is how problems are kept small."),
  q("response", "Attackers", "single", "A message after an attack says to pay and reply to get your files back. What should you do?", ["Do not reply or pay, and leave it to the people responsible", "Pay to be safe", "Reply to negotiate", "Forward it to a friend"], [0], "Paying is not a fix and is not your decision. Replying can make things worse."),
  q("response", "Wrong recipient", "single", "You notice you sent information to the wrong person a minute ago. What do you do?", ["Report it to your lead right away and say what you sent and where", "Send another email asking them to ignore it, and say nothing", "Hope they do not open it", "Wait until the end of the day"], [0], "The incident must be reported, and the sooner the better."),
  q("response", "After clicking", "single", "You typed your password into a page you now think was fake. What should you do?", ["Change it by the official route and tell your lead right away", "Wait and see", "Delete your history", "Clear your cookies and carry on"], [0], "The password is already exposed. Change it the official way and report it, both quickly."),
];
