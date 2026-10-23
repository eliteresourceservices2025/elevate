import type { CourseModule } from "../schema";

// Customer Service course, module 11. Invented people and details only. Not a clinical resource: it points people to their lead
// and to the support ERS offers.

export const resilienceModule: CourseModule = {
  key: "resilience",
  title: "Staying resilient",
  summary: "Looking after yourself after emotional calls: a short reset, signs of stress, asking for support and daily habits that keep your service steady.",
  estimatedMinutes: 10,
  tracks: ["full"],
  keyPoints: [
    "Hard calls are part of the work. Feeling the weight of them is normal.",
    "A short reset after a heavy call protects you and your next caller.",
    "Do not take a caller's frustration personally. It is usually about the situation.",
    "Asking for support early is professional, not weak.",
    "Own mistakes, fix what you can, tell your lead and learn from them.",
  ],
  screens: [
    {
      id: "why-tiring",
      title: "Why this work is tiring",
      blocks: [
        { type: "paragraph", text: "You listen to worried and upset people all day, and you often cannot fix what they are going through. That is emotional work, and it is tiring. Feeling the weight of a hard call does not mean you are bad at the job. It means you care." },
        { type: "callout", tone: "tip", text: "Looking after yourself is part of giving good service. Someone who is worn out cannot listen well." },
      ],
    },
    {
      id: "sixty-second-reset",
      title: "A 60-second reset",
      blocks: [
        { type: "paragraph", text: "After a hard call, take a short reset before you pick up the next one. It takes about a minute." },
        {
          type: "steps",
          items: [
            { title: "Pause", text: "Take your hands off the keyboard." },
            { title: "Breathe", text: "Three slow breaths, in through the nose and out for longer." },
            { title: "Relax", text: "Drop your shoulders, unclench your jaw." },
            { title: "Note", text: "Write the facts of the call in your notes." },
            { title: "Reset", text: "Take a sip of water and open the next call with a fresh greeting." },
          ],
        },
      ],
    },
    {
      id: "not-personal",
      title: "Do not take it personally",
      blocks: [
        { type: "paragraph", text: "When a caller is angry, it is usually about the situation, not about you. You are the person who happened to pick up. Remembering this lets you stay useful." },
        {
          type: "compare",
          left: { title: "Helpful thought", items: ["“They are upset about the delay.”", "“I can help with the next step.”"] },
          right: { title: "Unhelpful thought", items: ["“They hate me.”", "“I am bad at this.”"] },
        },
      ],
    },
    {
      id: "signs-and-support",
      title: "Signs of stress and asking for support",
      blocks: [
        { type: "paragraph", text: "One bad day is normal. Watch for patterns that last:" },
        {
          type: "list",
          items: ["Dreading every shift.", "Snapping at teammates or callers.", "Trouble sleeping or feeling constantly drained.", "Feeling numb or hopeless about the work."],
        },
        { type: "callout", tone: "info", text: "If you notice these, talk to your lead early. Asking for support is professional. Small problems stay small when they are shared." },
      ],
    },
    {
      id: "mistakes",
      title: "When you make a mistake",
      blocks: [
        { type: "paragraph", text: "Everyone makes mistakes. What matters is what you do next: own it, fix what you can, tell your lead, and note what you will do differently." },
        {
          type: "check",
          question: "You gave a caller the wrong time for a callback. What is the best response?",
          options: [
            { text: "Own it, fix it if you can, tell your lead and note what you will do differently", correct: true, feedback: "Ownership builds trust, and it protects the caller." },
            { text: "Hope nobody notices", correct: false, feedback: "The caller will notice, and the mistake will grow." },
            { text: "Blame the system", correct: false, feedback: "It does not help the caller or you." },
          ],
        },
      ],
    },
    {
      id: "habits-and-reflection",
      title: "Daily habits and a reflection",
      blocks: [
        {
          type: "cards",
          title: "Healthy or not?",
          prompt: "Sort each habit.",
          groups: ["Healthy", "Not healthy"],
          cards: [
            { text: "Taking your scheduled breaks", group: 0, feedback: "Rest is part of the work." },
            { text: "Skipping breaks to catch up", group: 1, feedback: "It leaves you drained for the next call." },
            { text: "Talking with your lead after a hard call", group: 0, feedback: "Support keeps small things small." },
            { text: "Venting about callers online", group: 1, feedback: "It can break confidentiality." },
            { text: "Drinking water and stretching", group: 0, feedback: "Small habits add up." },
          ],
        },
        { type: "paragraph", text: "At the end of a shift, ask yourself two questions: What worked today? What is one thing I will try next time? Specific, small and kind to yourself." },
        {
          type: "game",
          title: "Recharge",
          rounds: [
            { question: "You have had three hard calls in a row. Before the next one?", options: [{ text: "A short reset, then a fresh greeting", correct: true, feedback: "Each caller deserves a fresh start." }, { text: "Carry on without a pause", correct: false, feedback: "The tension carries into the next call." }] },
            { question: "Asking for support after a tough call is:", options: [{ text: "Professional", correct: true, feedback: "Early support keeps problems small." }, { text: "A sign of weakness", correct: false, feedback: "It is the opposite." }] },
            { question: "A good way to reflect after a shift?", options: [{ text: "Note what worked and one thing to try next time", correct: true, feedback: "Small and specific." }, { text: "Replay every mistake", correct: false, feedback: "It drains you without teaching." }] },
          ],
        },
      ],
    },
  ],
};
