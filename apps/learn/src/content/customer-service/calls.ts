import type { CallSeed } from "../schema";

// The mock-call pool for the Customer Service & Family Support course (docs/learn/14-mock-call.md). Five calls; each attempt draws
// three and always includes at least one of the two medical calls. Every person and detail is invented. The best reply is worth 3
// points, a fair one 1, a harmful one 0; the position of the best reply changes from step to step.

type Pick = { text: string; mood: number; reply: string; why: string };
type Trio = { best: Pick; fair: Pick; bad: Pick };
const IDS = ["a", "b", "c"] as const;

/** Lays the three replies out in the given order, so the best one is not always first. */
function choices(order: ("best" | "fair" | "bad")[], t: Trio) {
  return order.map((kind, i) => {
    const p = t[kind];
    return { id: IDS[i], text: p.text, points: kind === "best" ? 3 : kind === "fair" ? 1 : 0, mood: p.mood, reply: p.reply, why: p.why };
  });
}

const caller = (id: string, category: "opening" | "listening" | "accuracy" | "resolution" | "deescalation", text: string, order: ("best" | "fair" | "bad")[], t: Trio) => ({
  kind: "caller" as const,
  id,
  caller: text,
  category,
  choices: choices(order, t),
});
const note = (label: string, order: ("best" | "fair" | "bad")[], t: Trio) => ({ kind: "note" as const, id: "note", label, choices: choices(order, t) });

const missedUpdate: CallSeed = {
  key: "missed_update",
  title: "A missed update",
  moduleKey: "resolution",
  medical: false,
  startMood: 40,
  intro: "Maria R. (an invented family member) phones about a request she sent three days ago. Someone promised her an update yesterday. Nobody called.",
  record: { title: "Customer record", rows: [{ label: "Caller", value: "Maria R. (invented)" }, { label: "Request", value: "Sent three days ago, under review" }, { label: "Promised", value: "An update by yesterday afternoon" }] },
  steps: [
    caller("s1", "opening", "Hello? I was promised an update yesterday and nobody called me.", ["best", "fair", "bad"], {
      best: { text: "Thank you for calling, Maria. I am sorry you did not hear from us. Let me look at your request now.", mood: 15, reply: "Okay. Thank you.", why: "It greets her, owns the missed call and says what you will do." },
      fair: { text: "Thanks for calling. What is your name?", mood: 0, reply: "It is Maria. Weren't you going to call me?", why: "Polite, but it skips the missed promise." },
      bad: { text: "We have been very busy this week.", mood: -25, reply: "That is not my problem.", why: "An excuse puts the caller second." },
    }),
    caller("s2", "listening", "It has been three days now. The last person told me I would hear back within one day.", ["fair", "best", "bad"], {
      best: { text: "Waiting three days after being told one day is frustrating. Let me find out what happened.", mood: 15, reply: "Yes, exactly. I just want to know where it stands.", why: "It names the feeling and the specific gap, then acts." },
      fair: { text: "I understand. Let me check.", mood: 3, reply: "Alright.", why: "Acceptable, but generic and not tied to her situation." },
      bad: { text: "Please calm down. I am sure it is being worked on.", mood: -20, reply: "Do not tell me to calm down!", why: "Telling someone to calm down dismisses the feeling." },
    }),
    caller("s3", "accuracy", "Can you just read me everything on the account? I would like to see it all.", ["bad", "fair", "best"], {
      best: { text: "I can help with that. First I need to confirm who I am speaking with: your full name and the request reference, please.", mood: 5, reply: "Of course. It is Maria R., and the reference is on my email.", why: "Identity comes before any details." },
      fair: { text: "Sure, one moment while I pull it up.", mood: 0, reply: "Thanks.", why: "It starts without confirming who is asking." },
      bad: { text: "Sure, here is everything on the account.", mood: -10, reply: "Great, go ahead.", why: "Sharing before verifying is the mistake this course exists to prevent." },
    }),
    caller("s4", "resolution", "So what happens next?", ["fair", "bad", "best"], {
      best: { text: "Your request is with the review team. I will call you by 3 pm tomorrow with the status, and I will leave a note so a teammate can follow up if I am away.", mood: 20, reply: "Good. I will wait for your call.", why: "It gives a time, an owner and a back-up: a clear next step." },
      fair: { text: "The team is reviewing it. You should hear soon.", mood: 0, reply: "Soon? When is soon?", why: "No time and no owner leaves her guessing again." },
      bad: { text: "I cannot say. Someone will get back to you.", mood: -20, reply: "That is exactly what I was told last time.", why: "A vague promise is how the first missed update happened." },
    }),
    note("Call note: follow-up", ["best", "bad", "fair"], {
      best: { text: "Caller asked about a request from three days ago and a missed update. Identity confirmed. Reviewed status. Promised a call by 3 pm tomorrow.", mood: 0, reply: "Note saved.", why: "It has the concern, what was done and the follow-up with a time." },
      fair: { text: "Customer upset about update. Will follow up.", mood: 0, reply: "Note saved.", why: "No time, no detail: a teammate could not continue from it." },
      bad: { text: "Customer called. Issue handled.", mood: 0, reply: "Note saved.", why: "It says nothing a colleague could use." },
    }),
  ],
};

