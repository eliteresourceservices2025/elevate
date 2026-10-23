import type { CourseModule } from "../schema";

// Customer Service course, module 1. Original text for the ERS team. All people and details are invented.

export const excellenceModule: CourseModule = {
  key: "excellence",
  title: "Customer service excellence",
  summary: "What good service means for the families we support, the five things they expect, and the Trust Formula that guides every call.",
  estimatedMinutes: 12,
  tracks: ["full"],
  keyPoints: [
    "Every interaction builds or weakens trust.",
    "Families expect five things: clarity, responsiveness, professionalism, empathy and reliability.",
    "Trust = professionalism + empathy + resolution.",
    "A specific time and next step beats a vague promise every time.",
    "Doing what you said you would do, when you said, is the strongest trust builder.",
  ],
  screens: [
    {
      id: "why-it-matters",
      title: "Why customer service matters",
      blocks: [
        { type: "paragraph", text: "Customer service is not just answering questions. Every call, chat and email shapes how much a family trusts the people helping them." },
        { type: "paragraph", text: "For many of the families we support, we are the first and the most frequent contact. A calm, clear conversation can make a hard day easier. A careless one can make it worse." },
        { type: "callout", tone: "tip", title: "Remember", text: "People forget details. They remember how they were treated." },
      ],
    },
    {
      id: "our-role",
      title: "Understanding our role",
      blocks: [
        { type: "paragraph", text: "Our job is to help families through a process. We are the voice of ERS and of the client we work for. That brings five responsibilities:" },
        {
          type: "list",
          items: [
            "**Give accurate information** and say so when we need to check.",
            "**Address concerns professionally**, even when the caller is upset.",
            "**Guide families** through steps they may find confusing.",
            "**Protect privacy**: share only what a person is allowed to have.",
            "**Create a positive experience** from the first words to the last.",
          ],
        },
        { type: "callout", tone: "info", text: "We help with process. We do not give medical, legal or financial advice. Module 6 covers this in healthcare calls." },
      ],
    },
    {
      id: "five-expectations",
      title: "The five things families expect",
      blocks: [
        { type: "paragraph", text: "When families call, they expect five things. Turn each card to see what it means on a call." },
        {
          type: "flip",
          title: "The five expectations",
          cards: [
            { front: "Clarity", back: "They understand what you said and what happens next. Plain words, no jargon." },
            { front: "Responsiveness", back: "They are answered promptly, and updates arrive when promised." },
            { front: "Professionalism", back: "A calm, respectful tone and accurate information, even under pressure." },
            { front: "Empathy", back: "They feel heard. You acknowledge the situation before you solve it." },
            { front: "Reliability", back: "You do what you said you would do, when you said you would." },
          ],
        },
      ],
    },
    {
      id: "trust-formula",
      title: "The Trust Formula",
      blocks: [
        { type: "paragraph", text: "Three things build trust, and they work together:" },
        {
          type: "layers",
          title: "Trust",
          items: [
            { label: "Professionalism", text: "How we act: calm, accurate, respectful." },
            { label: "Empathy", text: "How we care: we notice and name how the person feels." },
            { label: "Resolution", text: "What we deliver: a real answer, a next step, or a handoff." },
          ],
        },
        { type: "callout", tone: "warning", text: "Remove any one and trust weakens. Politeness without a resolution feels empty. A resolution without empathy feels cold." },
      ],
    },
    {
      id: "good-vs-poor",
      title: "Good service and poor service",
      blocks: [
        { type: "paragraph", text: "Small word choices make a big difference. Compare these two replies to the same question." },
        {
          type: "compare",
          left: { title: "Excellent", items: ["“Our team is reviewing your request, and you can expect an update by tomorrow afternoon.”", "Names the status, gives a time."] },
          right: { title: "Poor", items: ["“We will get back to you.”", "No status, no time, no owner."] },
        },
        {
          type: "sort",
          title: "Put the service steps in a sensible order",
          prompt: "A family member asks for an update. Drag the steps into the order you would do them.",
          items: ["Thank them for calling", "Listen to what they ask", "Look up the status", "Give a clear answer and a time for the next update", "Check they have what they need"],
          explanation: "We welcome, listen, find out, answer with a time, and confirm. Skipping the listening step is what makes people feel rushed.",
        },
      ],
    },
    {
      id: "case-update",
      title: "Case: a request three days old",
      blocks: [
        {
          type: "case",
          title: "An update after three days",
          scenario: "Maria (an invented family member) phones. She sent a request three days ago and has not heard anything. She is polite, but you can hear she is worried.",
          question: "How can you create a good experience in this call? Think about tone, communication and next steps.",
          answer: "Tone: warm and unhurried; thank her for calling and acknowledge the wait. Communication: look up the status and tell her plainly where it stands, in simple words. Next steps: give a specific time for the next update, such as by tomorrow afternoon, and make a note so it happens. She leaves knowing what to expect.",
        },
      ],
    },
    {
      id: "trust-builder",
      title: "Game: Trust Builder",
      blocks: [
        {
          type: "game",
          title: "Trust Builder",
          seconds: 20,
          rounds: [
            { question: "Which reply builds the most trust?", options: [{ text: "“I will check and call you by 3 pm today.”", correct: true, feedback: "Specific, owned, and on a clock." }, { text: "“We will get back to you.”", correct: false, feedback: "It gives the family nothing to hold on to." }] },
            { question: "A caller sounds worried. What first?", options: [{ text: "Name the worry: “That sounds stressful.”", correct: true, feedback: "People listen once they feel heard." }, { text: "Start with the policy", correct: false, feedback: "Policy can come after the person feels heard." }] },
            { question: "You promised a callback by 3 pm and have no answer at 2:30. What do you do?", options: [{ text: "Call before 3 pm, say what you know and when you will update next", correct: true, feedback: "Keeping the promised time, even with partial news, protects trust." }, { text: "Wait until you have the full answer", correct: false, feedback: "Silence after a promise breaks trust." }] },
            { question: "Which is part of the Trust Formula?", options: [{ text: "Professionalism, empathy and resolution", correct: true, feedback: "All three work together." }, { text: "Speed, volume and confidence", correct: false, feedback: "Those can help, but they are not what builds trust." }] },
          ],
        },
      ],
    },
    {
      id: "reflect",
      title: "Think about your best service experience",
      blocks: [
        { type: "paragraph", text: "Think of the best customer service you have ever received. It might be a shop, a bank, a clinic or a phone call. Take a moment to think about what that person did that made you feel valued." },
        {
          type: "scenario",
          title: "What stood out?",
          prompt: "Most people say one of these. Which comes closest to your memory?",
          choices: [
            { text: "They listened and did not rush me", feedback: "Listening is the base of everything in this course.", best: true },
            { text: "They solved the problem quickly", feedback: "Speed matters, but people remember how they were treated alongside the result.", best: true },
            { text: "They told me exactly what would happen next", feedback: "Clear next steps are part of the Trust Formula.", best: true },
          ],
        },
        { type: "callout", tone: "tip", text: "Whatever stood out, you can give that to the next family you speak with." },
      ],
    },
  ],
};
