import type { CourseModule } from "../schema";

// Customer Service course, module 2. Includes tips for speaking with callers in the United States. Invented people and details only.

export const communicationModule: CourseModule = {
  key: "communication",
  title: "Professional communication",
  summary: "How to speak and write clearly, use positive language, set expectations and work smoothly with callers in the United States.",
  estimatedMinutes: 18,
  tracks: ["full"],
  keyPoints: [
    "People judge service by how it was communicated, not only by the result.",
    "Speak clearly, stay calm, avoid interrupting and use simple words.",
    "Say what you can do. Replace “I don't know” with “Let me verify that for you.”",
    "Every message has a greeting, a purpose, information, a next step and a closing.",
    "Always explain the timeline, who is responsible and the follow-up plan.",
    "Clarity matters more than accent. If you are unsure, check and restate.",
  ],
  screens: [
    {
      id: "why-communication",
      title: "Why communication matters",
      blocks: [
        { type: "paragraph", text: "Callers often judge service by how it was communicated rather than by the outcome. A clear, calm explanation of a disappointing answer can leave someone more satisfied than a fast answer given carelessly." },
        { type: "callout", tone: "tip", text: "Aim for three things in every conversation: be understood, be respectful, and leave the other person knowing what happens next." },
      ],
    },
    {
      id: "verbal-standards",
      title: "How we speak",
      blocks: [
        { type: "paragraph", text: "These five habits make a voice easy to trust:" },
        {
          type: "list",
          items: ["**Speak clearly**: a steady pace, finish your words.", "**Speak confidently**: sound sure of what you are doing, and honest about what you are checking.", "**Stay calm**: a calm voice calms the call.", "**Do not interrupt**: let the person finish, then respond.", "**Use simple language**: short words, short sentences."],
        },
        {
          type: "cards",
          title: "Good habit or not?",
          prompt: "Sort each behavior.",
          groups: ["Good habit", "Not a good habit"],
          cards: [
            { text: "Letting a caller finish before you answer", group: 0, feedback: "Interrupting makes people feel dismissed." },
            { text: "Using abbreviations only the team understands", group: 1, feedback: "Say what it means in plain words." },
            { text: "Slowing down when the topic gets complicated", group: 0, feedback: "A calm pace helps understanding." },
            { text: "Sounding rushed to end the call sooner", group: 1, feedback: "Rushing is felt even when it is not said." },
          ],
        },
      ],
    },
    {
      id: "positive-language",
      title: "Positive language",
      blocks: [
        { type: "paragraph", text: "Positive language tells the person what you can do instead of what you cannot. It sounds helpful, and it keeps the conversation moving." },
        {
          type: "table",
          caption: "Say it differently",
          columns: ["Instead of", "Try"],
          rows: [
            ["“I don't know.”", "“Let me verify that for you.”"],
            ["“That's not my department.”", "“I will find the right person for that.”"],
            ["“You'll have to wait.”", "“It should be ready by tomorrow afternoon. I will call you.”"],
            ["“We can't do that.”", "“Here is what I can do.”"],
          ],
        },
        {
          type: "game",
          title: "Rewrite Rush",
          rounds: [
            { question: "You do not know the answer. Which is best?", options: [{ text: "“Let me verify that for you.”", correct: true, feedback: "Honest, helpful and it promises action." }, { text: "“I don't know.”", correct: false, feedback: "True, but it leaves the caller with nothing." }] },
            { question: "The request belongs to another team. Which is best?", options: [{ text: "“I will find the right person for that.”", correct: true, feedback: "It stays with the caller." }, { text: "“That's not my department.”", correct: false, feedback: "It sounds like a door closing." }] },
            { question: "You need a day. Which is best?", options: [{ text: "“I will call you by tomorrow afternoon.”", correct: true, feedback: "A time and an owner." }, { text: "“You'll have to wait.”", correct: false, feedback: "It sounds like a burden placed on the caller." }] },
          ],
        },
      ],
    },
    {
      id: "written-standards",
      title: "How we write",
      blocks: [
        { type: "paragraph", text: "Every email and chat message should have five parts, in this order:" },
        {
          type: "steps",
          items: [
            { title: "Greeting", text: "Use the person's name." },
            { title: "Purpose", text: "Say why you are writing, in one sentence." },
            { title: "Information", text: "The facts they need, in plain words." },
            { title: "Next step", text: "What happens next, who does it and when." },
            { title: "Closing", text: "A polite sign-off with your name." },
          ],
        },
        { type: "callout", tone: "tip", text: "Read your message once more before sending. Would a stranger understand what to do next?" },
      ],
    },
    {
      id: "setting-expectations",
      title: "Setting expectations",
      blocks: [
        { type: "paragraph", text: "People become frustrated when they do not know what happens next. Whenever you finish a conversation, explain three things:" },
        {
          type: "layers",
          items: [
            { label: "Timeline", text: "When they can expect an update or a result." },
            { label: "Responsibility", text: "Who is doing it, which is often you." },
            { label: "Follow-up plan", text: "What happens if the timeline slips or they need to reach you." },
          ],
        },
        {
          type: "spot",
          title: "Find the weak message",
          prompt: "Tap the line that does not set a clear expectation.",
          lines: [
            { speaker: "Caller", text: "Where does my request stand?" },
            { speaker: "Rep", text: "Your request is pending.", wrong: true },
            { speaker: "Caller", text: "Okay. What does that mean?" },
          ],
          explanation: "“Pending” says nothing about the status, the timing or the owner. A better reply: “Your request is under review, and you can expect an update within 24 business hours.”",
        },
      ],
    },
    {
      id: "us-callers",
      title: "Speaking with callers in the United States",
      blocks: [
        { type: "paragraph", text: "Many of our callers are in the United States. A few habits help a call go smoothly. They are about clarity and courtesy, not about changing who you are." },
        {
          type: "list",
          items: [
            "**Lead with the answer.** Many US callers like the short version first, then the detail if they want it.",
            "**Be warm and direct.** A friendly greeting and plain words are the norm.",
            "**Use their name**, but not too often.",
            "**Do not guess an idiom.** If someone says “we are back to square one” and you are not sure, restate what you understood.",
            "**Clarity over accent.** Everyone has an accent. Speak at an even pace, finish your words and check understanding.",
          ],
        },
        { type: "callout", tone: "info", text: "If you did not catch something, ask politely: “I want to be sure I have this right. Could you say that once more?”" },
      ],
    },
    {
      id: "idioms",
      title: "Everyday phrases you may hear",
      blocks: [
        { type: "paragraph", text: "These expressions are common. Turn each card to see the meaning. If you hear one you do not know, it is always fine to check." },
        {
          type: "flip",
          title: "Phrases callers use",
          cards: [
            { front: "“Back to square one”", back: "We have to start again from the beginning." },
            { front: "“Touch base”", back: "Contact briefly to share an update." },
            { front: "“I'm swamped”", back: "I am very busy. Keep your reply short." },
            { front: "“Loop me in”", back: "Please include me or keep me informed." },
            { front: "“Hang in there”", back: "Be patient. It will get better." },
          ],
        },
      ],
    },
    {
      id: "rewrite-practice",
      title: "Practice: rewrite it professionally",
      blocks: [
        { type: "paragraph", text: "A teammate wrote: “Your request is pending.” Pick the best rewrite." },
        {
          type: "check",
          question: "Which rewrite is best?",
          options: [
            { text: "“Your request is under review, and you can expect an update within 24 business hours.”", correct: true, feedback: "It gives a status, a time frame and a reason to feel looked after." },
            { text: "“Your request is in the system.”", correct: false, feedback: "That tells the caller nothing about the status or timing." },
            { text: "“We are working on it, please wait.”", correct: false, feedback: "It asks them to wait without saying how long." },
          ],
        },
        {
          type: "build",
          title: "Build a professional reply",
          prompt: "Choose the best piece for each part of the message.",
          slots: [
            { label: "Greeting", options: [{ text: "“Hello Maria, thank you for reaching out.”", correct: true, feedback: "Uses the name and says thanks." }, { text: "“Hi.”", correct: false, feedback: "Too short to feel respectful." }] },
            { label: "Next step", options: [{ text: "“I will email you by tomorrow at 3 pm with the result.”", correct: true, feedback: "Owner, time and channel." }, { text: "“You will hear from us.”", correct: false, feedback: "No owner or time." }] },
          ],
        },
      ],
    },
  ],
};
