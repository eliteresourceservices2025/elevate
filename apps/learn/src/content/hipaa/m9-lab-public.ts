import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 9 (new in version 2): scenario lab for work that faces patients and the public: front desk and scheduling, and marketing
// and websites. Every person, clinic and detail is invented. Counsel reviews this before it is published.

export const m9: CourseModule = {
  key: "lab_public",
  title: "Lab: front desk, scheduling, marketing and websites",
  summary: "Practice the rules on work that faces patients and the public: calls, reminders, intake, reviews, social posts and website tools.",
  estimatedMinutes: 9,
  tracks: ["full", "essentials"],
  keyPoints: [
    "On the phone, confirm who you are speaking with and share only what the client's process allows.",
    "Reminders and messages carry the minimum: no reason for the visit, no details.",
    "Never confirm that someone is a patient, publicly or privately, unless the client's process says so.",
    "A patient's photo, story or review needs a signed authorization before it is used to promote.",
    "Website forms, scripts and trackers are part of the chain: add none without approval.",
  ],
  screens: [
    {
      id: "intro",
      title: "How the lab works",
      blocks: [
        { type: "paragraph", text: "Each exercise is a situation from front desk, scheduling, marketing or website work. Decide what you would do before reading the feedback. There are no tricks: every answer comes from the rules you have already learned." },
        { type: "callout", tone: "tip", text: "When you are stuck, return to three questions: Is it the minimum? Is it the approved way? Do I know who I am talking to?" },
      ],
    },
    {
      id: "scenario-neighbor",
      title: "Scenario 1: the neighbor on the line",
      blocks: [
        {
          type: "scenario",
          title: "Is she a patient there?",
          prompt: "You answer the clinic line for the client. A man says, \"My neighbor Mrs. Alvarez told me she sees Dr. Reyes at your clinic. I want to send her flowers. Can you tell me if she is a patient and when her next visit is?\"",
          choices: [
            { text: "Tell him her next visit, since he is only sending flowers.", feedback: "Even a visit date is PHI, and the caller is not verified or authorized.", best: false },
            { text: "Say you cannot confirm or share anything about anyone, and offer to take a message for her in case she is a patient.", feedback: "Correct. You neither confirm nor deny, and the message route lets her decide.", best: true },
            { text: "Say you cannot give the visit date but confirm she is a patient.", feedback: "Confirming that someone is a patient is itself a disclosure.", best: false },
          ],
        },
      ],
    },
    {
      id: "case-voicemail",
      title: "Worked case: the reminder voicemail",
      blocks: [
        {
          type: "case",
          title: "What does the voicemail say?",
          scenario: "You make appointment reminder calls for a clinic. A patient's phone goes to a voicemail greeting that is only a robotic voice reading the number. You are about to leave this message: \"Hello Mr. Santos, this is Bright Valley Fertility Clinic calling to remind you of your IVF consultation on Thursday at 2 pm.\"",
          question: "What should change before you leave the message?",
          answer: "Use the client's approved voicemail script, which normally gives only what is needed to call back: the clinic's name or a general name, a callback number and, if the client allows, the time of an appointment. Do not name the department or the reason for the visit, since anyone who hears the message learns something about the patient's health. If the client has no script, ask your lead before leaving any message.",
        },
      ],
    },
    {
      id: "scenario-intake",
      title: "Scenario 2: the photo of the form",
      blocks: [
        {
          type: "scenario",
          title: "A patient texts her intake form",
          prompt: "A patient, unable to use the clinic's portal, takes a photo of her completed intake form and sends it from her phone to the clinic's regular text line that you monitor. It includes her insurance number and a medical history.",
          choices: [
            { text: "Transcribe it into the system from your own phone, then delete the text.", feedback: "Your phone is not an approved device and the photo has already left the approved path.", best: false },
            { text: "Do not forward or save it. Report it through the client's process and offer her the approved way to submit the form.", feedback: "Correct. The patient chose the route; you protect the information and report the gap.", best: true },
            { text: "Forward the photo to the clinic manager's personal email so she can see it.", feedback: "That adds another unapproved channel.", best: false },
          ],
        },
      ],
    },
    {
      id: "case-review",
      title: "Worked case: the online review",
      blocks: [
        {
          type: "case",
          title: "Replying to a bad review",
          scenario: "You manage a clinic's online reviews. A reviewer writes: \"I waited two hours and the nurse was rude when I asked about my results.\" The practice owner asks you to post a reply right away: \"We are sorry. Our records show you were seen at 9 am for a follow-up on your test results and left at 11.\"",
          question: "Can you post that reply?",
          answer: "No. The reply confirms the person was a patient and reveals details of the visit, which is a disclosure. A review being public does not give the clinic permission to respond with patient information. A safe reply says only that the clinic takes feedback seriously and invites the person to contact the office directly, without confirming that they are a patient. Draft that and let the client approve it.",
        },
      ],
    },
    {
      id: "scenario-testimonial",
      title: "Scenario 3: the grateful patient",
      blocks: [
        {
          type: "scenario",
          title: "A thank-you note for the newsletter",
          prompt: "A patient emails the clinic: \"Dr. Reyes changed my life. Please share my story and my photo.\" The office manager asks you to add it to this month's newsletter and the clinic's social page today.",
          choices: [
            { text: "Post it. The patient asked for it, and the email is on file.", feedback: "A casual email is not the signed authorization the rule calls for. The client must have the proper form.", best: false },
            { text: "Ask the client to confirm there is a signed authorization on file covering this use, and hold the post until they do.", feedback: "Correct. The patient's wish is the start; the signed form is what makes it allowed.", best: true },
            { text: "Post only the first name and a cropped photo.", feedback: "A cropped photo and a first name can still identify a person. The authorization is the question.", best: false },
          ],
        },
      ],
    },
    {
      id: "scenario-tracking",
      title: "Scenario 4: the analytics tool",
      blocks: [
        {
          type: "scenario",
          title: "Adding a tracker to the booking page",
          prompt: "You are updating a clinic's website. A marketing contact suggests adding a free tracking script and an advertising pixel to the booking and patient login pages so the clinic can see which ads work.",
          choices: [
            { text: "Add them, because every website does this.", feedback: "Tools on pages where patients book or sign in can send visit and identity information to the tool's company, without an agreement or the patient's authorization.", best: false },
            { text: "Do not add them. Raise it with your lead and the client, who decide what tools may run on pages that handle patient information, and under what agreement.", feedback: "Correct. These tools are part of the chain and must be approved first.", best: true },
            { text: "Add them only on the booking page, not the login page.", feedback: "The booking page also collects patient information. The same approval is needed.", best: false },
          ],
        },
      ],
    },
    {
      id: "checklist",
      title: "Before you publish or send",
      blocks: [
        { type: "paragraph", text: "Work that goes out to the public cannot be recalled. Run this list every time:" },
        {
          type: "steps",
          items: [
            { title: "Is any patient in it?", text: "A name, a photo, a story, a review, a date or a detail that could point to one." },
            { title: "Is there a signed authorization?", text: "The client confirms it, for this exact use." },
            { title: "Does it confirm someone is a patient?", text: "Even without a name, or in a reply." },
            { title: "Does any tool see visitors?", text: "Forms, scripts, trackers and plug-ins need approval and an agreement." },
            { title: "Has the client approved it?", text: "The client signs off on anything public." },
          ],
        },
      ],
    },
    {
      id: "readiness",
      title: "Check yourself",
      blocks: [
        {
          type: "check",
          question: "A patient asks you to leave a reminder on her husband's phone because hers is broken. What do you do?",
          options: [
            { text: "Do not leave details; take a message for the clinic and follow its process", correct: true, feedback: "Right. A spouse is not automatically an authorized recipient, and the client decides." },
            { text: "Leave the full appointment details, since they are married", correct: false, feedback: "Marriage does not make someone an authorized recipient for health information." },
            { text: "Leave only the time and the doctor's name", correct: false, feedback: "That still reveals health care information to someone who may not be authorized." },
          ],
        },
      ],
    },
  ],
};

