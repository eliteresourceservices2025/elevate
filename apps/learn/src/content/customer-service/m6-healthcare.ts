import type { CourseModule } from "../schema";

// Customer Service course, module 6 (added at HR's request). Counsel reviews this module before it is published. Our role is
// process: we listen, verify, route and document. We never diagnose, interpret or advise. Each client's own steps (identity checks,
// emergency steps, escalation contacts) are taught in that client's add-on module. Invented people and details only.

export const healthcareModule: CourseModule = {
  key: "healthcare",
  title: "Healthcare support calls",
  summary: "Handling appointment, refill, results, billing and urgent calls with kindness: listen, verify, route and document, and never give medical advice.",
  estimatedMinutes: 18,
  tracks: ["full"],
  keyPoints: [
    "In healthcare calls we help with process. We never diagnose, interpret results or advise.",
    "Verify who is calling and that they may have the information before you discuss anything.",
    "For a refill, take the request accurately, route it and set a follow-up time. Never promise approval.",
    "A worried family member needs to be heard. Offer a call from the care team and a time frame.",
    "If a caller describes a possible emergency, follow the client's emergency steps at once and alert your lead.",
    "Each client's own steps are taught in that client's add-on module.",
  ],
  screens: [
    {
      id: "who-calls",
      title: "Who calls, and what they need",
      blocks: [
        { type: "paragraph", text: "Many of our calls come from patients, their relatives, and caregivers or family of people living in a care home. They are often worried, tired or in a hurry. They need to be heard first and helped second." },
        {
          type: "table",
          caption: "Common healthcare calls",
          columns: ["Call", "What we do"],
          rows: [
            ["Appointment", "Book, move or confirm after verifying who is calling"],
            ["Refill or records", "Take the request accurately and route it; set a follow-up time"],
            ["Results worry", "Listen, do not interpret, arrange a call from the care team"],
            ["Insurance or billing", "Stay calm, do not guess coverage, route to billing"],
            ["Possible emergency", "Follow the client's emergency steps immediately"],
          ],
        },
      ],
    },
    {
      id: "our-role-limits",
      title: "Our role and its limits",
      blocks: [
        { type: "paragraph", text: "In healthcare calls we are not clinicians. Our job is to listen, verify, route and document. This keeps people safe and keeps us honest about what we know." },
        {
          type: "compare",
          left: { title: "We do", items: ["Listen kindly and take the request", "Verify who is calling", "Route to the right team with a time frame", "Write a clear note"] },
          right: { title: "We never", items: ["Say what a symptom or result means", "Reassure with “it is probably fine”", "Suggest a dose or a different medicine", "Promise a request will be approved"] },
        },
        { type: "callout", tone: "warning", text: "Even a kind guess about a symptom or result can do real harm. When in doubt, route it." },
      ],
    },
    {
      id: "appointments",
      title: "Appointment calls",
      blocks: [
        { type: "paragraph", text: "Appointment calls are the most common. Verify first, then help. Offer the available times, confirm the details back to the caller and tell them what happens next, such as a reminder." },
        {
          type: "steps",
          items: [
            { title: "Verify", text: "Confirm who the caller is and that they may manage the appointment." },
            { title: "Listen", text: "Let them explain what they need to change." },
            { title: "Offer", text: "Give the available choices." },
            { title: "Confirm", text: "Say the new date and time back to them." },
            { title: "Close", text: "Tell them about any reminder and thank them." },
          ],
        },
      ],
    },
    {
      id: "refills-billing",
      title: "Refills, records and billing",
      blocks: [
        { type: "paragraph", text: "A refill or records request is a message to the care team. Take the details exactly, route them through the client's process and tell the caller when to expect a reply. Never suggest an outcome." },
        {
          type: "cards",
          title: "Route it right",
          prompt: "Sort each thing a VA might say or do.",
          groups: ["Appropriate", "Not appropriate"],
          cards: [
            { text: "Recording the refill request accurately and routing it", group: 0, feedback: "That is the task." },
            { text: "Telling the caller the refill will be approved", group: 1, feedback: "Only the care team decides." },
            { text: "Explaining what coverage probably includes", group: 1, feedback: "Guessing can mislead. Route billing questions." },
            { text: "Telling the caller when to expect a reply", group: 0, feedback: "Clear expectations build trust." },
            { text: "Suggesting a different dose", group: 1, feedback: "That is medical advice." },
          ],
        },
      ],
    },
    {
      id: "results-worry",
      title: "A worry about results",
      blocks: [
        { type: "paragraph", text: "People often see test results online before they speak to anyone. A number in red can feel frightening. Our role is not to explain it. It is to take the worry seriously and make sure the care team calls." },
        {
          type: "branch",
          title: "“Is she okay?”",
          intro: "A relative (invented) saw a lab result for her mother on the patient portal. One number is marked red. She is worried and asks you what it means.",
          startMood: 35,
          record: { title: "Customer record", rows: [{ label: "Caller", value: "Linda K. (invented)" }, { label: "Authorized contact", value: "Yes" }, { label: "Client rule", value: "Results questions go to the care team" }] },
          turns: [
            { caller: "I saw my mom's results online and one number is red. Is she okay?", choices: [{ text: "I can hear how worried you are. I cannot explain results, but I can make sure her care team calls you.", mood: 20, reply: "Please. I just want someone to talk to me." }, { text: "Red does not always mean something bad.", mood: 0, reply: "So she is fine?" }, { text: "Red means it is abnormal.", mood: -25, reply: "Oh no." }] },
            { caller: "When will they call me?", choices: [{ text: "I will send the request now. The care team calls within the time this clinic uses for results questions, and I will note what you asked.", mood: 15, reply: "Thank you." }, { text: "Someone will call you.", mood: -10, reply: "When?" }] },
          ],
        },
      ],
    },
    {
      id: "urgent",
      title: "When it sounds urgent",
      blocks: [
        { type: "paragraph", text: "Sometimes a caller mentions something that sounds like an emergency: chest pain, trouble breathing, a fall, signs of a stroke, or thoughts of self-harm. You are not there to judge how serious it is. You are there to act on what you heard." },
        {
          type: "steps",
          items: [
            { title: "Stay calm and listen", text: "Do not argue about whether it is serious." },
            { title: "Tell them to call emergency services", text: "Clearly and kindly: “Please call emergency services now.”" },
            { title: "Follow the client's emergency steps", text: "Alert your lead right away." },
            { title: "Record it", text: "The time, the exact words and what you told the caller." },
          ],
        },
        { type: "callout", tone: "warning", text: "A routine request does not come first when a person's safety may be at risk. Never book, never wait, never reassure." },
        {
          type: "cards",
          title: "Route, verify or emergency?",
          prompt: "Sort each opening line from a caller.",
          groups: ["Route it", "Verify first", "Emergency steps"],
          cards: [
            { text: "“Can you move my father's appointment to Friday?”", group: 1, feedback: "Verify who is calling, then help." },
            { text: "“My mom needs her refill by Monday.”", group: 0, feedback: "Take the request and route it with a time frame." },
            { text: "“He is sitting here with chest pain and his arm hurts.”", group: 2, feedback: "A possible emergency comes before anything else." },
            { text: "“I have a question about my bill.”", group: 0, feedback: "Route to billing; do not guess coverage." },
            { text: "“She just fell and cannot get up.”", group: 2, feedback: "Emergency steps now." },
          ],
        },
      ],
    },
    {
      id: "care-homes",
      title: "Families of care-home residents",
      blocks: [
        { type: "paragraph", text: "Relatives of people living in a care home often call about visits, updates and incidents. They may be anxious or even angry. The same rules apply: verify who they are, share only what they are authorized to have, and route anything clinical to the care team." },
        {
          type: "check",
          question: "A caller asks if her mother fell last night. You have not confirmed she is an authorized contact. What do you do?",
          options: [
            { text: "Explain you need to confirm authorization, follow the client's process and offer to pass a message to the care team", correct: true, feedback: "Family is not the same as authorized, and a kind route is offered." },
            { text: "Tell her, since she is family", correct: false, feedback: "Relationship is not authorization." },
            { text: "Say that nothing happened", correct: false, feedback: "A denial is dishonest and may be untrue." },
          ],
        },
      ],
    },
    {
      id: "plain-terms",
      title: "Plain-language terms",
      blocks: [
        { type: "paragraph", text: "You do not need to be an expert, but a few common words should not throw you. If you do not know a term, do not guess. Ask politely or check the client's notes." },
        {
          type: "glossary",
          terms: [
            { term: "Refill", meaning: "A request for more of a medicine already prescribed." },
            { term: "Referral", meaning: "A request for a patient to see another specialist." },
            { term: "Pre-authorization", meaning: "Approval from an insurer before a service or medicine." },
            { term: "Copay", meaning: "A fixed amount a patient pays at a visit." },
            { term: "Care team", meaning: "The doctors, nurses and staff looking after a patient." },
            { term: "Authorized contact", meaning: "A person the patient has said may receive information." },
          ],
        },
        { type: "callout", tone: "info", text: "Where health information is involved, the ELEVATE HIPAA course covers the rules in depth. Each client's own steps are taught in that client's add-on module." },
        {
          type: "game",
          title: "Route It Right",
          seconds: 25,
          rounds: [
            { question: "A caller asks what a lab result means.", options: [{ text: "Explain you cannot interpret it, and arrange a care-team call", correct: true, feedback: "Interpreting is clinical." }, { text: "Explain it in plain words", correct: false, feedback: "We never interpret." }] },
            { question: "A caller says her father has chest pain right now.", options: [{ text: "Tell her to call emergency services and alert your lead", correct: true, feedback: "Emergency first." }, { text: "Book an appointment for next week", correct: false, feedback: "That delays help." }] },
            { question: "A caller wants to know if her refill will be approved.", options: [{ text: "Route it and say when to expect a reply", correct: true, feedback: "You never promise an outcome." }, { text: "Say it will probably be approved", correct: false, feedback: "Only the care team decides." }] },
            { question: "A caller says he does not understand a term, 'pre-authorization'.", options: [{ text: "Explain it simply or check the client's notes", correct: true, feedback: "Do not guess." }, { text: "Say it is not your job", correct: false, feedback: "It is a polite, quick explanation." }] },
          ],
        },
      ],
    },
  ],
};