const thirdCall: CallSeed = {
  key: "third_call",
  title: "The third call",
  moduleKey: "difficult",
  medical: false,
  startMood: 25,
  intro: "Daniel T. (an invented caller) has phoned three times about the same problem and is angry. Your job is to stay calm, understand it and find a clear way forward.",
  record: { title: "Customer record", rows: [{ label: "Caller", value: "Daniel T. (invented)" }, { label: "Issue", value: "A scheduling mix-up, reported twice" }, { label: "Calls so far", value: "Three (this is the third)" }] },
  steps: [
    caller("s1", "deescalation", "This is my third call and nobody is helping me!", ["bad", "best", "fair"], {
      best: { text: "I am sorry you have had to call three times, Daniel. I will stay with you until we have a plan. Can you tell me what happened?", mood: 20, reply: "Fine. Here is what happened...", why: "It apologizes for the experience, commits to staying and invites the story." },
      fair: { text: "What is your reference number?", mood: -5, reply: "I do not have it handy! Why do I always have to look for it?", why: "Asking for details first can feel like another obstacle." },
      bad: { text: "That is not my fault.", mood: -30, reply: "I did not say it was your fault, I said no one is helping!", why: "Defending yourself ignores the person's frustration." },
    }),
    caller("s2", "listening", "Every time I have to explain it from the very beginning and nothing ever changes.", ["best", "bad", "fair"], {
      best: { text: "So you have explained it twice and nothing has changed. Let me read back what I have, and you tell me if I am missing anything.", mood: 20, reply: "Yes, that is right. You also missed the part about the Tuesday change.", why: "It reflects the problem, confirms it and invites corrections." },
      fair: { text: "I understand.", mood: 0, reply: "Do you? Because it does not feel like it.", why: "Too short to show that you actually listened." },
      bad: { text: "Please stop shouting.", mood: -25, reply: "I am not shouting, I am upset!", why: "It attacks the tone instead of the cause." },
    }),
    caller("s3", "resolution", "I just want this fixed. What are you going to do?", ["fair", "best", "bad"], {
      best: { text: "Here is my plan: I will correct the schedule now while you are on the line, confirm it with you, and send you the new details today.", mood: 20, reply: "Alright. Thank you for actually doing something.", why: "Specific actions, done now, with a confirmation." },
      fair: { text: "I will look into it and see what I can do.", mood: -5, reply: "That is what the last person said.", why: "It repeats the vague promise that caused the anger." },
      bad: { text: "There is nothing I can do right now.", mood: -25, reply: "Then why am I on the phone with you?", why: "It closes the door instead of offering an option." },
    }),
    caller("s4", "resolution", "I want to speak to a supervisor.", ["bad", "fair", "best"], {
      best: { text: "Of course. I will bring in my lead now. To save you repeating yourself I will give them the summary. May I put you on a short hold?", mood: 15, reply: "Fine. Thank you for not making me explain again.", why: "A warm handoff with a summary: the caller never starts over." },
      fair: { text: "I can help you with this myself. Supervisors are busy.", mood: -10, reply: "I asked for a supervisor.", why: "Refusing a reasonable request raises the temperature." },
      bad: { text: "There are no supervisors available.", mood: -25, reply: "That cannot be true.", why: "An unhelpful no, with no alternative, is a poor escalation." },
    }),
    note("Call note: escalation", ["fair", "best", "bad"], {
      best: { text: "Third call from Daniel T. about a scheduling mix-up. Apologized, confirmed details, corrected the schedule, passed to my lead at the caller's request with a summary.", mood: 0, reply: "Note saved.", why: "It lists the concern, the actions and the handoff." },
      fair: { text: "Angry caller, escalated to lead.", mood: 0, reply: "Note saved.", why: "It records the fact but not what was done, so the lead lacks context." },
      bad: { text: "Daniel was rude and kept shouting.", mood: 0, reply: "Note saved.", why: "Opinions about the person do not belong in a record." },
    }),
  ],
};