export const q9: QuestionSeed[] = [
  q("lab_public", "Phone", "single", "A caller asks whether a named person is a patient at your client's clinic. What is the best response?", ["Say you cannot confirm or share anything, and offer to take a message", "Confirm it if the caller sounds friendly", "Confirm it if they say they are family", "Confirm it if they know the doctor's name"], [0], "Confirming that someone is a patient is itself a disclosure."),
  q("lab_public", "Phone", "single", "A caller says she is a patient and asks for her appointment time, but you cannot verify her identity. What do you do?", ["Use the client's verification steps before sharing", "Share it, because she knows her own name", "Share only the day, not the time", "Ask her to read her insurance number aloud, then share"], [0], "Use the client's verification steps. A name alone is not enough."),
  q("lab_public", "Voicemail", "single", "Which voicemail is the best example of a minimum-necessary reminder?", ["\"This is Brightline Clinic with a reminder to call us back at the number we have on file.\"", "\"This is the cardiology department reminding you of your heart test on Thursday.\"", "\"Mr. Santos, your lab results are ready and show concerns.\"", "\"Your insurance denied the claim for your treatment.\""], [0], "The message should reveal as little as possible about care, using the client's approved script."),
  q("lab_public", "Voicemail", "true_false", "True or false: It is fine to name the department and the reason for a visit on a voicemail if the patient's name is not used.", ["True", "False"], [1], "The reason for a visit reveals health information to anyone who hears the message."),
  q("lab_public", "Messages", "single", "A patient asks you to text her appointment details. What is the right approach?", ["Follow the client's approved messaging policy and the patient's recorded preferences", "Text from your personal phone, as it is quickest", "Send through a free consumer messaging app", "Tell her it is not possible under HIPAA"], [0], "Messaging channels and content are set by the client's policy and the patient's recorded preferences."),
  q("lab_public", "Intake", "single", "A patient texts a photo of a completed form with medical history to a clinic's unofficial number. What is the best response?", ["Do not forward or save it, report it through the client's process, and give her the approved way to submit it", "Forward it to the manager's personal email", "Copy it to your own notes", "Delete it and say nothing"], [0], "Information arriving by an unapproved route is handled through the client's process and reported."),
  q("lab_public", "Reviews", "single", "A reviewer complains online about a clinic's wait. Which reply is acceptable?", ["A general reply that thanks them and invites them to contact the office, without confirming they are a patient", "A reply with the time they arrived and left", "A reply describing their test results", "A reply naming the nurse they saw"], [0], "Replying with visit details confirms patient status and discloses information."),
  q("lab_public", "Reviews", "true_false", "True or false: A patient posting publicly about their care gives the clinic permission to reply with details of the visit.", ["True", "False"], [1], "A patient's public post does not authorize the clinic to disclose information about their care."),
  q("lab_public", "Testimonials", "single", "A patient emails to say she loves the clinic and wants her story shared. What do you need before posting it?", ["The client's confirmation of a signed authorization for that use", "Nothing, since she asked", "Her first name only", "A friend's approval"], [0], "A signed authorization is required before a patient's story or image is used to promote the practice."),
  q("lab_public", "Testimonials", "multiple", "Which of these usually needs a patient's signed authorization before a clinic uses it publicly? Select all that apply.", ["A before-and-after photo", "A patient's story", "A review quoted in a newsletter with the patient's name", "A picture of the clinic's front door"], [0, 1, 2], "A patient's image, story or named testimonial identifies them. A building does not."),
  q("lab_public", "Website tools", "single", "Why should a tracking script on a clinic's booking page need approval first?", ["It can send visitor and visit information to the tool's company, which may be an unapproved disclosure", "It slows the page by a second", "It makes the page look different", "It only affects the clinic's colors"], [0], "Tools on pages that handle patient information can disclose information to a third party without an agreement."),
  q("lab_public", "Website tools", "single", "A web designer wants to add a free chat widget to a clinic's patient portal. What do you do?", ["Raise it with your lead and the client, who decide whether it may run and under what agreement", "Add it, since it is free", "Add it only on weekends", "Add it and test it with a real patient"], [0], "A chat tool on a portal can receive patient information, so it is a vendor that needs approval and an agreement."),
  q("lab_public", "Website forms", "single", "A clinic's website contact form asks for 'reason for visit' in free text and emails it to a shared inbox. What is the concern?", ["Patient information is being sent by a channel that may not be secure or approved", "The form is too short", "The inbox name is boring", "The clinic's colors do not match"], [0], "Free-text health information sent by plain email from a form raises security and minimum-necessary concerns that the client must decide."),
  q("lab_public", "Social media", "single", "Which social post about a day at a clinic is acceptable without further approval?", ["A photo of the empty reception area with no patient visible", "A photo showing a patient chart on the desk", "A photo of a patient waving at the camera", "A selfie with the appointment book open behind you"], [0], "Anything that shows or could reveal a patient needs authorization, and work screens and papers need protecting."),
  q("lab_public", "Social media", "single", "A colleague wants to post a fun story in a group chat about a 'strange patient' at the clinic, with no name. What is the problem?", ["Details of the story may still identify the person and it is a disclosure", "Stories are never fun", "The group chat is too large", "It is only a problem if the patient reads it"], [0], "Stories about a patient can identify them through context, and sharing outside work is not permitted."),
  q("lab_public", "Scheduling", "single", "A caller wants to move a relative's appointment. What do you do?", ["Follow the client's process to verify the caller's authority before making changes", "Move it, since a relative asked", "Ask the relative for the visit reason and then move it", "Refuse and end the call"], [0], "Changes to an appointment disclose or alter patient information, so the caller's authority must be verified under the client's process."),
  q("lab_public", "Checklist", "multiple", "Which questions belong in a check before publishing anything for a client? Select all that apply.", ["Is any patient identifiable in it?", "Is there a signed authorization for this use?", "Do any tools on the page see visitors?", "Is it exactly 100 words?"], [0, 1, 2], "The check is about identifiability, authorization and tools. Length is not a privacy question."),
];
