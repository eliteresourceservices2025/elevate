import type { CourseModule } from "../schema";

// Customer Service course, module 4. Invented people and details only.

export const listeningModule: CourseModule = {
  key: "listening",
  title: "Active listening and empathy",
  summary: "How to listen so people feel heard, the difference between empathy and sympathy, and empathy statements that sound real.",
  estimatedMinutes: 16,
  tracks: ["full"],
  keyPoints: [
    "Active listening means focusing fully on understanding before you respond.",
    "The process is Listen, Clarify, Confirm, Respond.",
    "Empathy is understanding someone's feelings. Sympathy is feeling sorry for them. Empathy works better in service.",
    "An empathy statement sounds real when it names the person's actual situation.",
    "Never say “calm down”. It dismisses the feeling.",
  ],
  screens: [
    {
      id: "what-is-listening",
      title: "What active listening is",
      blocks: [
        { type: "paragraph", text: "Active listening means giving the speaker your full attention and trying to understand before you respond. It is not waiting for your turn to talk, and it is not only taking notes." },
        { type: "callout", tone: "tip", text: "If you are planning your answer while they are still speaking, you are not listening yet." },
      ],
    },
    {
      id: "why-it-matters",
      title: "Why it matters",
      blocks: [
        { type: "paragraph", text: "People who feel heard are more likely to stay calm, cooperate, trust the process and accept a solution. The same words can work or fail, depending on whether the person feels listened to first." },
        {
          type: "layers",
          title: "What listening makes possible",
          items: [
            { label: "Calm", text: "People lower their voices when they feel heard." },
            { label: "Cooperation", text: "They answer your questions more willingly." },
            { label: "Trust", text: "They believe you are on their side." },
            { label: "Acceptance", text: "They are more open to the solution you offer." },
          ],
        },
      ],
    },
    {
      id: "four-steps",
      title: "The four steps",
      blocks: [
        { type: "paragraph", text: "Active listening has four steps, in this order. Put them in order." },
        {
          type: "sort",
          title: "Put the listening steps in order",
          prompt: "Drag the steps into the right order.",
          items: ["Listen", "Clarify", "Confirm", "Respond"],
          explanation: "You listen fully, clarify what you did not understand, confirm you have it right, and only then respond.",
        },
        {
          type: "list",
          items: ["**Listen**: give your full attention, no multitasking.", "**Clarify**: ask open questions: “Can you tell me more about what happened?”", "**Confirm**: say it back: “So you sent it three days ago and have heard nothing.”", "**Respond**: now answer or act."],
        },
      ],
    },
    {
      id: "empathy-vs-sympathy",
      title: "Empathy and sympathy",
      blocks: [
        {
          type: "compare",
          left: { title: "Empathy", items: ["Understanding how someone feels", "“That sounds frustrating.”", "Moves the conversation forward"] },
          right: { title: "Sympathy", items: ["Feeling sorry for someone", "“Oh, poor you.”", "Can leave the person feeling pitied"] },
        },
        { type: "paragraph", text: "In customer service, empathy usually works better. It tells people you understand, and then it points toward a solution." },
      ],
    },
    {
      id: "empathy-statements",
      title: "Empathy statements that sound real",
      blocks: [
        { type: "paragraph", text: "Empathy sounds scripted when it is the same phrase every time. It sounds real when it connects to the person's situation." },
        {
          type: "compare",
          left: { title: "Sounds real", items: ["“Waiting two days with no word is frustrating.”", "“That sounds like a stressful week.”"] },
          right: { title: "Sounds scripted", items: ["“I understand your frustration.” (every time)", "“I apologize for any inconvenience.”"] },
        },
        {
          type: "cards",
          title: "Empathy or not?",
          prompt: "Sort each reply.",
          groups: ["Shows empathy", "Does not"],
          cards: [
            { text: "“I understand how frustrating that must be.”", group: 0, feedback: "It names the feeling without arguing." },
            { text: "“Calm down.”", group: 1, feedback: "It dismisses the feeling and often makes it worse." },
            { text: "“That is our policy.”", group: 1, feedback: "Policy can come after the person feels heard." },
            { text: "“Thank you for bringing this to our attention.”", group: 0, feedback: "It values the person for speaking up." },
            { text: "“I appreciate your patience.”", group: 0, feedback: "It recognizes what the wait has cost them." },
          ],
        },
      ],
    },
    {
      id: "call-practice",
      title: "Practice: a repeat caller",
      blocks: [
        {
          type: "branch",
          title: "Two calls and no update",
          intro: "A caller (invented) has phoned twice already and still has no update.",
          startMood: 35,
          record: { title: "Customer record", rows: [{ label: "Caller", value: "Daniel T. (invented)" }, { label: "Calls so far", value: "Two" }, { label: "Issue", value: "No update on a request" }] },
          turns: [
            { caller: "I have called twice and still have no update.", choices: [{ text: "I am sorry you have had to call twice. Let me look at your request right now and tell you what I find.", mood: 20, reply: "Okay. Thank you." }, { text: "Our team is very busy.", mood: -25, reply: "That does not help me." }, { text: "Calling again will not make it faster.", mood: -30, reply: "Wow." }] },
            { caller: "What is taking so long?", choices: [{ text: "Let me check, and I will tell you exactly what I see and when you will hear next.", mood: 15, reply: "Alright, go ahead." }, { text: "I do not know.", mood: -15, reply: "Then who does?" }] },
          ],
        },
      ],
    },
    {
      id: "fill-in",
      title: "Finish the sentence",
      blocks: [
        { type: "paragraph", text: "An empathy statement works best when the feeling matches the situation. A caller says: “My deadline is tomorrow and I still have no answer.”" },
        {
          type: "check",
          question: "Complete the sentence: “I understand how ___ that must be.”",
          options: [
            { text: "stressful", correct: true, feedback: "It names the feeling the caller is likely to have." },
            { text: "funny", correct: false, feedback: "It makes light of a real concern." },
            { text: "simple", correct: false, feedback: "It dismisses the worry." },
          ],
        },
        {
          type: "game",
          title: "Hear Me Out",
          rounds: [
            { question: "A caller sounds anxious. First?", options: [{ text: "Acknowledge how they feel", correct: true, feedback: "Feelings first, then solutions." }, { text: "Quote the policy", correct: false, feedback: "It can wait." }] },
            { question: "After they explain, what helps?", options: [{ text: "Say back what you understood", correct: true, feedback: "It shows you listened and catches mistakes." }, { text: "Say nothing and start typing", correct: false, feedback: "They cannot tell if you heard." }] },
            { question: "Which sounds more real?", options: [{ text: "“Waiting three days must have been hard.”", correct: true, feedback: "Connected to the real situation." }, { text: "“I apologize for any inconvenience.”", correct: false, feedback: "It could be said to anyone about anything." }] },
          ],
        },
      ],
    },
  ],
};
