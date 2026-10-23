import type { CourseModule } from "../schema";

// Customer Service course, module 8. Invented people and details only.

export const personalitiesModule: CourseModule = {
  key: "personalities",
  title: "Difficult callers",
  summary: "Recognizing what an angry, anxious, confused, demanding or repeat caller really needs, handling abuse safely and knowing when to ask for help.",
  estimatedMinutes: 16,
  tracks: ["full"],
  keyPoints: [
    "Behavior is a signal. Look for what the caller needs underneath it.",
    "Let an angry caller vent briefly, then summarize and steer to solving.",
    "Answer an anxious caller calmly each time and give a concrete next step with a time.",
    "Slow down for a confused caller: one step at a time, checking understanding.",
    "Threats and abusive language are not acceptable: warn once, end the call per policy and tell your lead.",
    "After a hard call, document the facts and take a moment to reset.",
  ],
  screens: [
    {
      id: "behavior-is-a-signal",
      title: "Behavior is a signal",
      blocks: [
        { type: "paragraph", text: "Callers are not “difficult people”. They are people having a difficult time. The behavior you hear (shouting, repeating, interrupting) usually points to something they need: information, reassurance, speed or respect." },
        {
          type: "table",
          caption: "What the behavior may mean",
          columns: ["You hear", "They may need"],
          rows: [
            ["Shouting, interrupting", "To be heard, then a plan"],
            ["The same question again and again", "Reassurance and a concrete next step"],
            ["Confusion, long pauses", "Slower, simpler steps"],
            ["Demands and ultimatums", "Respect and a clear option"],
            ["Calls again and again", "A problem that was never solved"],
          ],
        },
      ],
    },
    {
      id: "angry-and-anxious",
      title: "The angry caller and the anxious caller",
      blocks: [
        { type: "paragraph", text: "With an **angry caller**, let them vent briefly without interrupting. Then summarize and steer to solving: “So the schedule was changed twice and nobody told you. Let me fix it now.”" },
        { type: "paragraph", text: "With an **anxious caller**, who may ask the same question again and again, answer calmly each time. Name the worry and give a concrete next step with a time: “I know this is worrying. I will call you by 3 pm today.”" },
        {
          type: "cards",
          title: "Read the caller",
          prompt: "What does each caller need most?",
          groups: ["A plan and action", "Reassurance and a next step"],
          cards: [
            { text: "“I have told three people already and nothing has happened!”", group: 0, feedback: "Anger over inaction: a plan and action." },
            { text: "“Is it fine? Are you sure it is fine? Can you check again?”", group: 1, feedback: "Anxiety: calm answers, a next step and a time." },
            { text: "“Just fix it. I do not want to hear about it.”", group: 0, feedback: "A plan and action, with minimal talk." },
            { text: "“I just want to know someone is looking at this.”", group: 1, feedback: "Reassurance and a time frame." },
          ],
        },
      ],
    },
    {
      id: "confused-and-demanding",
      title: "The confused caller and the demanding caller",
      blocks: [
        { type: "paragraph", text: "With a **confused caller**, slow down. Give one step at a time and check understanding after each: “Does that make sense so far?” Offer to send the steps in writing." },
        { type: "paragraph", text: "With a **demanding caller**, such as “Get me someone who actually knows something”, do not take it personally. Stay professional, try to help and offer escalation if you cannot resolve it." },
        {
          type: "branch",
          title: "“Get me someone who knows something”",
          intro: "A caller (invented) is impatient and doubts you can help.",
          startMood: 30,
          turns: [
            { caller: "I want to talk to someone who actually knows something.", choices: [{ text: "I will do my best to help you right now. If I cannot, I will bring in my lead. What is happening?", mood: 20, reply: "Alright. Here is the problem..." }, { text: "I know plenty.", mood: -25, reply: "Clearly not." }, { text: "There is no one else.", mood: -20, reply: "That cannot be true." }] },
            { caller: "I have explained this to three people. I need a decision.", choices: [{ text: "That sounds exhausting. Let me bring in my lead with a summary so you do not repeat yourself.", mood: 20, reply: "Thank you. That is what I needed." }, { text: "I will decide soon.", mood: -10, reply: "When?" }] },
          ],
        },
      ],
    },
    {
      id: "repeat-callers",
      title: "Repeat callers",
      blocks: [
        { type: "paragraph", text: "Callers who ring again and again are rarely trying to cause trouble. They usually have a problem that was never solved. Ask what is still open: “What would need to happen for this to be finished?” Then close the loop with a clear owner and time." },
        {
          type: "check",
          question: "A caller has phoned five times about the same issue. Your best first thought is:",
          options: [
            { text: "Something is still unresolved. Find out what.", correct: true, feedback: "A repeat caller is a signal of an open problem." },
            { text: "This caller is trying to cause trouble.", correct: false, feedback: "That assumption usually makes things worse." },
            { text: "I should end the call quickly.", correct: false, feedback: "It will only add another call." },
          ],
        },
      ],
    },
    {
      id: "abuse-and-help",
      title: "Abuse, threats and when to ask for help",
      blocks: [
        { type: "paragraph", text: "You do not have to accept being abused. If a caller uses threats or slurs, give one calm warning: “I want to help you, but I will have to end the call if this continues.” If it continues, end the call following your client's policy and tell your lead." },
        {
          type: "cards",
          title: "Ask for help or handle it?",
          prompt: "Sort each situation.",
          groups: ["Ask for help", "Handle it yourself"],
          cards: [
            { text: "The caller threatens someone", group: 0, feedback: "Threats are always passed to your lead." },
            { text: "You cannot stay professional", group: 0, feedback: "Ask for support rather than risk the call." },
            { text: "The caller sounds slightly impatient", group: 1, feedback: "Impatience is normal and manageable." },
            { text: "The caller asks a question you can answer", group: 1, feedback: "Answer it." },
            { text: "The concern is sensitive or serious", group: 0, feedback: "Escalate with the facts." },
          ],
        },
        { type: "callout", tone: "tip", text: "After a hard call, write down the facts (not opinions) and take a short reset before the next call. Module 11 shows you how." },
      ],
    },
    {
      id: "read-the-caller-game",
      title: "Game: Read the Caller",
      blocks: [
        {
          type: "game",
          title: "Read the Caller",
          seconds: 20,
          rounds: [
            { question: "A caller shouts and interrupts. Best first move?", options: [{ text: "Let them vent briefly, then summarize and steer to solving", correct: true, feedback: "Venting first, structure second." }, { text: "Talk over them", correct: false, feedback: "It escalates." }] },
            { question: "An anxious caller asks the same question again. Best?", options: [{ text: "Answer calmly, name the worry, give a time", correct: true, feedback: "Repetition is usually worry, not rudeness." }, { text: "Say you already answered", correct: false, feedback: "It makes them feel dismissed." }] },
            { question: "A confused caller cannot follow your steps. Best?", options: [{ text: "Slow down, one step at a time", correct: true, feedback: "Simplify." }, { text: "Repeat the same words louder", correct: false, feedback: "Volume does not help understanding." }] },
            { question: "A caller uses slurs. Best?", options: [{ text: "One calm warning, then end the call per policy and tell your lead", correct: true, feedback: "You do not have to accept abuse." }, { text: "Argue back", correct: false, feedback: "It never helps." }] },
          ],
        },
      ],
    },
  ],
};
