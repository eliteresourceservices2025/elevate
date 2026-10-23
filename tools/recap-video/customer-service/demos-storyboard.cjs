// Three worked example calls for the Customer Service course, shown before the graded mock call. They replace the three from the deck
// (cs-11 to cs-13), which were held back because they sat too close to the graded calls. These use DIFFERENT callers and situations
// (a contact-detail change, a form returned twice, a deadline exception) so nothing here is the answer to a graded call. Invented people only.
// The skills are the same ones the course teaches: verify first, listen and acknowledge, never promise what is not confirmed, document.
//   node customer-service/narrate-welcome.cjs --set demos --speed 1.35      CS_SET=demos node customer-service/render-welcome.cjs
const LABEL = "WORKED EXAMPLE  |  ELEVATE LEARN";
const coaching = (items) => ({ kind: "checklist", heading: "What worked", lead: "What worked in this call:", items });
module.exports = [
  {
    id: "cs-d1-routine-request",
    title: "Worked example: a routine request",
    label: LABEL,
    tagline: "Verify first, then help",
    introSay: "Worked example. A routine request.",
    scenes: [
      {
        kind: "dialogue",
        scenario: "A family member wants to change the contact number on their own file",
        lead: "In this call, a family member wants to update their own contact details.",
        lines: [
          { who: "rep", text: "Thank you for calling. My name is Ana. How may I help you today?" },
          { who: "family", text: "Hi. I would like to change the phone number you have on my file." },
          { who: "rep", text: "I'm happy to help with that. First I need to verify who I'm speaking with. May I have your full name and your reference, please?" },
        ],
      },
      {
        kind: "dialogue",
        scenario: "After verification",
        lines: [
          { who: "family", text: "Of course. It's Carla Reyes, and the reference is in my last email." },
          { who: "rep", text: "Thank you, Carla. That matches our record. What is the new number?" },
          { who: "family", text: "It's my new mobile. I'll read it out." },
          { who: "rep", text: "Thank you. Let me read it back to make sure it's correct. I've updated your file and added a note about the change. Is there anything else I can help with?" },
        ],
      },
      coaching([
        { text: "Professional greeting", icon: "headset", say: "A professional greeting." },
        { text: "Verified first", icon: "lock", say: "Verified who she was before changing anything." },
        { text: "Read it back", icon: "check-check", say: "Read the new detail back to confirm it." },
        { text: "Documented", icon: "clipboard-list", say: "Added a note about the change." },
        { text: "Offered more help", icon: "handshake", say: "And offered further help." },
      ]),
    ],
  },
  {
    id: "cs-d2-returned-form",
    title: "Worked example: a form returned twice",
    label: LABEL,
    tagline: "Acknowledge, then act",
    introSay: "Worked example. A form returned twice.",
    scenes: [
      {
        kind: "dialogue",
        scenario: "A family member's form has come back to them twice",
        lead: "In this call, a family member is frustrated that a form they sent has come back twice.",
        lines: [
          { who: "family", text: "I have sent this form twice and it keeps coming back to me!" },
          { who: "rep", text: "I'm sorry that has happened twice. Let me make sure I understand. You sent the form, and it was returned each time. Is that right?" },
          { who: "family", text: "Yes, and nobody tells me what is missing." },
          { who: "rep", text: "That would frustrate anyone. Let me check the notes on your file, so you don't have to explain it all again." },
        ],
      },
      {
        kind: "dialogue",
        scenario: "After reviewing the file",
        lines: [
          { who: "family", text: "Fine. What happens after that?" },
          { who: "rep", text: "Once I confirm what is missing, I'll explain how to send it and what to expect. I'll also note on your file that you've already sent it twice, so the next person doesn't ask you to start over. I can't promise a processing time until it's confirmed." },
        ],
      },
      coaching([
        { text: "Acknowledged the frustration", icon: "heart", say: "Apologized and acknowledged the frustration." },
        { text: "Checked she understood", icon: "ear", say: "Checked that she understood the problem correctly." },
        { text: "Reviewed the notes", icon: "file-search", say: "Reviewed the notes, so the caller did not repeat everything." },
        { text: "Next step explained", icon: "route", say: "Explained the next step." },
        { text: "No unconfirmed promise", icon: "ban", say: "And made no promise about a time that was not confirmed." },
      ]),
    ],
  },
  {
    id: "cs-d3-supervisor-exception",
    title: "Worked example: a request for a supervisor",
    label: LABEL,
    tagline: "Respect the request",
    introSay: "Worked example. A request for a supervisor.",
    scenes: [
      {
        kind: "dialogue",
        scenario: "A family member missed a deadline and wants someone to review it",
        lead: "In this call, a family member asks to speak with a supervisor.",
        lines: [
          { who: "family", text: "I would like to speak with a supervisor." },
          { who: "rep", text: "Of course. I'll help you with that. If you're comfortable, could you tell me briefly what it's about, so I can pass it along?" },
          { who: "family", text: "I missed a deadline by one day, and I was told no exception is possible." },
        ],
      },
      {
        kind: "dialogue",
        scenario: "Passing it on",
        lines: [
          { who: "rep", text: "Thank you for explaining. I understand you would like someone to review that. I'll follow our process to connect you with a supervisor, and I'll share your summary so you don't have to repeat it." },
          { who: "family", text: "How long will that take?" },
          { who: "rep", text: "I'll check how the process works and tell you the next step. I don't want to give you a wait time that I can't confirm." },
        ],
      },
      coaching([
        { text: "Honored the request", icon: "handshake", say: "Honored the request without arguing." },
        { text: "Asked permission for details", icon: "message-circle", say: "Asked permission before gathering details." },
        { text: "Summary passed on", icon: "file-text", say: "Passed the summary on, so the caller did not repeat it." },
        { text: "Followed the process", icon: "route", say: "Followed the escalation process." },
        { text: "No invented wait time", icon: "ban", say: "And did not invent a wait time." },
      ]),
    ],
  },
];
