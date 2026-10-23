import { q, type CourseModule, type QuestionSeed } from "../schema";

// Module 11 (version 3): state laws beside HIPAA. Texas and California are the worked examples; the habit that matters is finding out
// which state rules a client follows and applying the stricter rule. Original text for ERS, checked against the statute text and
// official summaries listed in docs/learn/08-source-check.md ("Version 3: state laws"). All people and details in examples are invented.
// Counsel or the Privacy Officer reviews this before it is published.

export const m11: CourseModule = {
  key: "state_laws",
  title: "State laws beside HIPAA",
  summary: "HIPAA is the floor. Some states go further, so you learn the 'stricter rule wins' habit, two real examples (Texas and California) and how to find out which rules your client follows.",
  estimatedMinutes: 12,
  tracks: ["full", "essentials"],
  keyPoints: [
    "HIPAA is a national floor. A state law that protects patients more, or gives them faster access, still applies.",
    "When HIPAA and a state rule both apply and differ, follow the stricter one.",
    "Texas and California are two examples of states that go further in some areas.",
    "You are not expected to know every state's law. You are expected to ask which rules your client follows.",
    "State rules often reach further for mental health, substance use, HIV, minors, record-copy deadlines and breach notices.",
    "Your client's instructions already reflect the state rules that apply to them. Follow them, and ask when they seem to conflict with something else.",
  ],
  screens: [
    {
      id: "two-sets",
      title: "Two sets of rules",
      blocks: [
        { type: "paragraph", text: "So far you have learned HIPAA, a federal law. It applies the same way in every state. But states can pass their own laws about health information too, and your clients are in different states." },
        { type: "paragraph", text: "That means a clinic in one state can have rules that a clinic in another state does not. ERS handles this for you by passing the rules down in the client's instructions. Your job is to understand why they can differ, and to notice when something does not fit." },
        { type: "callout", tone: "info", title: "The idea in one line", text: "HIPAA is the floor, not the ceiling. A state can build higher, and when it does, the higher rule is the one that applies." },
      ],
    },
    {
      id: "stricter-wins",
      title: "When both apply, the stricter rule wins",
      blocks: [
        { type: "paragraph", text: "HIPAA sets a national minimum. If a state law gives patients more privacy protection, or lets them reach their own records sooner, that state law is not replaced by HIPAA. The organization follows whichever rule protects the patient more." },
        {
          type: "compare",
          left: { title: "HIPAA alone", items: ["One national minimum for everyone", "Patient gets a copy of their record within 30 days of the request", "A breach notice is due without unreasonable delay, and no later than 60 days"] },
          right: { title: "A stricter state rule on top", items: ["Applies where the state wrote it", "May shorten a deadline, add a signed form or widen who is covered", "The organization follows the shorter or stronger rule"] },
        },
        {
          type: "check",
          question: "A state law says patients get their record faster than HIPAA requires. Which deadline does the clinic follow?",
          options: [
            { text: "The state's faster deadline", correct: true, feedback: "Right. When a state rule protects the patient more, it applies beside HIPAA." },
            { text: "HIPAA's 30 days, because HIPAA is a federal law", correct: false, feedback: "HIPAA is a floor. A stricter state rule is not cancelled by it." },
            { text: "Whichever deadline is later", correct: false, feedback: "The goal is the opposite: the rule that protects the patient more wins." },
          ],
        },
      ],
    },
    {
      id: "sort-the-rule",
      title: "Quick sort: HIPAA baseline or Texas goes further?",
      blocks: [
        { type: "paragraph", text: "Texas wrote its own medical privacy law, Chapter 181 of its Health and Safety Code, often called HB 300. Sort these rules by where they come from. Swipe through them one at a time." },
        {
          type: "cards",
          title: "HIPAA baseline or Texas rule?",
          prompt: "Where does each rule come from?",
          groups: ["HIPAA baseline", "Texas goes further"],
          cards: [
            { text: "A copy of the record is due within 30 days", group: 0, feedback: "That is HIPAA's baseline for patient access." },
            { text: "An electronic copy is due within 15 business days of a written request", group: 1, feedback: "Texas shortens the deadline for providers that use electronic health records." },
            { text: "New staff must be trained within 90 days of being hired", group: 1, feedback: "Texas sets this deadline in its own law, and staff sign a statement that they were trained." },
            { text: "Workforce training must be documented and kept for six years", group: 0, feedback: "HIPAA already requires the documentation to be kept for six years." },
            { text: "The organization must follow the rules for the whole workforce, including contractors", group: 0, feedback: "That is HIPAA: contractors under the organization's control are workforce members." },
            { text: "Staff are retrained within one year after a material change in the law", group: 1, feedback: "Texas gives a one-year outer limit after a material change that affects the job." },
          ],
        },
      ],
    },
    {
      id: "texas",
      title: "Texas: the state medical privacy law",
      blocks: [
        { type: "paragraph", text: "Texas Chapter 181 took effect in 2012. It covers more organizations than HIPAA does. It reaches anyone who comes into possession of protected health information, not only providers, plans and clearinghouses." },
        {
          type: "table",
          caption: "Texas rules to recognize",
          columns: ["Area", "What Texas requires"],
          rows: [
            ["Training new staff", "Within 90 days of hire, to the extent needed for the job"],
            ["Training record", "Each person signs a statement, kept for six years"],
            ["After the law changes", "Retrain staff whose duties are affected within a reasonable time, and within one year at the latest"],
            ["Record copies", "A provider with an electronic health record gives an electronic copy within 15 business days of a written request"],
          ],
        },
        { type: "callout", tone: "info", text: "Your own HIPAA training here already meets the spirit of this. ERS tracks completion and keeps the records, so you do not have to." },
        {
          type: "flip",
          title: "Texas, in four cards",
          cards: [
            { front: "How many days to train a new hire?", back: "90 days from the date of hire." },
            { front: "How long to give a patient their electronic record?", back: "15 business days after a written request, for providers with an electronic health record." },
            { front: "How long are signed training statements kept?", back: "Six years." },
            { front: "Who counts as covered in Texas?", back: "More than HIPAA: anyone who comes into possession of protected health information." },
          ],
        },
      ],
    },
    {
      id: "california",
      title: "California: a patient privacy law with teeth",
      blocks: [
        { type: "paragraph", text: "California's Confidentiality of Medical Information Act (CMIA) is a state law about medical information that sits beside HIPAA. It reaches providers and also businesses that handle medical information, and it gives patients a way to take action themselves." },
        {
          type: "table",
          caption: "California rules to recognize",
          columns: ["Area", "What California adds"],
          rows: [
            ["Release without permission", "A patient can sue when medical information is negligently released, and can recover $1,000 in damages without proving other harm"],
            ["Fines", "Fines apply per violation, and knowing or willful violations cost far more"],
            ["Breach reports by licensed clinics and hospitals", "Report to the state and to the patient within 15 business days of detecting it; looking at a patient's records with no work reason counts"],
            ["Breach notices by businesses in general", "Since January 2026, tell affected California residents within 30 calendar days of discovering a breach"],
          ],
        },
        { type: "callout", tone: "warning", title: "Two California breach laws, two clocks", text: "California has one breach rule for licensed clinics and hospitals and a general one for businesses. Older training materials say 5 business days, which has not been the rule since 2015. Which clock applies to a client depends on what the client is, and a licensed clinic can be covered by both, so always use your client's instructions." },
        { type: "paragraph", text: "You do not report breaches to a state agency yourself. Your part is the same in every state: report a possible incident to your lead right away, so the client can meet its deadline." },
      ],
    },
    {
      id: "where-states-go-further",
      title: "Where states often go further",
      blocks: [
        { type: "paragraph", text: "States differ, but the same kinds of information tend to get extra protection. When you meet one of these, slow down and follow your client's instructions exactly." },
        {
          type: "layers",
          title: "Where extra rules often appear",
          items: [
            { label: "Mental health", text: "Records may need separate permission or be filed apart." },
            { label: "Substance use", text: "Federal rules (42 CFR Part 2) add their own limits on records from certain treatment programs." },
            { label: "HIV and other sensitive diagnoses", text: "Many states limit who may see or be told." },
            { label: "Minors", text: "Who may see a young person's record depends on the state and the situation." },
            { label: "Deadlines", text: "Record copies and breach notices may be due sooner than HIPAA's deadlines." },
          ],
        },
        {
          type: "spot",
          title: "Spot the slip",
          prompt: "A client in a strict state sends this chat. Tap the line where the team member breaks the habit from this module.",
          lines: [
            { speaker: "Lead", text: "New request: a patient wants a copy of her record. Our state has its own deadline." },
            { speaker: "Team member", text: "HIPAA gives 30 days, so I'll set the reminder for day 30.", wrong: true },
            { speaker: "Lead", text: "Our state rule is shorter. Check the client sheet first." },
            { speaker: "Team member", text: "Understood, I'll use the sheet and flag it to you." },
          ],
          explanation: "The slip is assuming HIPAA's number is the only rule. When a state rule is shorter or stronger it applies too. The right move is to check the client's sheet and ask.",
        },
      ],
    },
    {
      id: "find-your-clients-rules",
      title: "How to find out your client's state rules",
      blocks: [
        { type: "paragraph", text: "You do not look up state law yourself, and you should not guess. The answer is already written down for you. Use this order:" },
        {
          type: "steps",
          items: [
            { title: "Read your client's instructions", text: "The sheet or procedure for your task names the state rules that apply, such as deadlines and forms." },
            { title: "Check which state the client is in", text: "Ask your lead if the state is not on the sheet. The client's location often decides which rules apply." },
            { title: "Follow the stricter rule", text: "If the client sheet and an ERS rule differ, use the stricter one." },
            { title: "Ask the Privacy Officer when stuck", text: "A question about a rule you cannot find goes to your lead, who can reach the Privacy Officer." },
          ],
        },
        { type: "callout", tone: "tip", text: "Asking is never a mistake. A short question costs minutes. A missed state deadline can cost the client a fine." },
        {
          type: "build",
          title: "Write the question to your lead",
          prompt: "Pick the best piece for each part of a short message about an unfamiliar request.",
          slots: [
            {
              label: "What happened",
              options: [
                { text: "A patient asked for a copy of their record", correct: true, feedback: "Say what the request is, with no names or details." },
                { text: "Mrs. Reyes, born in 1980, asked for her chart", correct: false, feedback: "Do not put patient details in a chat. Describe the situation instead." },
              ],
            },
            {
              label: "What you need",
              options: [
                { text: "Which deadline applies for this client's state", correct: true, feedback: "Specific and short." },
                { text: "Can I just do it my own way", correct: false, feedback: "Ask for the approved way, not permission to improvise." },
              ],
            },
            {
              label: "What you will do meanwhile",
              options: [
                { text: "I'll hold the request until I hear back", correct: true, feedback: "Holding is safe. Guessing is not." },
                { text: "I'll use HIPAA's 30 days for now", correct: false, feedback: "A stricter state deadline could already be running." },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "boss-round",
      title: "Quick round: state laws",
      blocks: [
        {
          type: "game",
          title: "State law sprint",
          seconds: 20,
          rounds: [
            {
              question: "A state rule is stricter than HIPAA. What applies?",
              options: [
                { text: "The stricter state rule, beside HIPAA", correct: true, feedback: "Yes. HIPAA is the floor." },
                { text: "Only HIPAA", correct: false, feedback: "HIPAA does not cancel stricter state rules." },
                { text: "Neither one", correct: false, feedback: "Both apply, and the stricter one governs the difference." },
              ],
            },
            {
              question: "Texas requires a new hire to be trained within how long?",
              options: [
                { text: "90 days", correct: true, feedback: "Right, from the date of hire." },
                { text: "One year", correct: false, feedback: "One year is the outer limit after the law changes, not the new-hire deadline." },
                { text: "Six years", correct: false, feedback: "Six years is how long the signed statement is kept." },
              ],
            },
            {
              question: "California licensed clinics and hospitals report breaches within how many business days?",
              options: [
                { text: "15", correct: true, feedback: "It was 5 until 2015. Other California businesses have a separate 30-day clock." },
                { text: "5", correct: false, feedback: "That was the older rule." },
                { text: "60", correct: false, feedback: "60 days is HIPAA's outer limit, not California's deadline." },
              ],
            },
            {
              question: "You are unsure which state rules apply. What do you do?",
              options: [
                { text: "Read the client sheet, then ask your lead", correct: true, feedback: "That is the order." },
                { text: "Search the internet and decide", correct: false, feedback: "Do not guess at law. Ask." },
                { text: "Use whichever rule is easier", correct: false, feedback: "The stricter rule protects the patient." },
              ],
            },
            {
              question: "Which kind of record often gets extra state protection?",
              options: [
                { text: "Mental health and substance use records", correct: true, feedback: "These are the classic examples, alongside HIV and minors." },
                { text: "Appointment reminders", correct: false, feedback: "These are routine." },
                { text: "Office supply orders", correct: false, feedback: "These are not health information." },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "terms",
      title: "Terms from this module",
      blocks: [
        {
          type: "glossary",
          terms: [
            { term: "Preemption", meaning: "When one law overrides another. HIPAA overrides weaker state laws but not stricter ones." },
            { term: "Stricter rule", meaning: "The rule that protects the patient more or gives them faster access." },
            { term: "Texas Chapter 181 (HB 300)", meaning: "Texas's medical privacy law, which reaches more organizations than HIPAA and sets its own training and record-copy deadlines." },
            { term: "CMIA", meaning: "California's Confidentiality of Medical Information Act, which lets patients take action over a negligent release." },
            { term: "Business day", meaning: "A weekday that is not a public holiday. Some state deadlines count only these." },
          ],
        },
      ],
    },
  ],
};

export const q11: QuestionSeed[] = [
  q("state_laws", "Stricter rule", "single", "A state law protects patients more than HIPAA does. Which applies to the clinic?", ["The stricter state law, beside HIPAA", "Only HIPAA, because it is federal", "Neither one applies", "Whichever the clinic prefers"], [0], "HIPAA is a floor. A state law that gives more privacy protection or faster access still applies."),
  q("state_laws", "Stricter rule", "true_false", "True or false: HIPAA cancels any state privacy law that asks for more than HIPAA does.", ["True", "False"], [1], "HIPAA sets a national minimum. Stricter state laws stay in force."),
  q("state_laws", "Stricter rule", "single", "Your client's instructions and a general ERS rule differ on the same point. What do you follow?", ["The stricter of the two, and ask your lead if unsure", "The one that is quicker", "The one a coworker prefers", "Neither, and use your own method"], [0], "When two rules apply and differ, the stricter one protects the patient."),
  q("state_laws", "Finding the rules", "single", "You are not sure which state's rules apply to a task. What is the best first step?", ["Read the client's instructions, then ask your lead", "Search the internet and decide on your own", "Use the rule from the last client you worked for", "Skip the task"], [0], "The client's sheet carries the state rules that apply. If it does not answer the question, ask your lead."),
  q("state_laws", "Finding the rules", "multiple", "Where can you learn which state rules a client follows? Select all that apply.", ["The client's written instructions", "Your team lead", "A guess based on a news story", "The Privacy Officer, through your lead"], [0, 1, 3], "The answer is already written down for you or available by asking. Guessing from the news is not a source."),
  q("state_laws", "Texas training", "single", "Under Texas Chapter 181, how soon must new employees be trained after being hired?", ["Within 90 days", "Within 30 days", "Within one year", "Within six years"], [0], "Texas requires training not later than the 90th day after hire."),
  q("state_laws", "Texas training", "single", "How long must a signed statement showing a person completed Texas training be kept?", ["Six years", "One year", "90 days", "It does not have to be kept"], [0], "The signed statement is kept for six years from signing."),
  q("state_laws", "Texas training", "single", "After a material change in the law that affects someone's duties, Texas requires retraining within what outer limit?", ["One year after the change takes effect", "Ten days", "Five years", "Never"], [0], "Retraining is due within a reasonable time and no later than the first anniversary of the change."),
  q("state_laws", "Texas records", "single", "A Texas provider with an electronic health record gets a written request for an electronic copy. Texas sets the response time at:", ["15 business days", "30 days", "60 days", "One year"], [0], "Texas shortens the response time for providers with electronic records to 15 business days."),
  q("state_laws", "Texas scope", "single", "Compared with HIPAA, Texas Chapter 181 applies to:", ["More organizations, including anyone who comes into possession of protected health information", "Fewer organizations, only hospitals", "Only insurance companies", "Only organizations outside Texas"], [0], "Texas defines a covered entity more broadly than HIPAA does."),
  q("state_laws", "California", "single", "California's CMIA lets a patient do what when their medical information is negligently released?", ["Bring an action in court, with damages available", "Nothing, because only HIPAA applies", "Report only to ERS", "Ask for a new insurance plan"], [0], "The CMIA gives patients a private way to act, including a set amount in damages without proving other harm."),
  q("state_laws", "California", "single", "California licensed clinics and hospitals must report certain breaches to the state and the patient within:", ["15 business days of detecting the breach", "5 business days", "24 hours", "One year"], [0], "The deadline was extended from 5 to 15 business days in 2015."),
  q("state_laws", "California", "true_false", "True or false: A training slide that says California clinics must report breaches in 5 business days is current.", ["True", "False"], [1], "The clinic and hospital deadline is 15 business days, and has been since 2015. Older materials may still show 5."),
  q("state_laws", "California", "single", "Beside the clinic and hospital rule, California has a general breach law for other businesses. Since January 2026 it asks them to tell affected residents within:", ["30 calendar days of discovering the breach", "5 business days", "One year", "No deadline"], [0], "California added a 30-calendar-day deadline for notifying affected residents. Which clock applies depends on what the client is, so follow the client's instructions."),
  q("state_laws", "Your role", "single", "You notice a possible privacy incident for a client in a state with a short breach deadline. What is your part?", ["Report it to your lead right away so the client can meet its deadline", "Wait to see if it turns out to be real", "Contact the state agency yourself", "Tell the patient directly"], [0], "You do not report to agencies. Fast reporting to your lead is what lets the client meet any deadline."),
  q("state_laws", "Extra protection", "multiple", "Which kinds of information often get extra protection under state or federal rules? Select all that apply.", ["Mental health records", "Substance use treatment records", "HIV and other sensitive diagnoses", "An office's printer supply order"], [0, 1, 2], "States and federal rules often reach further for sensitive health information. Supply orders are not health information."),
  q("state_laws", "Habits", "single", "A patient asks for their record and you think HIPAA's 30 days is the only deadline. What is the safer habit?", ["Check the client's sheet for a shorter state deadline and ask if unsure", "Always wait 30 days", "Always answer at once with the full chart", "Ignore the request"], [0], "A shorter state deadline may already be running. Check the sheet and ask."),
];
