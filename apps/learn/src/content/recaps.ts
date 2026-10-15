// Optional recap videos: one short motion-graphics recap per module (60 to 90 seconds, a voice-over with the same words as captions
// on screen, and quiet background music). Shown at the top of a module in the player; reading stays the required part. The storyboards below are DATA, the single source for the video (the
// renderer reads them) and for the transcript the player shows beside it. Every line restates the module's approved lesson text:
// no new facts, no legal claims that are not in the lessons. Lint: content.test.ts.

import durations from "./recap-durations.json";

export type RecapScene =
  | { kind: "statement"; text: string }
  | { kind: "list"; heading: string; items: string[] }
  | { kind: "steps"; heading: string; items: { title: string; text: string }[] }
  | { kind: "layers"; heading: string; items: { label: string; text: string }[] }
  | { kind: "compare"; heading: string; left: { title: string; items: string[] }; right: { title: string; items: string[] }; neutral?: boolean }
  | { kind: "timeline"; heading: string; items: { when: string; text: string }[] };

export type Recap = {
  course: "hipaa" | "cybersecurity";
  module: string;
  /** The words a person sees and hears, in order. The scenes are the captions, and the voice reads the same words. */
  scenes: RecapScene[];
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** All the text of a scene, in reading order. */
export function sceneLines(s: RecapScene): string[] {
  switch (s.kind) {
    case "statement":
      return [s.text];
    case "list":
      return [s.heading, ...s.items];
    case "steps":
      return [s.heading, ...s.items.map((i) => `${i.title}: ${i.text}`)];
    case "layers":
      return [s.heading, ...s.items.map((i) => `${i.label}: ${i.text}`)];
    case "compare":
      return [s.heading, s.left.title, ...s.left.items, s.right.title, ...s.right.items];
    case "timeline":
      return [s.heading, ...s.items.map((i) => `${i.when}: ${i.text}`)];
  }
}

export const INTRO_SECONDS = 4;
export const OUTRO_SECONDS = 4;

/** How long a scene stays on screen: enough to read it comfortably, never less than 5 or more than 14 seconds. */
export function sceneSeconds(s: RecapScene): number {
  const w = sceneLines(s).reduce((n, l) => n + words(l), 0);
  return Math.min(14, Math.max(5, Math.round((3.5 + w * 0.42) * 10) / 10));
}

/** The silent length, estimated from reading time. The rendered video is longer because the voice sets the pace. */
export function silentSeconds(r: Recap): number {
  return Math.round(INTRO_SECONDS + OUTRO_SECONDS + r.scenes.reduce((n, s) => n + sceneSeconds(s), 0));
}

/** The length of the rendered video: written by the renderer into recap-durations.json, and the silent estimate until then. */
export function recapSeconds(r: Recap): number {
  return (durations as Record<string, number>)[`${r.course}-${r.module}`] ?? silentSeconds(r);
}

/** The plain-text transcript shown beside the video (the same words as the captions). */
export function recapTranscript(r: Recap): string[] {
  return r.scenes.flatMap((s) => {
    const l = sceneLines(s);
    return s.kind === "statement" ? [l[0]] : [`${l[0]}: ${l.slice(1).join("; ")}`];
  });
}

export const RECAPS: Recap[] = [
  // ---------------------------------------------------------------- HIPAA
  {
    course: "hipaa",
    module: "foundations",
    scenes: [
      { kind: "statement", text: "HIPAA exists so people can trust that their health information is used for their care, and for nothing else." },
      {
        kind: "layers",
        heading: "Three rules to know",
        items: [
          { label: "Privacy Rule", text: "who may use or share information, and why" },
          { label: "Security Rule", text: "how electronic information is kept safe" },
          { label: "Breach Notification Rule", text: "what happens when it is exposed" },
        ],
      },
      {
        kind: "steps",
        heading: "The chain of trust",
        items: [
          { title: "Clinic", text: "holds the information" },
          { title: "ERS", text: "bound by an agreement" },
          { title: "Anyone ERS uses", text: "bound by the same promise" },
          { title: "You", text: "the last link" },
        ],
      },
      { kind: "statement", text: "Access is not permission. Use information only for the task you were given." },
      { kind: "statement", text: "Not sure? Stop. Do not share. Ask your lead." },
    ],
  },
  {
    course: "hipaa",
    module: "phi",
    scenes: [
      { kind: "statement", text: "PHI is health information that identifies a person, in any form." },
      {
        kind: "list",
        heading: "Three things come together",
        items: ["It is about a person", "It is about their health, their care or payment for it", "It identifies them, or could"],
      },
      {
        kind: "list",
        heading: "A name is only one of eighteen identifiers",
        items: ["Phone and fax numbers", "Email addresses", "Dates tied to the person", "Account and record numbers", "Photos, IP addresses and more"],
      },
      {
        kind: "compare",
        heading: "De-identified, or not?",
        left: { title: "Counts", items: ["Safe Harbor: all 18 removed", "Expert Determination: a documented expert finding"] },
        right: { title: "Does not count", items: ["Taking the name out", "Using initials"] },
      },
      {
        kind: "list",
        heading: "PHI is not only in the chart",
        items: ["Screenshots", "File names and email subject lines", "Paper and sticky notes", "Voicemail and spoken details"],
      },
    ],
  },
  {
    course: "hipaa",
    module: "privacy",
    scenes: [
      { kind: "statement", text: "Your job is to use information only for the task, and share it only the approved way." },
      {
        kind: "layers",
        heading: "Three groups of reasons",
        items: [
          { label: "Always allowed", text: "to the patient, and to HHS" },
          { label: "Allowed without a form", text: "treatment, payment, operations, and a short legal list" },
          { label: "Needs written authorization", text: "almost everything else, like marketing" },
        ],
      },
      {
        kind: "compare",
        heading: "Minimum necessary",
        left: { title: "Right", items: ["The invoice number and amount", "Only the dates needed"] },
        right: { title: "Too much", items: ["The full chart for a billing question", "The whole patient list"] },
      },
      {
        kind: "steps",
        heading: "The ERS 5-point send check",
        items: [
          { title: "Who", text: "the right, authorized person?" },
          { title: "What", text: "only the minimum?" },
          { title: "Why", text: "a task-related reason?" },
          { title: "Where", text: "the approved destination?" },
          { title: "How", text: "an approved, secure method?" },
        ],
      },
    ],
  },
  {
    course: "hipaa",
    module: "rights",
    scenes: [
      { kind: "statement", text: "Patients have rights over their own information. The clinic, your client, handles each one." },
      {
        kind: "list",
        heading: "The rights",
        items: ["See and copy their records", "Ask for a correction", "Get a list of certain disclosures", "Limit sharing or choose how they are contacted", "Complain, without retaliation"],
      },
      {
        kind: "timeline",
        heading: "Deadlines the clinic works to",
        items: [
          { when: "Access", text: "30 days, with one 30-day extension" },
          { when: "Amendment", text: "60 days, with one 30-day extension" },
          { when: "Accounting", text: "60 days, covering six years back" },
        ],
      },
      { kind: "statement", text: "A relative is not automatically a personal representative. The client's records decide." },
      {
        kind: "steps",
        heading: "When a patient asks",
        items: [
          { title: "Listen", text: "and be kind" },
          { title: "Take down", text: "only the request" },
          { title: "Do not act", text: "no records sent, no promises" },
          { title: "Pass it on", text: "the same day, the client's way" },
        ],
      },
    ],
  },
  {
    course: "hipaa",
    module: "associates",
    scenes: [
      { kind: "statement", text: "A business associate does work for a clinic that involves patient information. ERS is one." },
      { kind: "statement", text: "No agreement, no information. A written business associate agreement comes first." },
      {
        kind: "list",
        heading: "What the agreement requires",
        items: ["Use information only as the contract allows", "Safeguards, and the Security Rule for electronic data", "Report breaches and other misuse", "Bind subcontractors to the same limits", "Return or destroy information at the end"],
      },
      { kind: "statement", text: "Since 2009, business associates answer directly to the government, not only to their clients." },
      { kind: "statement", text: "Tell the client about a breach without unreasonable delay, and within 60 days at most. Contracts are often shorter." },
      { kind: "statement", text: "A free or convenient tool is not an approved tool. Ask first." },
    ],
  },
  {
    course: "hipaa",
    module: "security",
    scenes: [
      { kind: "statement", text: "The Security Rule keeps electronic patient information confidential, accurate, and available." },
      {
        kind: "layers",
        heading: "Three kinds of safeguards",
        items: [
          { label: "Technical", text: "unique logins, encryption, activity logs" },
          { label: "Physical", text: "rooms, workstations and devices" },
          { label: "Administrative", text: "policies, training, risk analysis" },
        ],
      },
      {
        kind: "list",
        heading: "Your part",
        items: ["Your own login, never shared", "A second sign-in step every time", "Lock your screen, even at home", "Approved systems only, no extra copies"],
      },
      { kind: "statement", text: "A lost or stolen device is an incident from the moment you notice. Report it immediately." },
    ],
  },
  {
    course: "hipaa",
    module: "incidents",
    scenes: [
      { kind: "statement", text: "An incident is anything that may have exposed patient information. If you wonder, report it." },
      {
        kind: "compare",
        heading: "Incident and breach",
        neutral: true,
        left: { title: "Incident", items: ["May have exposed information", "Reported by anyone, the same day"] },
        right: { title: "Breach", items: ["An impermissible use or disclosure that compromises PHI", "Decided by the client and ERS"] },
      },
      {
        kind: "timeline",
        heading: "After a breach is found",
        items: [
          { when: "Day 0", text: "anyone in the workforce knows; the clock starts" },
          { when: "Right away", text: "ERS tells the client" },
          { when: "Within 60 days", text: "the client tells affected people" },
        ],
      },
      {
        kind: "steps",
        heading: "What you do",
        items: [
          { title: "Stop", text: "do not undo it yourself" },
          { title: "Tell", text: "your lead and HR now" },
          { title: "Describe", text: "facts, no patient details" },
          { title: "Preserve", text: "delete nothing" },
        ],
      },
      { kind: "statement", text: "Good-faith reporting is protected." },
    ],
  },
  {
    course: "hipaa",
    module: "enforcement",
    scenes: [
      {
        kind: "list",
        heading: "Who enforces HIPAA",
        items: ["HHS Office for Civil Rights: civil cases", "Department of Justice: criminal cases", "State attorneys general", "Your client and ERS: contracts and sanctions"],
      },
      {
        kind: "layers",
        heading: "Four civil penalty tiers",
        items: [
          { label: "Did not know", text: "could not have known with reasonable diligence" },
          { label: "Reasonable cause", text: "should have known, not willful" },
          { label: "Willful neglect, corrected", text: "fixed within 30 days" },
          { label: "Willful neglect, not corrected", text: "the most serious tier" },
        ],
      },
      {
        kind: "timeline",
        heading: "Criminal penalties, by intent",
        items: [
          { when: "Up to 1 year", text: "knowingly obtaining or disclosing" },
          { when: "Up to 5 years", text: "under false pretenses" },
          { when: "Up to 10 years", text: "for gain or malicious harm" },
        ],
      },
      { kind: "statement", text: "Real cases usually start with ordinary failures: no risk analysis, an unprotected device, an unapproved vendor." },
    ],
  },
  {
    course: "hipaa",
    module: "lab_public",
    scenes: [
      { kind: "statement", text: "On the phone, never confirm that someone is a patient. Offer to take a message." },
      { kind: "statement", text: "A public review does not let the clinic reply with details. Never confirm the person was a patient." },
      { kind: "statement", text: "Tools on booking and login pages can send visit information to a vendor. They need approval and an agreement first." },
      {
        kind: "steps",
        heading: "Before you publish or send",
        items: [
          { title: "Any patient in it?", text: "name, photo, story, date" },
          { title: "Signed authorization?", text: "for this exact use" },
          { title: "Confirms someone is a patient?", text: "even without a name" },
          { title: "Any tool sees visitors?", text: "needs approval" },
          { title: "Client approved?", text: "before it goes public" },
        ],
      },
    ],
  },
  {
    course: "hipaa",
    module: "lab_records",
    scenes: [
      { kind: "statement", text: "Billing and collections are allowed, but only the minimum information each step needs." },
      { kind: "statement", text: "A collection agency is a business associate. It needs an agreement before any information is sent." },
      { kind: "statement", text: "Confirm a fax number from a reliable source before you send. A wrong number reaches a stranger." },
      {
        kind: "compare",
        heading: "Exports and copies",
        left: { title: "Do", items: ["Export only the columns needed", "Use the approved channel", "Remove working copies as instructed"] },
        right: { title: "Do not", items: ["Export every field to save time", "Keep copies in a personal folder"] },
      },
      {
        kind: "steps",
        heading: "Before you send, share or export",
        items: [
          { title: "Recipient", text: "who exactly?" },
          { title: "Destination", text: "confirmed?" },
          { title: "Content", text: "only what the step needs" },
          { title: "Channel", text: "approved" },
          { title: "Copies", text: "none kept" },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Cybersecurity
  {
    course: "cybersecurity",
    module: "why",
    scenes: [
      { kind: "statement", text: "Attackers go after people, because it is easier than breaking in by force." },
      {
        kind: "list",
        heading: "What attackers want",
        items: ["Money", "Information", "Access to your accounts", "To disrupt work"],
      },
      {
        kind: "layers",
        heading: "Why healthcare is a target",
        items: [
          { label: "Urgency", text: "care cannot wait" },
          { label: "Rich records", text: "identity, insurance and medical details" },
          { label: "Many connections", text: "clinics, labs, billers and vendors" },
          { label: "Busy people", text: "who click fast" },
        ],
      },
      {
        kind: "list",
        heading: "Four habits stop most attacks",
        items: ["Spot phishing", "Use strong passwords", "Turn on a second sign-in step", "Install updates"],
      },
      { kind: "statement", text: "Mistakes are normal. Hiding them is what makes them expensive. Speed matters, blame does not." },
    ],
  },
  {
    course: "cybersecurity",
    module: "passwords",
    scenes: [
      { kind: "statement", text: "A long passphrase beats a short, complicated password." },
      {
        kind: "list",
        heading: "Good password habits",
        items: ["A different password for every account", "A password manager to keep them", "Never share a password or a code"],
      },
      {
        kind: "compare",
        heading: "The second sign-in step",
        left: { title: "Stronger", items: ["A passkey or security key", "An authenticator app"] },
        right: { title: "Weaker", items: ["A text message code", "A simple tap to approve"] },
      },
      { kind: "statement", text: "An approval request you did not start means someone has your password. Deny it and report it." },
      { kind: "statement", text: "No real support person asks for your password or a code." },
      { kind: "statement", text: "One person, one account. Shared logins break accountability." },
    ],
  },
  {
    course: "cybersecurity",
    module: "phishing",
    scenes: [
      { kind: "statement", text: "Phishing targets people, not only computers. The usual tricks are urgency, fear and authority." },
      {
        kind: "list",
        heading: "Check before you act",
        items: ["The sender", "The link: where it really goes", "Whether you expected it", "A known channel to verify"],
      },
      {
        kind: "list",
        heading: "Lures that fit healthcare work",
        items: ["A payer with a held claim", "A patient with an attachment", "A manager changing bank details", "IT asking for a password"],
      },
      { kind: "statement", text: "Requests to move money or change payment details are checked by phone, on a number you already know." },
      { kind: "statement", text: "Unexpected \"tech support\" calls are scams. Hang up, and never give remote access." },
      { kind: "statement", text: "If you clicked or answered, report it immediately. Speed limits the damage." },
    ],
  },
  {
    course: "cybersecurity",
    module: "malware",
    scenes: [
      { kind: "statement", text: "Malware is software that works against you. It usually arrives through a message, a download or an unpatched hole." },
      {
        kind: "timeline",
        heading: "A ransomware attack",
        items: [
          { when: "Day 0", text: "a file is opened and the attacker gets in" },
          { when: "Hours or days", text: "they look around, and may copy information" },
          { when: "A quiet hour", text: "files are locked and a demand appears" },
          { when: "Next morning", text: "staff cannot reach records" },
        ],
      },
      { kind: "statement", text: "Updates close holes attackers already know about. Install them promptly." },
      { kind: "statement", text: "Backups kept apart from the computer are what let you recover without paying." },
      { kind: "statement", text: "If a device is hit, disconnect it from the network without powering it off, and report it right away." },
    ],
  },
  {
    course: "cybersecurity",
    module: "browsing",
    scenes: [
      { kind: "statement", text: "Check where a link really goes. A padlock means a private connection, not an honest site." },
      {
        kind: "list",
        heading: "Safer habits",
        items: ["Download only from approved sources", "Be wary of free tools and extensions", "Keep work and personal accounts apart", "Keep work details off social media"],
      },
      { kind: "statement", text: "Do not paste work, client or personal information into public AI tools." },
      {
        kind: "list",
        heading: "Patient information travels by",
        items: ["Email", "Text message", "Fax", "Voicemail"],
      },
      { kind: "statement", text: "Use only the channels your client approved for each." },
      { kind: "statement", text: "What you post online can be used to trick you or your colleagues. Keep work details off social media." },
    ],
  },
  {
    course: "cybersecurity",
    module: "ai_tools",
    scenes: [
      { kind: "statement", text: "Anything you type or upload into an AI tool leaves your control and goes to the company that runs it." },
      {
        kind: "list",
        heading: "Treat all of these as AI tools",
        items: ["Chatbots and writing assistants", "Transcription and meeting summaries", "Translators and rewriting tools", "Built-in assistants in office apps"],
      },
      {
        kind: "compare",
        heading: "Approved or not",
        left: { title: "Approved", items: ["Named by your client", "Approved by ERS in writing"] },
        right: { title: "Not approved", items: ["A free account you made", "An extension you found", "A coworker's tip"] },
      },
      { kind: "statement", text: "Taking the name out is not enough. Dates, conditions and places can still identify a person." },
      { kind: "statement", text: "In doubt? Ask your lead for the approved way." },
    ],
  },
  {
    course: "cybersecurity",
    module: "devices",
    scenes: [
      {
        kind: "steps",
        heading: "Your remote setup",
        items: [
          { title: "Place", text: "private, no one overhears" },
          { title: "Device", text: "approved, updated, locked, encrypted" },
          { title: "Network", text: "strong router password, WPA2 or WPA3" },
          { title: "Sign-in", text: "your own login with a second step" },
        ],
      },
      { kind: "statement", text: "Do not work on public Wi-Fi unless your client gives you a secure connection for it." },
      { kind: "statement", text: "Use only approved devices for work, and keep them to yourself. A family computer is not a work computer." },
      { kind: "statement", text: "Do not photograph or screenshot client information on a personal phone." },
      { kind: "statement", text: "A lost or stolen device is an emergency. Tell your lead immediately." },
    ],
  },
  {
    course: "cybersecurity",
    module: "physical",
    scenes: [
      { kind: "statement", text: "Treat client and personal information as sensitive by default." },
      { kind: "statement", text: "Share with the people who need it, through the approved way, and no more." },
      {
        kind: "list",
        heading: "Leaks do not only happen on screens",
        items: ["Paper on the desk", "Screens others can see", "Conversations others can hear", "People you do not know following you in"],
      },
      {
        kind: "steps",
        heading: "Keep only what you need",
        items: [
          { title: "Do the task", text: "in the client's system" },
          { title: "Do not copy", text: "no extra files or printouts" },
          { title: "Clear up", text: "remove working copies" },
          { title: "Destroy properly", text: "shred, not the bin" },
        ],
      },
      { kind: "statement", text: "Do not hold a door for someone you do not know, and do not leave anything unattended." },
    ],
  },
  {
    course: "cybersecurity",
    module: "response",
    scenes: [
      {
        kind: "list",
        heading: "Signs that something is wrong",
        items: ["Prompts you did not start", "Locked or missing files", "Messages sent from your account", "Odd pop-ups"],
      },
      {
        kind: "timeline",
        heading: "The first hour",
        items: [
          { when: "Minute 0", text: "stop what you are doing" },
          { when: "Within minutes", text: "tell your lead and HR" },
          { when: "Within the hour", text: "write the facts and keep evidence" },
          { when: "As instructed", text: "change passwords or isolate the device" },
        ],
      },
      {
        kind: "compare",
        heading: "What a good report holds",
        left: { title: "Useful", items: ["What happened, and when", "Which system", "What you have done so far"] },
        right: { title: "Unhelpful", items: ["\"Something went wrong\"", "Guesses about blame", "Patient names"] },
      },
      { kind: "statement", text: "Do not fix it quietly, delete evidence or reply to the attacker." },
      { kind: "statement", text: "Late reporting is better than none. Nobody is punished for reporting in good faith." },
    ],
  },
  {
    course: "cybersecurity",
    module: "security_hipaa",
    scenes: [
      { kind: "statement", text: "HIPAA's Security Rule asks for administrative, physical and technical safeguards. Your habits are all three." },
      {
        kind: "layers",
        heading: "Each habit carries out a safeguard",
        items: [
          { label: "Strong sign-in", text: "technical" },
          { label: "Spotting phishing", text: "administrative: training" },
          { label: "Locking your screen", text: "physical" },
          { label: "Reporting at once", text: "administrative: incident response" },
        ],
      },
      { kind: "statement", text: "Training is itself a requirement. A record is kept when you complete it." },
      {
        kind: "timeline",
        heading: "When a habit fails",
        items: [
          { when: "The slip", text: "a click and a password typed" },
          { when: "Soon after", text: "an attacker signs in as you" },
          { when: "When noticed", text: "the organization must assess and may notify" },
        ],
      },
      { kind: "statement", text: "Deadlines start when anyone in the workforce knows. Report fast." },
    ],
  },
];

/**
 * The first published version number whose lessons each course's recaps were written for. A person still on an older version (a
 * retired one they started) would hear words that do not match their lessons, so they get no recap. The recaps were written
 * against the deepened courses: HIPAA version 2 onward, Cybersecurity basics version 2 onward.
 */
export const RECAP_FROM_VERSION: Record<Recap["course"], number> = { hipaa: 2, cybersecurity: 2 };

/** The recap for a module. When the person's version number is known and older than the recaps were written for, there is none. */
export function findRecap(course: string, moduleKey: string, version?: number | null): Recap | null {
  const found = RECAPS.find((r) => r.course === course && r.module === moduleKey) ?? null;
  if (!found) return null;
  if (typeof version === "number" && version < RECAP_FROM_VERSION[found.course]) return null;
  return found;
}

/** The file served from the app's own origin (the content security policy allows media from `self` only). */
export const recapFile = (r: Pick<Recap, "course" | "module">) => `/recaps/${r.course}-${r.module}.mp4`;
