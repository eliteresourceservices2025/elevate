// The "instructions for learners" message HR can read and copy from Training status (our own version of the notice other training
// platforms give their administrators). Pure: the facts come in, the text comes out, so it is tested and never drifts from the real
// course rules. It contains no password or account detail: people sign in with their ELEVATE account.

export type InstructionFacts = {
  /** "hipaa", "cybersecurity" or an add-on address. */
  slug: string;
  kind: "core" | "client_addon";
  /** The course's short name, for example "HIPAA" or "Cybersecurity basics". */
  label: string;
  /** What to call it in a sentence, for example "HIPAA training". */
  noun: string;
  /** The client of an add-on, when there is one. */
  clientName: string | null;
  /** About how long the whole course takes on the longest track, in minutes. */
  minutes: number | null;
  /** The exam, or null for an acknowledgment-only course. */
  exam: { questions: number; passPercent: number; maxTries: number; waitMinutes: number } | null;
  /** How long a certificate stays valid, in months. */
  renewalMonths: number | null;
};

const hours = (minutes: number): string => {
  if (minutes < 75) return `${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const h = Math.round((minutes / 60) * 2) / 2;
  return `${h} hours`;
};

function intro(f: InstructionFacts): string {
  if (f.kind === "client_addon") {
    return `${f.clientName ? `Our client ${f.clientName} has` : "One of our clients has"} requirements that everyone who works on their account needs to know. This short course, ${f.label}, covers what is expected of you. It is assigned to you because you are on that client.`;
  }
  if (f.slug === "hipaa") {
    return "Because many of our clients are in the healthcare industry, we work under the federal HIPAA rules (the Health Insurance Portability and Accountability Act). Everyone who works with us is required to complete HIPAA training. It explains what protected health information is, how to keep it private and secure, and what each person is responsible for.";
  }
  if (f.slug === "cybersecurity") {
    return "Our clients trust us with their information, and most attacks start with an ordinary message or a weak habit. This course teaches the everyday practices that keep that information safe: passwords, phishing, safe browsing, using AI tools carefully, and what to do when something goes wrong. Everyone who works with us completes it.";
  }
  return `This training, ${f.label}, is required of everyone it is assigned to.`;
}

/** The message, as plain text paragraphs separated by blank lines. */
export function buildLearnerInstructions(f: InstructionFacts): string {
  const out: string[] = [intro(f)];

  out.push(
    `How to start: sign in to ELEVATE with your usual account and open Learning, then My training. ${f.noun.charAt(0).toUpperCase()}${f.noun.slice(1)} appears there as soon as it is assigned to you. There is no separate account or password to remember.`,
  );

  out.push(
    `The training is self-paced and online${f.minutes ? ` and takes about ${hours(f.minutes)}` : ""}. You do not have to finish it in one sitting: your progress is saved as you go, so if you are interrupted you can close the page and pick up where you stopped. Each lesson needs a little reading time before it can be marked done, and you work through the lessons in order.`,
  );

  if (f.exam) {
    out.push(
      `At the end there is a final exam of ${f.exam.questions} questions. You need ${f.exam.passPercent}% to pass, and you have ${f.exam.maxTries} tries${f.exam.waitMinutes > 0 ? `, with a ${f.exam.waitMinutes}-minute wait between them so you can review the topics you missed` : ""}. If you run out of tries, contact HR and they will help.`,
    );
  } else {
    out.push("There is no exam for this course. When you have read every lesson, you read a short statement and accept it by typing your full name.");
  }

  out.push(
    `Once you ${f.exam ? "pass" : "finish"}, you type your name to accept the responsibility statement and your certificate is ready straight away to save or print. You do not need to send it to us: it is recorded in ELEVATE automatically${f.renewalMonths ? `, and it is valid for ${f.renewalMonths} months before it needs renewing` : ""}.`,
  );

  out.push("Training never stops you from working, but please finish it by the due date shown in My training. If something does not work or you are unsure, ask HR.");
  out.push("Thank you for your help.");
  return out.join("\n\n");
}
