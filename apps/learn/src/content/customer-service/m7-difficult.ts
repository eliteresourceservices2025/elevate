import type { CourseModule } from "../schema";

// Customer Service course, module 7. Invented people and details only.

export const difficultModule: CourseModule = {
  key: "difficult",
  title: "Managing difficult conversations",
  summary: "Why callers become frustrated, how to stay calm and use the LEARN framework to turn a tense call toward a solution.",
  estimatedMinutes: 16,
  tracks: ["full"],
  keyPoints: [
    "Frustration usually comes from delays, missing updates, miscommunication or unmet expectations.",
    "LEARN: Listen, Empathize, Assess, Resolve, Next steps.",
    "Stay calm, slow down, acknowledge the feeling and focus on solutions.",
    "Do not argue, interrupt, match their tone or assign blame.",
    "Explaining policy comes after the person feels heard, not before.",
  ],
  screens: [
    {
      id: "why-frustrated",
      title: "Why callers become frustrated",
      blocks: [
        { type: "paragraph", text: "Most frustration has a cause we can understand. The four most common are:" },
        {
          type: "layers",
          items: [
            { label: "Delayed responses", text: "They waited longer than they were told." },
            { label: "No updates", text: "Silence after a promise." },
            { label: "Miscommunication", text: "They were told different things by different people." },
            { label: "Unmet expectations", text: "They expected something that was never possible." },
          ],
        },
        { type: "callout", tone: "tip", text: "Setting and keeping expectations is the thing we control most. Most complaints could have been avoided with an earlier, clearer update." },
      ],
    },
    {
      id: "emotions",
      title: "Understanding what people feel",
      blocks: [
        { type: "paragraph", text: "A caller may be angry, frustrated, confused, worried or disappointed. Each feeling asks for something different." },
        {
          type: "flip",
          title: "What each feeling needs",
          cards: [
            { front: "Angry", back: "To be heard without being argued with, and to see action." },
            { front: "Frustrated", back: "An honest update and a clear next step." },
            { front: "Confused", back: "Simple steps, one at a time." },
            { front: "Worried", back: "Reassurance that someone is looking after it, and a time frame." },
            { front: "Disappointed", back: "Acknowledgement and an alternative." },
          ],
        },
      ],
    },
    {
      id: "learn",
      title: "The LEARN framework",
      blocks: [
        { type: "paragraph", text: "LEARN gives you a path through a tense call. Put the steps in order, then read what each one means." },
        {
          type: "sort",
          title: "Put LEARN in order",
          prompt: "Drag the steps into the right order.",
          items: ["Listen", "Empathize", "Assess", "Resolve", "Next steps"],
          explanation: "Understand first, then solve. Empathy comes before assessing, and a next step closes the loop.",
        },
        {
          type: "steps",
          items: [
            { title: "Listen", text: "Let them tell it without interrupting." },
            { title: "Empathize", text: "Name the feeling in their words." },
            { title: "Assess", text: "Ask what happened and what outcome they want." },
            { title: "Resolve", text: "Do what you can now." },
            { title: "Next steps", text: "Say what happens next, who and when." },
          ],
        },
      ],
    },
    {
      id: "de-escalation",
      title: "De-escalation: what to do and not do",
      blocks: [
        {
          type: "compare",
          left: { title: "Do", items: ["Stay calm", "Slow your pace and lower your voice", "Acknowledge the frustration", "Focus on solutions"] },
          right: { title: "Do not", items: ["Argue", "Interrupt", "Match their tone", "Blame the caller or a teammate"] },
        },
        {
          type: "spot",
          title: "Find the mistake",
          prompt: "Tap the line that makes things worse.",
          lines: [
            { speaker: "Caller", text: "This is the third time I have called." },
            { speaker: "Rep", text: "That is not my fault.", wrong: true },
            { speaker: "Caller", text: "I did not say it was your fault!" },
          ],
          explanation: "The rep defended instead of acknowledging the caller's frustration. A better reply: “I am sorry you have had to call three times. Let me help you now.”",
        },
      ],
    },
    {
      id: "scenario-third-call",
      title: "Practice: “This is my third call”",
      blocks: [
        {
          type: "branch",
          title: "The third call",
          intro: "A caller (invented) says it is his third call and no one is helping him. Use LEARN.",
          startMood: 25,
          record: { title: "Customer record", rows: [{ label: "Caller", value: "Daniel T. (invented)" }, { label: "Issue", value: "A scheduling mix-up" }, { label: "Calls so far", value: "Three" }] },
          turns: [
            { caller: "This is my third call and no one is helping me!", choices: [{ text: "I am sorry you have had to call three times. I will stay with you until we have a plan. What happened?", mood: 20, reply: "Fine. It started on Monday..." }, { text: "Let me get your reference number.", mood: -5, reply: "I do not have it with me!" }, { text: "That is not my fault.", mood: -30, reply: "I did not say it was!" }] },
            { caller: "Nothing ever changes!", choices: [{ text: "So you have explained it twice and nothing changed. Let me read back what I have so you can tell me if I missed anything.", mood: 20, reply: "Yes. That is right." }, { text: "Please calm down.", mood: -25, reply: "Do not tell me to calm down!" }] },
            { caller: "What are you going to do about it?", choices: [{ text: "I will fix the schedule now while you are on the line, confirm it with you and send you the new details today.", mood: 20, reply: "Okay. Thank you for actually doing something." }, { text: "I will look into it.", mood: -10, reply: "That is what the last person said." }] },
          ],
        },
      ],
    },
    {
      id: "policy-last",
      title: "Policy comes after listening",
      blocks: [
        { type: "paragraph", text: "Policies exist for good reasons, and sometimes you must explain one. But if you start with policy, the caller hears “I do not care about your problem.” Listen and acknowledge first. Then explain the policy, briefly and kindly, and offer what you can do." },
        {
          type: "case",
          title: "Policy or people first?",
          scenario: "A caller (invented) asks to change a deadline that the client does not allow to move. He is already upset.",
          question: "How do you begin?",
          answer: "Begin with the person: “I can hear this deadline is stressful.” Then the policy, briefly: “I am not able to move it.” Then what you can do: “What I can do is check whether a short extension request is possible, and I will tell you by tomorrow.” The no comes with an option.",
        },
        {
          type: "game",
          title: "Cool Down",
          rounds: [
            { question: "A caller raises their voice. First?", options: [{ text: "Stay calm, slow down and acknowledge", correct: true, feedback: "Your calm sets the pace." }, { text: "Raise your own voice to be heard", correct: false, feedback: "It escalates the call." }] },
            { question: "What should you do before explaining a policy?", options: [{ text: "Listen and acknowledge", correct: true, feedback: "People hear policy once they feel heard." }, { text: "Quote it right away", correct: false, feedback: "It sounds like an excuse." }] },
            { question: "Which cause of frustration can you most influence?", options: [{ text: "Unmet expectations, by setting them clearly", correct: true, feedback: "Clear expectations prevent many complaints." }, { text: "The caller's personality", correct: false, feedback: "You cannot change that." }] },
          ],
        },
      ],
    },
  ],
};
