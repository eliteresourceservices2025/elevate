// Animated storyboards for HIPAA modules 6 to 11 (security, incidents, enforcement, state_laws, lab_public, lab_records). On screen: icons,
// big numbers, chains, stacks and a few words; the detail is in the narration (`say`). Every spoken line restates that module's lesson text:
// no new facts. Scene kinds are drawn in src/Cs.jsx and src/LearnScenes.jsx; what the voice says is read by customer-service/beats.cjs.
const { HIPAA_OUTRO } = require("./shared.cjs");

const base = (n, module, title, tagline, icon) => ({ id: `hipaa-${module}`, course: "hipaa", module, n, count: 11, title, label: `HIPAA  |  MODULE ${n} OF 11`, tagline, icon, outroItems: HIPAA_OUTRO });

module.exports = [
  {
    ...base(6, "security", "The Security Rule: protecting electronic patient information", "Safeguards for the place you work", "shield-check"),
    scenes: [
      {
        kind: "hero",
        icon: "shield-check",
        title: "Keep electronic information safe",
        sub: "So the allowed uses are the only uses",
        lead: "The Security Rule protects electronic patient information, so that the allowed uses are the only uses that happen.",
      },
      {
        kind: "icons",
        heading: "What security protects",
        items: [
          { icon: "lock", label: "Confidentiality", say: "Confidentiality: only the right people can see it." },
          { icon: "file-check", label: "Integrity", say: "Integrity: it has not been changed by mistake or on purpose." },
          { icon: "clock", label: "Availability", say: "Availability: people can get to it when they need it." },
        ],
      },
      {
        kind: "stack",
        heading: "Three kinds of safeguards",
        items: [
          { icon: "laptop", label: "Technical", sub: "Logins, encryption, logs", say: "Technical: unique logins, encryption and automatic log-off." },
          { icon: "door-closed", label: "Physical", sub: "Rooms, workstations, devices", say: "Physical: protecting rooms, workstations and devices." },
          { icon: "clipboard-list", label: "Administrative", sub: "Policies, training, risk analysis", say: "Administrative: policies, training and risk analysis." },
        ],
      },
      {
        kind: "flow",
        heading: "How safeguards are chosen",
        items: [
          { big: "1", icon: "search", label: "Find it", say: "Find where the information is." },
          { big: "2", icon: "triangle-alert", label: "Find risks", say: "Find what could go wrong." },
          { big: "3", icon: "gauge", label: "Rate them", say: "Rate how likely and how harmful." },
          { big: "4", icon: "file-check", label: "Act, write it down", say: "Act, and document what was decided." },
        ],
      },
      {
        kind: "checklist",
        heading: "At your desk",
        items: [
          { icon: "key-round", text: "Your login is yours alone", say: "Your login is yours alone." },
          { icon: "lock", text: "Lock your screen when you step away", say: "Lock your computer when you step away." },
          { icon: "siren", text: "Report a lost device at once", say: "Report a lost or stolen device immediately." },
        ],
      },
    ],
  },
  {
    ...base(7, "incidents", "Privacy and security incidents and breaches", "Report fast, report honestly", "siren"),
    scenes: [
      {
        kind: "hero",
        icon: "siren",
        title: "If you wonder, report it",
        sub: "You do not have to be sure it is serious",
        lead: "An incident is anything that may have exposed patient information, or broken a rule. If you wonder whether it is an incident, report it.",
      },
      {
        kind: "icons",
        heading: "Incident, or breach?",
        items: [
          { icon: "siren", label: "Incident", say: "An incident is reported by anyone, the same day." },
          { icon: "scale", label: "Breach", say: "A breach is decided by the client and ERS after an assessment, not by you." },
        ],
      },
      {
        kind: "timeline",
        heading: "After a breach is found",
        items: [
          { when: "Day 0", icon: "clock", label: "Clock starts", say: "The clock starts the day anyone in the workforce knows." },
          { when: "Right away", icon: "phone-call", label: "ERS tells client", say: "ERS tells the client right away." },
          { when: "60 days", icon: "mail", label: "Patients told", say: "Within 60 days, the client tells each affected person, in writing." },
        ],
      },
      {
        kind: "flow",
        heading: "What to do",
        items: [
          { big: "1", icon: "hand", label: "Stop", say: "Stop what you are doing with the information." },
          { big: "2", icon: "megaphone", label: "Tell", say: "Tell your lead and HR immediately." },
          { big: "3", icon: "pen-line", label: "Describe", say: "Describe what happened, without patient names." },
          { big: "4", icon: "archive", label: "Preserve", say: "Keep the evidence. Delete nothing." },
        ],
      },
      {
        kind: "compare",
        heading: "Honest and fast",
        leftGood: true,
        left: { title: "Do", items: [{ text: "Report right away", say: "Report right away." }, { text: "Write facts only", say: "Write facts only." }] },
        right: { title: "Do not", items: [{ text: "Fix it quietly", say: "Do not fix it quietly." }, { text: "Delete records", say: "Do not delete or edit records." }] },
      },
    ],
  },
  {
    ...base(8, "enforcement", "Enforcement, penalties and real-world cases", "What happens when HIPAA is not followed", "gavel"),
    scenes: [
      {
        kind: "hero",
        icon: "gavel",
        title: "When HIPAA is not followed",
        sub: "Most cases end before a penalty",
        lead: "OCR investigates complaints and breach reports. Most cases end before a penalty, and good faith helps.",
      },
      {
        kind: "flow",
        heading: "From complaint to case",
        items: [
          { big: "1", icon: "megaphone", label: "Complaint", say: "A complaint or breach report reaches OCR." },
          { big: "2", icon: "search", label: "Review", say: "OCR decides whether HIPAA applies." },
          { big: "3", icon: "file-search", label: "Investigation", say: "It asks for policies, risk analyses and records." },
          { big: "4", icon: "handshake", label: "Resolution", say: "Guidance, an agreement with a plan, or a penalty." },
        ],
      },
      {
        kind: "stack",
        heading: "Four civil penalty tiers",
        lead: "Civil penalties rise with what the organization knew.",
        items: [
          { icon: "flame", label: "Willful neglect, not corrected", say: "Willful neglect, not fixed, is the top tier." },
          { icon: "triangle-alert", label: "Willful neglect, corrected", say: "Then willful neglect, fixed within 30 days." },
          { icon: "circle-alert", label: "Reasonable cause", say: "Then reasonable cause." },
          { icon: "eye-off", label: "Did not know", say: "And not knowing at the bottom." },
        ],
      },
      {
        kind: "stat",
        heading: "Criminal penalties: maximum prison term",
        items: [
          { value: "1", unit: "year", label: "Knowing misuse", icon: "eye", say: "Knowingly disclosing health information: up to 1 year." },
          { value: "5", unit: "years", label: "False pretenses", icon: "ban", say: "Under false pretenses: up to 5 years." },
          { value: "10", unit: "years", label: "Gain or harm", icon: "gavel", say: "For gain or malicious harm: up to 10 years." },
        ],
      },
      {
        kind: "icons",
        heading: "How real cases begin",
        items: [
          { icon: "eye", label: "Curious look", say: "Opening records with no work reason." },
          { icon: "laptop", label: "No risk analysis", say: "A stolen laptop and no risk analysis to show." },
          { icon: "camera", label: "Unsigned yes", say: "A patient story posted without a signed authorization." },
        ],
      },
    ],
  },
  {
    ...base(9, "state_laws", "State laws beside HIPAA", "The stricter rule wins", "scale"),
    scenes: [
      {
        kind: "hero",
        icon: "scale",
        title: "HIPAA is the floor",
        sub: "Not the ceiling",
        lead: "HIPAA is the floor, not the ceiling. A state law that protects patients more still applies, and the stricter rule wins.",
      },
      {
        kind: "stat",
        heading: "Texas",
        items: [
          { value: "90", unit: "days", label: "Train new hires", icon: "graduation-cap", say: "Texas requires new hires to be trained within 90 days." },
          { value: "15", unit: "business days", label: "Electronic record copy", icon: "file-text", say: "A Texas provider with an electronic record answers a written request within 15 business days." },
          { value: "6", unit: "years", label: "Keep training statements", icon: "archive", say: "Signed training statements are kept for six years." },
        ],
      },
      {
        kind: "stat",
        heading: "California",
        items: [
          { value: "15", unit: "business days", label: "Clinic breach reports", icon: "hospital", say: "California licensed clinics and hospitals report breaches within 15 business days." },
          { value: "30", unit: "calendar days", label: "Businesses in general", icon: "building", say: "California businesses in general tell affected residents within 30 calendar days. A licensed clinic can fall under both rules." },
        ],
      },
      {
        kind: "flow",
        heading: "Not sure which rules apply?",
        items: [
          { big: "1", icon: "clipboard-list", label: "Client sheet", say: "Read your client's instructions." },
          { big: "2", icon: "map-pin", label: "Client's state", say: "Check which state the client is in." },
          { big: "3", icon: "scale", label: "Stricter rule", say: "Follow the stricter rule." },
          { big: "4", icon: "message-circle", label: "Ask", say: "When stuck, ask your lead." },
        ],
      },
    ],
  },
  {
    ...base(10, "lab_public", "Lab: front desk, scheduling, marketing and websites", "Work that faces patients and the public", "headset"),
    scenes: [
      {
        kind: "hero",
        icon: "headset",
        title: "Front desk and public work",
        sub: "Never confirm that someone is a patient",
        lead: "On the phone, never confirm that someone is a patient. Offer to take a message.",
      },
      {
        kind: "dialogue",
        scenario: "A caller asks about a neighbor",
        roles: { rep: "You", family: "Caller" },
        lines: [
          { who: "family", text: "Can you tell me if my neighbor is a patient at your clinic?" },
          { who: "rep", text: "I can't confirm or share anything about anyone. I can take a message, in case she is a patient." },
        ],
        after: "You neither confirm nor deny, and the message lets her decide.",
      },
      {
        kind: "swap",
        heading: "Replying to a bad review",
        items: [
          {
            bad: "Our records show you were seen at 9 am",
            good: "Thank you for your feedback. Please contact our office.",
            badSay: "A reply with visit details confirms the person was a patient.",
            goodSay: "A safe reply invites them to contact the office, and the client approves it.",
          },
        ],
      },
      {
        kind: "checklist",
        heading: "Before you publish or send",
        items: [
          { icon: "user", text: "Any patient in it?", say: "Is any patient in it: a name, photo, story or date?" },
          { icon: "file-check", text: "Signed authorization?", say: "Is there a signed authorization for this exact use?" },
          { icon: "eye-off", text: "Confirms someone is a patient?", say: "Does it confirm someone is a patient, even without a name?" },
          { icon: "badge-check", text: "Client approved?", say: "Has the client approved it?" },
        ],
      },
    ],
  },
  {
    ...base(11, "lab_records", "Lab: billing, insurance and records work", "Minimum necessary, every step", "receipt"),
    scenes: [
      {
        kind: "hero",
        icon: "receipt",
        title: "Billing, insurance and records",
        sub: "The minimum each step needs",
        lead: "Payment work is allowed, but only for the minimum information each step needs.",
      },
      {
        kind: "compare",
        heading: "Minimum, or too much?",
        leftGood: true,
        left: { title: "Minimum", icon: "check", items: [{ text: "Only the columns the review needs", say: "Export only the columns the review needs." }, { text: "Only what the eligibility check needs", say: "Share only what the eligibility check needs." }] },
        right: { title: "Too much", icon: "x", items: [{ text: "Every export column", say: "Do not export every field to save time." }, { text: "The whole chart", say: "Do not send the whole chart to answer a billing question." }] },
      },
      {
        kind: "chain",
        heading: "A collection agency",
        items: [
          { icon: "hospital", label: "Clinic", say: "The clinic holds the patient information." },
          { icon: "file-check", label: "Signed agreement", say: "A collection agency is a business associate, so it needs a signed agreement." },
          { icon: "briefcase", label: "Agency", say: "Only then may it receive anything." },
        ],
      },
      {
        kind: "flow",
        heading: "Before you send, share or export",
        items: [
          { big: "1", icon: "user-check", label: "Recipient", say: "Recipient: who exactly?" },
          { big: "2", icon: "map-pin", label: "Destination", say: "Destination: confirmed?" },
          { big: "3", icon: "file-text", label: "Content", say: "Content: only what the step needs." },
          { big: "4", icon: "shield-check", label: "Channel", say: "Channel: the approved one." },
          { big: "5", icon: "copy", label: "Copies", say: "Copies: none kept." },
        ],
      },
    ],
  },
];