const supervisorTrap: CallSeed = {
  key: "supervisor_trap",
  title: "A supervisor request and a request for someone else's details",
  moduleKey: "confidentiality",
  medical: false,
  startMood: 45,
  intro: "Alex P. (an invented caller) asks for a supervisor, and also wants the status of a request that belongs to his brother. He is not listed as a contact on that request.",
  record: { title: "Customer record", rows: [{ label: "Caller", value: "Alex P. (invented)" }, { label: "Asking about", value: "His brother's request" }, { label: "Authorized contacts", value: "Brother only" }] },
  steps: [
    caller("s1", "opening", "Hi. Put me through to your supervisor. I want to know what is going on with my brother's request.", ["fair", "best", "bad"], {
      best: { text: "Thank you for calling, Alex. I will help you right now, and if you still want a supervisor I will connect you. Can I ask what this is about?", mood: 10, reply: "It is about my brother's request. He asked me to check on it.", why: "It welcomes him, offers help and keeps the supervisor option open." },
      fair: { text: "Please hold while I get my supervisor.", mood: 0, reply: "Okay, I will hold.", why: "It hands off before understanding what he needs." },
      bad: { text: "Supervisors do not take calls like this.", mood: -20, reply: "What is that supposed to mean?", why: "It is dismissive and may not even be true." },
    }),
    caller("s2", "accuracy", "He is my brother. Just tell me where his request is. It is not a big deal.", ["bad", "fair", "best"], {
      best: { text: "I understand he is your brother. I can only share details with people he has authorized. I can pass your message to him, or he can call us and add you.", mood: 5, reply: "Hm. Okay, I suppose that makes sense.", why: "A relationship is not authorization. It declines kindly and offers a route." },
      fair: { text: "I can tell you if it is approved or not.", mood: 5, reply: "Great, is it approved?", why: "Even a status is a detail about someone who has not authorized the caller." },
      bad: { text: "Sure, it is under review and the update is due tomorrow.", mood: 10, reply: "Thank you, that is all I needed.", why: "This shares someone's details without authorization." },
    }),
    caller("s3", "deescalation", "This is ridiculous. He asked me to do this and you are being difficult!", ["best", "bad", "fair"], {
      best: { text: "I can see this is annoying, and I am sorry. The rule protects your brother as much as anyone. If he calls us or sends a note we can add you, and then I would be glad to help.", mood: 15, reply: "Fine. I will tell him to call.", why: "It acknowledges the feeling, explains the reason and gives a path." },
      fair: { text: "Those are the rules.", mood: -10, reply: "Wow. Thanks for nothing.", why: "A bare rule without empathy or an option raises the tension." },
      bad: { text: "If you keep arguing I will end the call.", mood: -25, reply: "Go ahead then.", why: "A threat is not warranted here; the caller is only frustrated." },
    }),
    caller("s4", "resolution", "I still want to speak to a supervisor about how this was handled.", ["fair", "bad", "best"], {
      best: { text: "Of course. I will pass you to my lead with a short summary so you do not have to repeat anything. May I put you on hold for a moment?", mood: 15, reply: "Alright, thank you.", why: "A supervisor request that is reasonable is honored with a handoff and a summary." },
      fair: { text: "I can take a message for the supervisor instead.", mood: -5, reply: "I would rather speak to someone now.", why: "It avoids the request without a reason." },
      bad: { text: "You do not need a supervisor for this.", mood: -20, reply: "That is for me to decide.", why: "The caller decides whether to ask for a supervisor; you decide how to help." },
    }),
    note("Call note: confidentiality", ["bad", "best", "fair"], {
      best: { text: "Alex P. asked about his brother's request. He is not an authorized contact: no details shared. Offered to pass a message. Escalated to my lead at his request.", mood: 0, reply: "Note saved.", why: "It records what was asked, what was withheld and why." },
      fair: { text: "Caller wanted info on someone else. Gave him nothing.", mood: 0, reply: "Note saved.", why: "It leaves out the escalation and the offer to pass a message." },
      bad: { text: "Alex wanted his brother's request. Told him it is under review.", mood: 0, reply: "Note saved.", why: "This note shows that details were shared." },
    }),
  ],
};

