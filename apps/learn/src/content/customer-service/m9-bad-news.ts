import type { CourseModule } from "../schema";

// Customer Service course, module 9. Invented people and details only.

export const badNewsModule: CourseModule = {
  key: "bad_news",
  title: "Bad news and saying no",
  summary: "How to give an answer people do not want to hear with clarity and kindness, and keep the relationship intact.",
  estimatedMinutes: 14,
  tracks: ["full"],
  keyPoints: [
    "A clear, kind no builds more trust than a vague yes.",
    "Use five parts: acknowledge, say it clearly, explain briefly, offer what you can do, give the next step.",
    "Replace “we cannot” with “here is what I can do”.",
    "Apologize for the experience without blaming anyone.",
    "Promise only what you control. Give a realistic window.",
  ],
  screens: [
    {
      id: "why-clear",
      title: "Why clear beats vague",
      blocks: [
        { type: "paragraph", text: "Sometimes the answer is no, later or not possible. A vague answer feels kinder in the moment, but it sends the caller away to wait, hope and call again. A clear answer, given with care, lets them plan." },
        { type: "callout", tone: "tip", text: "A kind no with an alternative builds more trust than a vague yes that falls through." },
      ],
    },
    {
      id: "five-parts",
      title: "The five parts of a good no",
      blocks: [
        { type: "paragraph", text: "A good answer to bad news has five parts. Put them in order." },
        {
          type: "sort",
          title: "Order the five parts",
          prompt: "Drag the parts into the order you would say them.",
          items: ["Acknowledge how they feel", "Say the answer clearly", "Explain briefly why", "Offer what you can do instead", "Give the next step"],
          explanation: "Start with the person, then the answer, the short reason, the alternative and the next step. A long defensive explanation is not on the list.",
        },
      ],
    },
    {
      id: "build-a-no",
      title: "Build a good no",
      blocks: [
        {
          type: "build",
          title: "Build a good no",
          prompt: "A caller wants a deadline moved. The client does not allow it. Pick the best piece for each part.",
          slots: [
            { label: "Acknowledge", options: [{ text: "“I can hear this deadline is stressful.”", correct: true, feedback: "Starts with the person." }, { text: "“It is the policy.”", correct: false, feedback: "Starts with a rule." }] },
            { label: "Say it clearly", options: [{ text: "“I am not able to move it.”", correct: true, feedback: "Clear and short." }, { text: "“It might be difficult.”", correct: false, feedback: "Vague hope." }] },
            { label: "Offer an alternative", options: [{ text: "“I can check if a short extension request is possible and tell you tomorrow.”", correct: true, feedback: "A real option with a time." }, { text: "“There is nothing else.”", correct: false, feedback: "A closed door." }] },
          ],
        },
      ],
    },
    {
      id: "words-that-help",
      title: "Words that help and words that blame",
      blocks: [
        {
          type: "table",
          caption: "Say it differently",
          columns: ["Blames or closes", "Helps"],
          rows: [
            ["“You should have read the instructions.”", "“Let me walk you through it.”"],
            ["“We cannot do that.”", "“Here is what I can do.”"],
            ["“That is our policy.”", "“I can explain why, and what we can do.”"],
            ["“You'll have to wait.”", "“It should be ready by Thursday. I will confirm on Wednesday.”"],
          ],
        },
        { type: "paragraph", text: "Apologize for the experience, not for blame. “I am sorry this has been frustrating” does not admit fault. It acknowledges the person." },
      ],
    },
    {
      id: "promise-only-what-you-control",
      title: "Promise only what you control",
      blocks: [
        { type: "paragraph", text: "When you are not sure when something will happen, do not say “it will definitely be done tomorrow.” Give a realistic window and a promise you control: “I expect this by Thursday. I will confirm by Wednesday whether that is still right.”" },
        {
          type: "spot",
          title: "Find the over-promise",
          prompt: "Tap the line that promises something you cannot control.",
          lines: [
            { speaker: "Caller", text: "When will my refund be processed?" },
            { speaker: "Rep", text: "It will definitely be in your account tomorrow.", wrong: true },
            { speaker: "Caller", text: "Great, I will wait." },
          ],
          explanation: "You cannot control how fast a bank or another team moves. A better reply: “It should be processed by Thursday. I will check on Wednesday and let you know.”",
        },
      ],
    },
    {
      id: "policy-exceptions",
      title: "Policy exceptions and angry reactions",
      blocks: [
        { type: "paragraph", text: "If the answer is no and the caller reacts, stay steady. Acknowledge the feeling, hold the answer calmly and, if there is an escalation route, offer it. Never change your answer just to end the discomfort." },
        {
          type: "case",
          title: "“That is unacceptable!”",
          scenario: "You have explained kindly that a request cannot be approved. The caller says, “That is unacceptable! I want to speak to someone higher up.”",
          question: "What do you do?",
          answer: "Acknowledge: “I understand this is not what you hoped for.” Hold the answer, do not argue and do not change it to please. Offer the route: “I can pass this to my lead with a full summary so you do not repeat anything.” A reasonable request to escalate is honored.",
        },
        {
          type: "game",
          title: "Yes, But...",
          rounds: [
            { question: "A request cannot be granted. Best reply?", options: [{ text: "“I am not able to do that, but here is what I can do.”", correct: true, feedback: "A clear no with an option." }, { text: "“We cannot do that.”", correct: false, feedback: "A closed door." }] },
            { question: "Which phrase blames the customer?", options: [{ text: "“You should have read the instructions.”", correct: true, feedback: "Blame closes people down." }, { text: "“Let me walk you through it.”", correct: false, feedback: "That one helps." }] },
            { question: "You are unsure of a date. Best?", options: [{ text: "Give a realistic window and a check-in time", correct: true, feedback: "Promise only what you control." }, { text: "Say it will definitely be done tomorrow", correct: false, feedback: "A broken promise damages trust." }] },
          ],
        },
      ],
    },
  ],
};
