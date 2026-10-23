import type { CourseModule } from "../schema";

// Customer Service course, module 5. Counsel reviews this module before it is published. Invented people and details only.
// The detailed privacy rules for health information live in the ELEVATE HIPAA course.

export const confidentialityModule: CourseModule = {
  key: "confidentiality",
  title: "Confidentiality and boundaries",
  summary: "Knowing who you are speaking to, sharing only what a person may have, staying in your role and keeping healthy boundaries.",
  estimatedMinutes: 18,
  tracks: ["full"],
  keyPoints: [
    "Confirm who you are speaking with, and that they may have the information, before sharing anything.",
    "A relationship (a brother, a friend) is not the same as authorization.",
    "Share only what is needed, and only with people who are allowed to have it.",
    "Take calls where others cannot overhear. Keep voicemails and messages free of private details.",
    "Stay in your role: no medical, legal or financial advice.",
    "If you make a mistake, tell your lead right away. Reporting is never punished.",
  ],
  screens: [
    {
      id: "private-info",
      title: "What private information looks like",
      blocks: [
        { type: "paragraph", text: "Families trust us with private information: who they are, what they have asked for and, in healthcare work, health matters. Knowing when to say “I cannot share that” is as important as knowing what to say." },
        {
          type: "list",
          items: ["A person's name together with their request or case.", "Contact details and home details.", "Anything about someone's health, treatment, results or appointments.", "Account and reference numbers."],
        },
        { type: "callout", tone: "info", text: "The detailed rules for health information are taught in the ELEVATE HIPAA course. This module covers the everyday habits that apply to every call." },
      ],
    },
    {
      id: "who-am-i-speaking-to",
      title: "Who am I speaking to?",
      blocks: [
        { type: "paragraph", text: "Before you discuss any details, do two things: confirm who the person is, and confirm that they are allowed to have the information. Follow the client's own procedure for how." },
        {
          type: "steps",
          items: [
            { title: "Ask who they are", text: "Their full name and how they are connected to the case." },
            { title: "Check the record", text: "Is this person listed as someone who may receive information?" },
            { title: "Only then share", text: "And only what the person needs and may have." },
          ],
        },
        { type: "callout", tone: "warning", text: "A friendly voice, a good reason or a sense of urgency does not replace the check." },
      ],
    },
    {
      id: "relationship-not-authorization",
      title: "A relationship is not authorization",
      blocks: [
        { type: "paragraph", text: "“I am his sister.” “I am calling for my neighbour.” “She asked me to ask.” These sound reasonable, and they are the most common way private information is shared by mistake." },
        {
          type: "branch",
          title: "“Just tell me the status”",
          intro: "A caller (invented) says she is a family member and asks for the status of someone's request. She is not on the list of authorized contacts.",
          startMood: 45,
          record: { title: "Customer record", rows: [{ label: "Caller", value: "Priya S. (invented)" }, { label: "Asking about", value: "Her cousin's request" }, { label: "Authorized contacts", value: "Cousin only" }] },
          turns: [
            { caller: "I am her cousin. Just tell me where her request is. It is no big deal.", choices: [{ text: "I understand. I can only share details with people she has authorized. I can pass a message to her.", mood: 15, reply: "Hm. Okay, I suppose that makes sense." }, { text: "It is under review, due tomorrow.", mood: -10, reply: "Thank you, that is all I needed." }, { text: "I cannot tell you anything.", mood: -20, reply: "That is not very helpful." }] },
            { caller: "Can you at least tell me if it was approved?", choices: [{ text: "I am sorry, I cannot even confirm that. If she calls us she can add you as a contact.", mood: 10, reply: "Okay, I will tell her." }, { text: "I can say yes or no.", mood: -10, reply: "Great, so is it approved?" }] },
          ],
        },
      ],
    },
    {
      id: "minimum-necessary",
      title: "Share only what is needed",
      blocks: [
        { type: "paragraph", text: "Even with someone who may have information, share only what they need for the purpose of the call. Answer the question that was asked. Do not read out everything on the record." },
        {
          type: "cards",
          title: "Share, verify or decline?",
          prompt: "A caller asks you for something. Sort each request.",
          groups: ["Share", "Verify first", "Decline"],
          cards: [
            { text: "A verified, authorized caller asks about her own appointment time.", group: 0, feedback: "Verified and allowed: share what she asked, and only that." },
            { text: "Someone says they are a relative and asks for a case status.", group: 1, feedback: "Check the record for authorization before anything else." },
            { text: "A person asks for someone else's phone number.", group: 2, feedback: "Never share one person's details with another." },
            { text: "A caller asks to be reminded of their own request reference.", group: 1, feedback: "Confirm who they are first, then help." },
            { text: "A caller wants to see the whole account history 'just in case'.", group: 2, feedback: "Share only what is needed for the question." },
          ],
        },
      ],
    },
    {
      id: "private-places",
      title: "Private places, private messages",
      blocks: [
        { type: "paragraph", text: "Confidentiality is also about where and how you work." },
        {
          type: "list",
          items: ["Take calls where nobody else can overhear.", "Do not leave detailed messages on shared voicemail or with another person.", "Do not discuss callers, even without names, on social media or chat groups.", "Close the case when you step away so a screen cannot be seen."],
        },
        {
          type: "game",
          title: "Gatekeeper",
          rounds: [
            { question: "A caller asks for details of a case they are not authorized for.", options: [{ text: "Decline kindly and offer to pass a message", correct: true, feedback: "Protects the person and keeps the caller helped." }, { text: "Share, since they sound sure", correct: false, feedback: "A confident voice is not authorization." }] },
            { question: "You are asked to leave a detailed voicemail about a request.", options: [{ text: "Leave your name, a callback time and no details", correct: true, feedback: "Private-safe and useful." }, { text: "Leave the full update", correct: false, feedback: "Others may hear it." }] },
            { question: "You want to chat about a tough call with a friend.", options: [{ text: "Talk with your lead, not outsiders", correct: true, feedback: "Support is good; sharing caller details outside is not." }, { text: "Post it online without names", correct: false, feedback: "Details can still identify someone." }] },
          ],
        },
      ],
    },
    {
      id: "stay-in-role",
      title: "Stay in your role",
      blocks: [
        { type: "paragraph", text: "People may ask us for advice because we are kind and available. We help with process. We do not give medical, legal or financial advice, even when someone seems to need it and even when you are sure you know the answer." },
        {
          type: "case",
          title: "“What would you do?”",
          scenario: "A caller (invented) asks, “If it were your mother, would you change the dose?” You want to help.",
          question: "What do you say?",
          answer: "“I wish I could help with that, but I am not able to advise on medication. Her care team can. I can help you reach them or make a note for them to call you.” You stay kind, stay in your role and point to the right help.",
        },
      ],
    },
    {
      id: "boundaries-and-mistakes",
      title: "Boundaries and mistakes",
      blocks: [
        { type: "paragraph", text: "Keep a healthy line between your work and your life. Do not share your personal phone number or accounts. Politely explain the official way to reach you and promise a specific follow-up." },
        { type: "paragraph", text: "If you make a mistake, such as emailing the wrong person, tell your lead and report it through the incident process straight away. Fast reporting limits harm. Reporting is never punished." },
        {
          type: "check",
          question: "You realize you emailed a family's update to the wrong person. What first?",
          options: [
            { text: "Tell your lead and report it through the incident process now", correct: true, feedback: "Speed limits harm, and you will be supported for reporting." },
            { text: "Ask the wrong person to delete it quietly", correct: false, feedback: "Your lead needs to know so the right steps can be taken." },
            { text: "Wait and see if anything happens", correct: false, feedback: "Waiting makes a mistake bigger." },
          ],
        },
      ],
    },
  ],
};
