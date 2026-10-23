// Storyboards for the HIPAA recap videos, modules 1 to 5 (foundations, phi, privacy, rights, associates). Animated scenes with a few words
// on screen; the detail is in the narration (`say`). Every spoken line restates that module's approved lesson text: no new facts.
// Scene kinds are drawn in src/Cs.jsx and src/LearnScenes.jsx; what the voice says is read by customer-service/beats.cjs.
const { HIPAA_OUTRO } = require("./shared.cjs");

const base = (n, module, title, tagline, icon) => ({ id: `hipaa-${module}`, course: "hipaa", module, n, count: 11, title, label: `HIPAA  |  MODULE ${n} OF 11`, tagline, icon, outroItems: HIPAA_OUTRO });

module.exports = [
  {
    ...base(1, "foundations", "HIPAA foundations and your role at ERS", "Why HIPAA exists and where you sit in the chain", "shield-check"),
    scenes: [
      {
        kind: "hero",
        icon: "shield-check",
        title: "Why HIPAA exists",
        sub: "Trust in how health information is used",
        lead: "HIPAA exists so people can trust that their health information is used for their care, and for nothing else.",
      },
      {
        kind: "icons",
        heading: "Three rules to know",
        items: [
          { icon: "lock", label: "Privacy Rule", say: "The Privacy Rule: who may use or share information, and why." },
          { icon: "shield", label: "Security Rule", say: "The Security Rule: how electronic information is kept safe." },
          { icon: "siren", label: "Breach Notification", say: "The Breach Notification Rule: what happens when it is exposed." },
        ],
      },
      {
        kind: "chain",
        heading: "The chain of trust",
        items: [
          { icon: "hospital", label: "Clinic", sub: "holds the information", say: "The clinic holds the information." },
          { icon: "building", label: "ERS", sub: "bound by an agreement", say: "ERS is bound by an agreement." },
          { icon: "network", label: "Anyone ERS uses", sub: "same promise", say: "Anyone ERS uses makes the same promise." },
          { icon: "user", label: "You", sub: "the last link", say: "And you are the last link." },
        ],
      },
      {
        kind: "flow",
        heading: "Three keys that make rules work",
        items: [
          { big: "1", icon: "graduation-cap", label: "Education", sub: "know the rules and why", say: "Education: everyone knows the rules and why." },
          { big: "2", icon: "handshake", label: "Commitment", sub: "even when unwatched", say: "Commitment: everyone does their part, even when nobody is watching." },
          { big: "3", icon: "users", label: "Culture", sub: "asking feels normal", say: "Culture: asking and reporting feel normal." },
        ],
      },
      {
        kind: "compare",
        heading: "Access is not permission",
        leftGood: true,
        left: { title: "Allowed", items: [{ text: "Open a record for your task", say: "Open a record only to complete the task you were given." }] },
        right: {
          title: "Not allowed",
          items: [
            { text: "Look up someone you know", say: "Looking up a neighbor or friend is not allowed, even if the system lets you in." },
            { text: "Copy records to your phone", say: "Nor is copying records to your phone." },
          ],
        },
      },
    ],
  },
  {
    ...base(2, "phi", "PHI, ePHI and identifiers", "What counts as protected health information", "file-lock"),
    scenes: [
      {
        kind: "hero",
        icon: "file-lock",
        title: "What is PHI?",
        sub: "Health information that identifies a person",
        lead: "PHI is health information that identifies a person, in any form.",
      },
      {
        kind: "formula",
        lead: "Three parts come together.",
        items: [
          { icon: "user", label: "About a person", say: "It is about a person." },
          { icon: "heart-pulse", label: "Health, care or payment", say: "It is about their health, their care, or payment for it." },
        ],
        result: { icon: "id-card", label: "Identifies them", say: "And it identifies them." },
      },
      {
        kind: "stat",
        heading: "Identifiers and de-identifying",
        items: [
          { value: "18", unit: "identifiers", label: "a name is only one", icon: "id-card", say: "There are eighteen identifiers, and a name is only one of them." },
          { value: "2", unit: "methods", label: "to de-identify", icon: "scissors", say: "HIPAA has two ways to de-identify information, Safe Harbor and Expert Determination. Taking the name out is not one." },
        ],
      },
      {
        kind: "icons",
        heading: "PHI hides around the chart",
        items: [
          { icon: "image", label: "Screenshots", say: "A saved screenshot." },
          { icon: "file-text", label: "File names", say: "A file name with a patient's name." },
          { icon: "mail", label: "Email subjects", say: "An email subject line or calendar invite." },
          { icon: "sticky-note", label: "Sticky notes", say: "A sticky note or printed schedule." },
        ],
      },
      {
        kind: "swap",
        heading: "Before you send it on",
        items: [
          {
            bad: "Take the name out and send it on",
            good: "Ask: de-identifying is the client's call",
            badSay: "Taking the name out and sending it on as safe is not de-identifying.",
            goodSay: "De-identifying is the client's decision and process, so ask your lead.",
          },
        ],
      },
    ],
  },
  {
    ...base(3, "privacy", "The Privacy Rule: using and sharing patient information", "Only the ways the rule allows", "lock"),
    scenes: [
      {
        kind: "hero",
        icon: "lock",
        title: "The Privacy Rule",
        sub: "Using and sharing patient information",
        lead: "The Privacy Rule works like a locked door. Information may be used and shared only in the ways the rule lists.",
      },
      {
        kind: "stack",
        heading: "Three groups of reasons",
        items: [
          { icon: "pen-line", label: "Written authorization", sub: "almost everything else", say: "Almost everything else needs the patient's written authorization, including marketing and sale." },
          { icon: "circle-check", label: "Allowed without a form", sub: "treatment, payment, operations", say: "Treatment, payment and healthcare operations are allowed without a form." },
          { icon: "shield-check", label: "Always allowed", sub: "the patient, and HHS", say: "Sharing with the patient, and with HHS when it investigates, is always allowed." },
        ],
      },
      {
        kind: "compare",
        heading: "Minimum necessary",
        leftGood: true,
        left: { title: "Minimum", items: [{ text: "Invoice number and amount", say: "Minimum necessary: send the invoice number and amount." }] },
        right: { title: "Too much", items: [{ text: "Full chart for a billing question", say: "Too much is sending the full chart to answer a billing question." }] },
      },
      {
        kind: "flow",
        heading: "The ERS 5-point send check",
        lead: "Before you send anything, ask five questions. If any answer is not sure, do not send.",
        items: [
          { big: "1", icon: "user", label: "Who?", say: "Who? Is the recipient the right, authorized person?" },
          { big: "2", icon: "file-text", label: "What?", say: "What? Is it only the minimum needed?" },
          { big: "3", icon: "target", label: "Why?", say: "Why? Is there a task-related reason?" },
          { big: "4", icon: "map-pin", label: "Where?", say: "Where? Is it the approved system or address?" },
          { big: "5", icon: "send", label: "How?", say: "How? Is the method approved and secure?" },
        ],
      },
    ],
  },
  {
    ...base(4, "rights", "Patients' rights over their information", "See, correct and learn about their own information", "hand-heart"),
    scenes: [
      {
        kind: "hero",
        icon: "hand-heart",
        title: "Patients' rights",
        sub: "The record is about them",
        lead: "The information in a patient's record is about them, so the Privacy Rule gives patients rights over it.",
      },
      {
        kind: "icons",
        heading: "Rights at a glance",
        cols: 3,
        items: [
          { icon: "folder-open", label: "Access", say: "Access: see and copy their records." },
          { icon: "pen-line", label: "Amendment", say: "Amendment: ask for a correction." },
          { icon: "list-checks", label: "Accounting", say: "Accounting: a list of certain disclosures." },
          { icon: "ban", label: "Restriction", say: "Restriction: ask to limit sharing." },
          { icon: "mail", label: "Confidential contact", say: "Confidential communications: a different method or place." },
          { icon: "megaphone", label: "Complaint", say: "Complaint: to the clinic or to HHS." },
        ],
      },
      {
        kind: "stat",
        heading: "Timelines to know",
        items: [
          { value: "30", unit: "days", label: "for access", icon: "folder-open", say: "The clinic generally answers an access request within 30 days." },
          { value: "60", unit: "days", label: "for a correction", icon: "pen-line", say: "It acts on a correction request within 60 days." },
          { value: "6", unit: "years", label: "of disclosures", icon: "calendar", say: "An accounting covers the six years before the request." },
        ],
      },
      {
        kind: "flow",
        heading: "When a patient asks",
        items: [
          { big: "1", icon: "ear", label: "Listen", say: "Listen and thank them." },
          { big: "2", icon: "notebook-pen", label: "Note it", say: "Take down only the request." },
          { big: "3", icon: "hand", label: "Do not act", say: "Do not send or change records yourself." },
          { big: "4", icon: "send", label: "Pass it on", say: "Pass it on the client's way, the same day." },
          { big: "5", icon: "clock", label: "Next step", say: "Tell them what happens next." },
        ],
      },
    ],
  },
  {
    ...base(5, "associates", "Business associates and the agreements behind your work", "No agreement, no information", "handshake"),
    scenes: [
      {
        kind: "hero",
        icon: "handshake",
        title: "Business associates",
        sub: "The agreements behind your work",
        lead: "A business associate does work for a covered entity that involves patient information. ERS is one for many of its clients.",
      },
      {
        kind: "chain",
        heading: "No agreement, no information",
        items: [
          { icon: "hospital", label: "Clinic", sub: "signed agreement", say: "The clinic shares information only after a signed agreement." },
          { icon: "building", label: "ERS", sub: "agreement with vendors", say: "ERS needs an agreement with each vendor it uses." },
          { icon: "cloud", label: "Tools and vendors", sub: "the same limits", say: "The same restrictions follow down the chain." },
        ],
      },
      {
        kind: "checklist",
        heading: "What the agreement requires",
        items: [
          { text: "Use information only as allowed", say: "Use information only as the contract allows." },
          { text: "Use safeguards", icon: "shield-check", say: "Use appropriate safeguards." },
          { text: "Report problems and breaches", icon: "siren", say: "Report any use the contract does not allow, including breaches." },
          { text: "Bind subcontractors", icon: "link", say: "Make subcontractors agree to the same restrictions." },
        ],
      },
      {
        kind: "stat",
        heading: "Telling the client",
        items: [
          { value: "60", unit: "days at most", label: "to report a breach", icon: "timer", say: "A business associate reports a breach without unreasonable delay, and within 60 days at most." },
          { value: "Same day", unit: "", label: "report a possible incident", icon: "bell-ring", say: "So report a possible incident internally the same day." },
        ],
      },
    ],
  },
];
