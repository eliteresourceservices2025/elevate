import type { CourseModule } from "../schema";

// Customer Service course, module 3. Phone, chat, email and voicemail. Invented people and details only.

export const channelsModule: CourseModule = {
  key: "channels",
  title: "Phone, chat, email and voicemail",
  summary: "How the same service skills change on a call, in a chat, in an email and in a voicemail, including holds, transfers and a clean close.",
  estimatedMinutes: 22,
  tracks: ["full"],
  keyPoints: [
    "The channel changes how we communicate. The goal of being understood and respectful does not change.",
    "On the phone, speak at a steady pace and confirm what you heard.",
    "Before a hold: ask permission, say how long, and thank them on your return.",
    "A warm transfer tells the caller who and why, and briefs the next person so the caller never repeats.",
    "In chat, keep messages short and say when you will be back. Never type in all capitals.",
    "A voicemail has your name, organization, reason, a callback time and no private details.",
  ],
  screens: [
    {
      id: "channels-matter",
      title: "Why the channel changes things",
      blocks: [
        { type: "paragraph", text: "A caller cannot see your face on a call. In an email they cannot hear your tone. In a chat they cannot tell if you have gone away. Each channel needs a few extra habits to make up for what is missing." },
        {
          type: "table",
          caption: "What each channel needs",
          columns: ["Channel", "What is missing", "What you add"],
          rows: [
            ["Phone", "Sight", "Warm tone, steady pace, confirm what you heard"],
            ["Chat", "Voice and silence cues", "Short messages, say when you will be back"],
            ["Email", "Tone", "Clear structure, a subject line, a named next step"],
            ["Voicemail", "A live person", "A complete, private-safe message"],
          ],
        },
      ],
    },
    {
      id: "phone-basics",
      title: "On the phone",
      blocks: [
        { type: "paragraph", text: "Open with a warm greeting, your name and the organization. Speak at a steady pace. If the line is poor, do not speak louder and faster. Slow slightly, ask politely for a repeat and confirm what you heard." },
        {
          type: "branch",
          title: "A hard-to-hear line",
          intro: "A caller (invented) is calling from a noisy place and you cannot hear well.",
          turns: [
            { caller: "(Noise) ...I need to change my... can you hear me?", choices: [{ text: "I am having trouble hearing you. Could you say that again a little slower?", mood: 15, reply: "Sorry, let me step outside. One second." }, { text: "I can't hear you. Call back later.", mood: -25, reply: "Seriously? Fine." }] },
            { caller: "Okay, is this better? I need to move my appointment to Friday.", choices: [{ text: "Much better, thank you. To confirm: you would like to move it to Friday. Is that right?", mood: 15, reply: "Yes, that is right." }, { text: "Friday, okay.", mood: -5, reply: "Wait, did you get the time too?" }] },
          ],
        },
      ],
    },
    {
      id: "holds-transfers",
      title: "Holds and transfers",
      blocks: [
        { type: "paragraph", text: "A hold or a transfer is a moment when callers feel most alone. Handle both with care." },
        {
          type: "steps",
          items: [
            { title: "Ask first", text: "“May I place you on a brief hold?” Wait for a yes." },
            { title: "Say how long", text: "“It should take about two minutes.”" },
            { title: "Check back", text: "If it takes longer, return and update them." },
            { title: "Thank them", text: "“Thank you for holding.”" },
          ],
        },
        { type: "callout", tone: "warning", text: "Never talk about the caller or the case where they might hear you. Mute properly, or do not talk." },
      ],
    },
    {
      id: "warm-transfer",
      title: "The warm transfer",
      blocks: [
        { type: "paragraph", text: "A warm transfer means the caller never has to start over. Put the steps in order." },
        {
          type: "sort",
          title: "Put a warm transfer in order",
          prompt: "Drag the steps into the right order.",
          items: ["Tell the caller who you are transferring them to and why", "Briefly explain the situation to the next person", "Stay on the line until they are connected", "Check the caller is happy to proceed", "Leave a short note of the transfer"],
          explanation: "The caller is told first, the next person is briefed so nothing has to be repeated, and you stay until the connection is made.",
        },
      ],
    },
    {
      id: "chat",
      title: "Chat",
      blocks: [
        { type: "paragraph", text: "Chat feels quick and casual, but the same standards apply. Keep messages short. Greet by name. If you need a moment, say how long: “I am checking that now and will be back in about two minutes.” Silence in a chat feels like being left." },
        {
          type: "list",
          items: ["Use short paragraphs and plain words.", "Never type in all capital letters. It reads as shouting.", "Answer one question at a time.", "If the conversation becomes emotional or long, offer a call if your client allows it."],
        },
        {
          type: "spot",
          title: "Find the chat mistake",
          prompt: "Tap the message that breaks a chat standard.",
          lines: [
            { speaker: "Customer", text: "Hi, I was charged twice this month." },
            { speaker: "Agent", text: "Hello Jo, I can see that. I am checking now and will be back in two minutes." },
            { speaker: "Customer", text: "Thank you." },
            { speaker: "Agent", text: "WE WILL SORT IT OUT, YOU NEED TO WAIT.", wrong: true },
          ],
          explanation: "All capitals read as shouting, and “you need to wait” gives no time frame. The earlier message was a good model.",
        },
      ],
    },
    {
      id: "email",
      title: "Email",
      blocks: [
        { type: "paragraph", text: "Email lasts. People forward it and file it. Start with a clear subject line that says what the message is about, and structure the body: greeting, purpose, information, next step, closing." },
        {
          type: "game",
          title: "Right Channel, Right Words",
          rounds: [
            { question: "Which subject line is best?", options: [{ text: "Update on your request from October 12", correct: true, feedback: "It says exactly what the message is about." }, { text: "Hi", correct: false, feedback: "It tells the reader nothing." }, { text: "URGENT!!!", correct: false, feedback: "It feels like pressure and does not say what it is about." }] },
            { question: "Where does the next step go in an email?", options: [{ text: "Clearly stated near the end, with who and when", correct: true, feedback: "Readers look for it there." }, { text: "Hidden in the middle", correct: false, feedback: "It may be missed." }] },
            { question: "A customer in chat is getting upset. A good move?", options: [{ text: "Acknowledge the frustration and, if allowed, offer to call", correct: true, feedback: "Voice can calm things down." }, { text: "Send a long copy of the policy", correct: false, feedback: "It will not help." }] },
          ],
        },
      ],
    },
    {
      id: "voicemail",
      title: "Voicemail",
      blocks: [
        { type: "paragraph", text: "When you reach a voicemail, leave a message that is complete and private. A good voicemail has five parts:" },
        {
          type: "list",
          items: ["Your name and organization.", "The reason you are calling, in a few words.", "A callback time or number.", "What the person should do next, if anything.", "**No private details.** Do not describe a request, a result or a health matter on a voicemail."],
        },
        {
          type: "case",
          title: "Leaving a voicemail",
          scenario: "You return a call to Maria R. (invented) about her request. She does not answer and it goes to voicemail.",
          question: "What do you say?",
          answer: "“Hello Maria, this is Alex from ERS returning your call. I have an update for you. Please call me back at the number on your record, or I will try again at 3 pm today.” It names you and the reason, gives a callback plan and shares no details about the request.",
        },
      ],
    },
    {
      id: "closing",
      title: "Closing well on every channel",
      blocks: [
        { type: "paragraph", text: "A clean close takes thirty seconds and prevents most callbacks. On every channel, do three things:" },
        {
          type: "steps",
          items: [
            { title: "Summarize", text: "“So we have moved your appointment to Friday at 10.”" },
            { title: "Confirm the next step", text: "“I will send you an email today to confirm.”" },
            { title: "Thank them", text: "“Thank you for calling. Take care.”" },
          ],
        },
        { type: "callout", tone: "tip", text: "Ask “Is there anything else I can help you with today?” only when you are ready to hear the answer." },
      ],
    },
  ],
};
