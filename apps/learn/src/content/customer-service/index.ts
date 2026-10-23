import type { CallSeed, CourseContent, QuestionSeed } from "../schema";
import { customerServiceCalls } from "./calls";
import { badNewsModule } from "./m9-bad-news";
import { channelsModule } from "./m3-channels";
import { communicationModule } from "./m2-communication";
import { confidentialityModule } from "./m5-confidentiality";
import { difficultModule } from "./m7-difficult";
import { excellenceModule } from "./m1-excellence";
import { healthcareModule } from "./m6-healthcare";
import { listeningModule } from "./m4-listening";
import { personalitiesModule } from "./m8-personalities";
import { resilienceModule } from "./m11-resilience";
import { resolutionModule } from "./m10-resolution";
import { customerServiceQuestions } from "./questions";

/**
 * The Customer Service & Family Support course (docs/learn/14-mock-call.md and the HR proposal in docs/learn/drafts). Eleven modules,
 * an exam of 25 questions drawn from a bank of 88, and a graded mock call (three calls drawn from five). Modules 5 (Confidentiality)
 * and 6 (Healthcare calls) are reviewed by counsel before publishing; HR and the Privacy Officer review everything. Certificates are
 * valid for 24 months. Each client's own steps (identity checks, emergency steps, escalation contacts) go in a client add-on module.
 */
export const CUSTOMER_SERVICE_COURSE_SLUG = "customer-service";

export const customerServiceCourse: CourseContent = {
  title: "Customer Service & Family Support Certification",
  attestation: {
    version: "v1",
    text: "I have completed the ERS Customer Service & Family Support certification. I understand that I must confirm who I am speaking with and that they may have the information before I share anything, share only what a person is allowed to have, never give medical, legal or financial advice, follow my client's emergency steps and alert my lead when a caller may be in danger, and tell my lead right away if I make a mistake.",
  },
  modules: [
    excellenceModule,
    communicationModule,
    channelsModule,
    listeningModule,
    confidentialityModule,
    healthcareModule,
    difficultModule,
    personalitiesModule,
    badNewsModule,
    resolutionModule,
    resilienceModule,
  ],
};

export { customerServiceQuestions };

/** The mock-call pool: five calls, two of them medical; each attempt draws three (always at least one medical). */
export const customerServiceCallSeeds: CallSeed[] = customerServiceCalls;

export const customerServiceExamConfig = {
  passPercent: 85,
  maxTries: 3,
  waitMinutesAfterFail: 60,
  renewalMonths: 24,
  tracks: {
    full: { questions: 25 },
    essentials: { questions: 25 },
    refresher: { questions: 25 },
  },
  call: { passPercent: 85, scenarios: 3, maxTries: 3, waitMinutesAfterFail: 60 },
} as const;
