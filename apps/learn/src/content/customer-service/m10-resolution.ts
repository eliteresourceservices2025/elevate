import type { CourseModule } from "../schema";

// Customer Service course, module 10. Invented people and details only.

export const resolutionModule: CourseModule = {
  key: "resolution",
  title: "Resolution, documentation and escalation",
  summary: "A clear way to resolve concerns, write notes a colleague can act on, and escalate with the facts so no one has to repeat themselves.",
  estimatedMinutes: 18,
  tracks: ["full"],
  keyPoints: [
    "Resolve in five steps: Identify, Investigate, Respond, Resolve, Document.",
    "Open questions such as “Can you tell me more about what happened?” bring out the facts.",
    "A good note has the date and time, the concern, actions taken, the resolution and the follow-up.",
    "Escalate when a supervisor is requested, an exception is needed, the issue cannot be resolved or the concern is sensitive.",
    "When you escalate, hand over the facts so the caller never starts over.",
  ],
  screens: [
    {
      id: "resolution-process",
      title: "The resolution process",
      blocks: [
        { type: "paragraph", text: "A good resolution does not happen by luck. It follows five steps. Put them in order." },
        {
          type: "sort",
          title: "Order the resolution steps",
          prompt: "Drag the steps into the right order.",
          items: ["Identify the concern", "Investigate what happened", "Respond to the person", "Resolve it", "Document it"],
          explanation: "Know what the problem is, find out why, tell the person, fix it and write it down so the work is not lost.",
        },
      ],
    },
    {
      id: "effective-questions",
      title: "Asking effective questions",
      blocks: [
        { type: "paragraph", text: "Open questions bring out more than a yes or no. They also show that you want to understand." },
        {
          type: "list",
          items: ["“Can you tell me more about what happened?”", "“When did this occur?”", "“What outcome are you hoping for?”", "“What has already been tried?”"],
        },
        {
          type: "cards",
          title: "Open or closed?",
          prompt: "Sort each question.",
          groups: ["Open question", "Closed question"],
          cards: [
            { text: "“Can you tell me more about what happened?”", group: 0, feedback: "Invites the story." },
            { text: "“Is that all?”", group: 1, feedback: "Gets a yes or no." },
            { text: "“What outcome are you hoping for?”", group: 0, feedback: "Shows you care about the goal." },
            { text: "“Did you read the email?”", group: 1, feedback: "Closed, and can sound like blame." },
          ],
        },
      ],
    },
    {
      id: "why-document",
      title: "Why documentation matters",
      blocks: [
        { type: "paragraph", text: "A note is a message to the next person, who may be you next week or a colleague today. Good notes give three things:" },
        {
          type: "layers",
          items: [
            { label: "Continuity", text: "Anyone can pick up where you left off." },
            { label: "Accountability", text: "It is clear who promised what and when." },
            { label: "A better experience", text: "The caller never has to repeat themselves." },
          ],
        },
      ],
    },
    {
      id: "five-fields",
      title: "The five parts of a note",
      blocks: [
        { type: "paragraph", text: "Every note should have these five fields. Facts only, never your opinion of the caller." },
        {
          type: "table",
          columns: ["Field", "Example"],
          rows: [
            ["Date and time", "Oct 23, 2:15 pm"],
            ["Concern", "Asked about a request sent three days ago"],
            ["Actions taken", "Verified caller, checked status, explained next step"],
            ["Resolution", "Status shared; update promised"],
            ["Follow-up", "I will call by 3 pm tomorrow"],
          ],
        },
      ],
    },
    {
      id: "build-the-note",
      title: "Build the note",
      blocks: [
        {
          type: "build",
          title: "Build a call note",
          prompt: "A caller asked about a missed update. Pick the best piece for each field.",
          slots: [
            { label: "Concern", options: [{ text: "Asked for an update on a request sent three days ago.", correct: true, feedback: "Specific and factual." }, { text: "Customer was upset.", correct: false, feedback: "A feeling is not a concern." }] },
            { label: "Actions taken", options: [{ text: "Verified caller, reviewed status, explained next step.", correct: true, feedback: "Says what you did." }, { text: "Handled it.", correct: false, feedback: "Nobody can tell what was done." }] },
            { label: "Follow-up", options: [{ text: "I will call by 3 pm tomorrow with the status.", correct: true, feedback: "Owner and time." }, { text: "Will see what happens.", correct: false, feedback: "No owner or time." }] },
          ],
        },
        {
          type: "spot",
          title: "Find the weak note",
          prompt: "Tap the note that a colleague could not use.",
          lines: [
            { speaker: "Note A", text: "Oct 23, 2:15 pm. Concern: missed update. Actions: verified caller, checked status. Follow-up: call by 3 pm tomorrow." },
            { speaker: "Note B", text: "Customer called. Issue handled.", wrong: true },
            { speaker: "Note C", text: "Oct 23, 4:40 pm. Concern: results question. Actions: verified caller, no advice given, requested a care-team call. Follow-up: care team calls today." },
          ],
          explanation: "Note B has no date, no concern, no actions, no resolution and no follow-up. Note A could be picked up by anyone.",
        },
      ],
    },
    {
      id: "escalation",
      title: "When to escalate",
      blocks: [
        { type: "paragraph", text: "Escalating is not failing. It is getting the right person involved. Escalate when:" },
        {
          type: "list",
          items: ["A supervisor is requested.", "A policy exception is needed.", "The issue cannot be resolved by you.", "The concern is sensitive or serious."],
        },
        { type: "callout", tone: "info", text: "A reasonable request to speak to a supervisor is always honored with a warm handoff." },
      ],
    },
    {
      id: "good-escalation",
      title: "Escalate with the facts",
      blocks: [
        { type: "paragraph", text: "A good escalation saves the caller from starting over. Before you hand over, gather four things:" },
        {
          type: "steps",
          items: [
            { title: "Customer name", text: "And how to reach them." },
            { title: "Summary of the issue", text: "In two or three sentences." },
            { title: "Relevant dates", text: "When it started and what was promised." },
            { title: "Actions already taken", text: "So nothing is repeated." },
          ],
        },
        {
          type: "branch",
          title: "A supervisor request",
          intro: "A caller (invented) asks for a supervisor after a long conversation.",
          startMood: 35,
          turns: [
            { caller: "I would like to speak to a supervisor, please.", choices: [{ text: "Of course. I will bring in my lead and give them a summary so you do not need to repeat anything. May I put you on a short hold?", mood: 20, reply: "Thank you." }, { text: "I can help you with this myself.", mood: -15, reply: "I asked for a supervisor." }, { text: "No supervisor is available.", mood: -25, reply: "That cannot be true." }] },
            { caller: "Will I have to explain everything again?", choices: [{ text: "No. I will tell them your name, what happened, the dates and what we have already done, and I will stay on until they pick up.", mood: 15, reply: "That is a relief. Thank you." }, { text: "Probably, yes.", mood: -20, reply: "That is exhausting." }] },
          ],
        },
        {
          type: "game",
          title: "Case Closed",
          rounds: [
            { question: "Which is part of a good note?", options: [{ text: "Date and time, concern, actions, resolution, follow-up", correct: true, feedback: "The five fields." }, { text: "Your opinion of the caller", correct: false, feedback: "Facts only." }] },
            { question: "A caller needs a policy exception. You:", options: [{ text: "Escalate with the facts", correct: true, feedback: "An exception needs someone with authority." }, { text: "Grant it to keep them calm", correct: false, feedback: "You may not have the authority." }] },
            { question: "After you escalate, what should the caller hear?", options: [{ text: "Who has it, what happens next and by when", correct: true, feedback: "A handoff, not an exit." }, { text: "“It is out of my hands.”", correct: false, feedback: "It sounds like abandonment." }] },
          ],
        },
      ],
    },
  ],
};
