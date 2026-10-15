// Quarterly micro-drills (Release 3): a two-minute scenario per course, one a quarter. A nudge, not an exam: nothing fails, nothing
// blocks work, the person sees the better answer and why, and HR sees only a count and a share per quarter (groups of five or more).
// The scenarios are invented and generic: no real person, client or patient. Content is data, never HTML.

export type DrillOption = { id: "a" | "b" | "c"; text: string };
export type Drill = { key: string; title: string; scenario: string; options: readonly [DrillOption, DrillOption, DrillOption]; best: "a" | "b" | "c"; explanation: string };

export const DRILLS: Record<string, readonly Drill[]> = {
  hipaa: [
    {
      key: "caller-verification",
      title: "A caller asks about an appointment",
      scenario: "A caller says they are the daughter of one of your client's patients and asks what time the appointment is tomorrow. She knows the patient's name and date of birth.",
      options: [
        { id: "a", text: "Tell her the time. She knows the name and the birth date, so she must be family." },
        { id: "b", text: "Follow your client's verification steps. If she is not on the list, take a message and confirm nothing." },
        { id: "c", text: "Hang up without a word and say nothing to anyone." },
      ],
      best: "b",
      explanation: "A name and a birth date are easy to find, so they prove nothing. Use the client's own steps. When someone is not verified, a polite message protects the patient without being rude.",
    },
    {
      key: "screenshot-help",
      title: "A teammate asks for a screenshot",
      scenario: "A teammate is stuck on a form and asks you to paste a screenshot of the client's patient list into your personal chat so they can see the layout.",
      options: [
        { id: "a", text: "Send it. It is only a quick look and you will delete it afterwards." },
        { id: "b", text: "Send it with the names blurred, then delete it." },
        { id: "c", text: "Do not send it. Describe the layout in words or use an invented example, and ask your lead if more is needed." },
      ],
      best: "c",
      explanation: "Patient information stays inside the client's approved systems. Blurring can miss details, and a personal chat is not approved. An invented example shows the layout just as well.",
    },
    {
      key: "minimum-necessary",
      title: "More of the record than you need",
      scenario: "You only need to confirm that a delivery date was recorded, but the screen opens the patient's whole chart.",
      options: [
        { id: "a", text: "Look through the chart while you are there. It might help later." },
        { id: "b", text: "Look only at what the task needs and close the chart." },
        { id: "c", text: "Copy the chart into a note so you do not have to open it again." },
      ],
      best: "b",
      explanation: "Use and see only the minimum needed for the task in front of you. Being able to open something does not mean you should.",
    },
    {
      key: "wrong-recipient",
      title: "A file went to the wrong person",
      scenario: "You realise you emailed a spreadsheet with patient details to a contact at the wrong company.",
      options: [
        { id: "a", text: "Wait a day to see whether anyone replies." },
        { id: "b", text: "Report it right away through the ERS privacy incident report, and do not try to fix it quietly." },
        { id: "c", text: "Delete your sent email and hope that is enough." },
      ],
      best: "b",
      explanation: "The clock starts when the mistake happens. Early reporting lets the right people act within the client's time limits, and reporting honestly and quickly is always the right call.",
    },
  ],
  cybersecurity: [
    {
      key: "urgent-link",
      title: "An urgent password message",
      scenario: "An email says your password expires in one hour and asks you to click a link to keep your access. It looks like it comes from IT.",
      options: [
        { id: "a", text: "Click the link quickly so you do not lose access." },
        { id: "b", text: "Do not click. Open the real site yourself, or ask IT through a channel you already know, and report the email." },
        { id: "c", text: "Forward it to a teammate to ask what they think." },
      ],
      best: "b",
      explanation: "Urgency is the trick. Go to the real site yourself rather than through the link, and report the message so others are warned.",
    },
    {
      key: "ai-paste",
      title: "Pasting client text into an AI chat",
      scenario: "You want an AI chatbot on the internet to tidy a long message that contains a client's customer details.",
      options: [
        { id: "a", text: "Paste it. The chatbot only improves wording." },
        { id: "b", text: "Paste it but delete the last line with the phone number." },
        { id: "c", text: "Do not paste it. Use only tools ERS and the client have approved, or write an invented version." },
      ],
      best: "c",
      explanation: "Anything you paste into a public tool leaves your control. Client information stays in approved systems, and an invented version gets the same wording help.",
    },
    {
      key: "step-away",
      title: "Stepping away from your screen",
      scenario: "You are working from a cafe and need to collect your order from the counter for a minute.",
      options: [
        { id: "a", text: "Lock the screen, then go." },
        { id: "b", text: "Leave it open. You will only be a minute." },
        { id: "c", text: "Ask the stranger at the next table to keep an eye on it." },
      ],
      best: "a",
      explanation: "A locked screen takes a second, and a minute is long enough for harm. Locking every single time turns it into a habit.",
    },
    {
      key: "unexpected-prompt",
      title: "A sign-in approval you did not ask for",
      scenario: "Your phone shows a prompt asking you to approve a sign-in to your work account. You are not signing in to anything.",
      options: [
        { id: "a", text: "Approve it so the prompts stop." },
        { id: "b", text: "Ignore it and say nothing." },
        { id: "c", text: "Deny it, change your password, and report it right away." },
      ],
      best: "c",
      explanation: "An approval you did not start means someone may have your password. Deny it, change the password and report it so the account can be checked.",
    },
  ],
};

const ZONE = "America/Phoenix";

/** The quarter a date falls in, for example "2026-Q4" (company time zone). */
export function quarterOf(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit" }).formatToParts(at);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** This quarter's drill for a course: the list is walked one step a quarter, so the same one does not repeat soon. */
export function drillFor(courseSlug: string, quarter: string): Drill | null {
  const list = Object.hasOwn(DRILLS, courseSlug) ? DRILLS[courseSlug] : undefined;
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!list || list.length === 0 || !match) return null;
  return list[(Number(match[1]) * 4 + Number(match[2]) - 1) % list.length];
}