const resultsWorry: CallSeed = {
  key: "results_worry",
  title: "A worry about test results (medical)",
  moduleKey: "healthcare",
  medical: true,
  startMood: 35,
  intro: "Linda K. (an invented relative) saw a lab result for her mother on the patient portal. One number is marked red. She is worried and wants you to tell her what it means.",
  record: { title: "Customer record", rows: [{ label: "Caller", value: "Linda K. (invented)" }, { label: "Patient", value: "Her mother (invented)" }, { label: "Authorized contact", value: "Yes, Linda is on the list" }, { label: "Client rule", value: "Results questions go to the care team" }] },
  steps: [
    caller("s1", "opening", "Hello, I saw my mom's results online and one number is red. I am so worried. Is she okay?", ["best", "bad", "fair"], {
      best: { text: "Thank you for calling, Linda. I can hear how worried you are. I will make sure the right person gets back to you. May I first confirm a few details with you?", mood: 15, reply: "Yes, of course.", why: "It welcomes her, names the worry and sets up the next step, without guessing about the result." },
      fair: { text: "Hello. How can I help you today?", mood: 0, reply: "I told you, I am worried about my mom's results!", why: "A scripted greeting ignores what she just said." },
      bad: { text: "Red does not always mean something bad. I am sure she is fine.", mood: 5, reply: "Oh, thank goodness. So she is okay?", why: "Reassuring a caller about a medical result is guessing, and could be wrong." },
    }),
    caller("s2", "accuracy", "Yes, my name is Linda K. I am on her list of contacts.", ["fair", "best", "bad"], {
      best: { text: "Thank you. Let me confirm that on the record. Could you also give me your mother's date of birth so I can match the right file?", mood: 5, reply: "Sure, I have it here and can give it to you.", why: "It verifies against the record, not just on her word." },
      fair: { text: "Okay, thank you.", mood: 0, reply: "So what does the red mean?", why: "It accepts her word without checking the record." },
      bad: { text: "No need for that, I believe you.", mood: 5, reply: "Good, so can you tell me what it means?", why: "Trust is not verification." },
    }),
    caller("s3", "accuracy", "You can at least tell me if red means it is serious, can't you?", ["bad", "fair", "best"], {
      best: { text: "I wish I could ease that worry. I cannot explain what a result means, only her care team can. What I can do is ask them to call you.", mood: 10, reply: "Okay. I just want someone to talk to me.", why: "It stays in role, is kind and offers what it can actually do." },
      fair: { text: "It could be nothing, or something. It depends.", mood: 0, reply: "That does not help me at all.", why: "A vague medical remark worries her and still steps outside the role." },
      bad: { text: "Red means abnormal, so it is probably serious.", mood: -20, reply: "Oh no. Oh no.", why: "Interpreting a result is a clinical task and can cause real harm." },
    }),
    caller("s4", "resolution", "Okay. So what happens now?", ["fair", "best", "bad"], {
      best: { text: "I will send a request to her care team now to call you today, within the time this clinic uses for results questions. I will note exactly what you asked, so you will not need to explain again.", mood: 20, reply: "Thank you. That is what I needed.", why: "A clear step, a time frame from the client's rule and a note so she never repeats herself." },
      fair: { text: "Someone will call you back.", mood: 0, reply: "When?", why: "No time and no owner." },
      bad: { text: "Just check the portal again later today.", mood: -15, reply: "That is not helpful.", why: "It sends her back to what worried her." },
    }),
    note("Call note: results question", ["best", "fair", "bad"], {
      best: { text: "Linda K. (authorized contact, verified) asked what a red result means. Did not interpret. Requested a care-team callback today. Caller worried; no advice given.", mood: 0, reply: "Note saved.", why: "It records the verification, that no interpretation was given and the request." },
      fair: { text: "Daughter asked about results. Sent a message to the team.", mood: 0, reply: "Note saved.", why: "No verification and no time frame." },
      bad: { text: "Told caller the result is probably fine.", mood: 0, reply: "Note saved.", why: "This note records a medical opinion that was never allowed." },
    }),
  ],
};

const urgentSymptom: CallSeed = {
  key: "urgent_symptom",
  title: "An urgent symptom (medical)",
  moduleKey: "healthcare",
  medical: true,
  startMood: 50,
  intro: "Sam W. (an invented caller) phones to book a routine appointment for his father. While he talks he mentions that his father has chest pain right now.",
  record: { title: "Customer record", rows: [{ label: "Caller", value: "Sam W. (invented)" }, { label: "For", value: "His father (invented)" }, { label: "Request", value: "Routine appointment next week" }, { label: "Client rule", value: "Emergency: call emergency services, alert your lead, note the time" }] },
  steps: [
    caller("s1", "accuracy", "Hi, I would like to book an appointment for my dad next week. He is sitting here and says his chest feels tight and his arm hurts a bit, but he says it is nothing.", ["fair", "bad", "best"], {
      best: { text: "Thank you for telling me, Sam. Chest and arm pain can be an emergency. Please call emergency services now and stay with him. I am alerting my lead while you call.", mood: 10, reply: "Okay. Okay, I will call right now.", why: "A possible emergency comes before any booking. Be clear, calm and direct." },
      fair: { text: "Let us book the appointment first, and then you can call his doctor.", mood: 0, reply: "Alright, thanks.", why: "Booking first delays help." },
      bad: { text: "If he says it is nothing, I can book Thursday.", mood: 0, reply: "Great, Thursday works.", why: "Judging the symptom for the caller is exactly what you must never do." },
    }),
    caller("s2", "accuracy", "He does not want a fuss. Should I wait and see if it gets worse?", ["bad", "best", "fair"], {
      best: { text: "Please do not wait. I cannot judge how serious it is, and that is why it needs emergency help now. Call emergency services, please.", mood: 10, reply: "You are right. I am calling now.", why: "Firm, kind and clear. Never advise waiting." },
      fair: { text: "It is your decision, but seeing a doctor is a good idea.", mood: 0, reply: "Maybe later, then.", why: "Leaving the choice open can cost minutes that matter." },
      bad: { text: "Okay, we will book him in and see how he is.", mood: -10, reply: "Alright, thanks.", why: "It treats a possible emergency as a routine request." },
    }),
    caller("s3", "listening", "I am scared. What if something happens to him?", ["best", "fair", "bad"], {
      best: { text: "That is frightening, and you are doing the right thing by acting now. Stay with him and follow what the emergency operator tells you.", mood: 15, reply: "Thank you. I am going to call now.", why: "It names the fear, affirms the action and points to the right help." },
      fair: { text: "Try not to worry.", mood: 0, reply: "How can I not worry?", why: "It dismisses a very real fear." },
      bad: { text: "I need to finish this booking first.", mood: -25, reply: "What? My dad is ill!", why: "Paperwork must never come before a person's safety." },
    }),
    caller("s4", "resolution", "(The caller hangs up to phone for help.) What do you do next?", ["fair", "best", "bad"], {
      best: { text: "Alert my lead right away using the client's emergency steps, and note the time and exactly what was said.", mood: 0, reply: "Your lead has been alerted.", why: "The client's emergency steps and a record come first. You do not wait to see." },
      fair: { text: "Wait a few minutes in case the caller phones back.", mood: 0, reply: "Time has passed.", why: "Waiting wastes time your lead needs to start the steps." },
      bad: { text: "Mark the appointment request as done and take the next call.", mood: 0, reply: "The request is closed.", why: "A possible emergency is never closed as routine." },
    }),
    note("Call note: possible emergency", ["bad", "fair", "best"], {
      best: { text: "Caller Sam W. mentioned his father had chest tightness and arm pain now. Told him to call emergency services and stay with his father. Lead alerted at the time of the call. No advice given on the symptoms.", mood: 0, reply: "Note saved.", why: "It records what was said, what you told him, the time and that your lead was alerted." },
      fair: { text: "Caller said his dad was ill. Told him to get help.", mood: 0, reply: "Note saved.", why: "It lacks the time, the exact words and the lead alert." },
      bad: { text: "Routine booking request, caller hung up.", mood: 0, reply: "Note saved.", why: "It leaves out the emergency entirely." },
    }),
  ],
};

export const customerServiceCalls: CallSeed[] = [missedUpdate, thirdCall, supervisorTrap, resultsWorry, urgentSymptom];
