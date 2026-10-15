import type { CourseContent, QuestionSeed } from "../schema";
import { aiToolsModule, aiToolsQuestions } from "./ai-tools";
import { browsingModule, browsingQuestions } from "./browsing";
import { devicesModule, devicesQuestions } from "./devices";
import { malwareModule, malwareQuestions } from "./malware";
import { passwordsModule, passwordsQuestions } from "./passwords";
import { phishingModule, phishingQuestions } from "./phishing";
import { physicalModule, physicalQuestions } from "./physical";
import { responseModule, responseQuestions } from "./response";
import { securityHipaaModule, securityHipaaQuestions } from "./security-hipaa";
import { whyModule, whyQuestions } from "./why";

/**
 * The Cybersecurity basics course: general good practice for everyone at ERS, kept apart from the HIPAA course so that one stays
 * about HIPAA alone. Not tied to a client or to patient information. Counsel review is not required for the legal claims (there
 * are none), but the Privacy Officer or IT lead should still read it before it is published.
 */
export const CYBERSECURITY_COURSE_SLUG = "cybersecurity";

export const cybersecurityCourse: CourseContent = {
  title: "Cybersecurity basics for the ERS team",
  attestation: {
    version: "v2",
    text: "I have completed ERS's cybersecurity basics training. I understand that I must keep my passwords and sign-in codes private, use only approved devices, software and networks for work, keep my devices updated, and report anything suspicious or any lost device to my team lead and HR right away.",
  },
  modules: [whyModule, passwordsModule, phishingModule, malwareModule, browsingModule, aiToolsModule, devicesModule, physicalModule, responseModule, securityHipaaModule],
};

export const cybersecurityQuestions: QuestionSeed[] = [
  ...whyQuestions,
  ...passwordsQuestions,
  ...phishingQuestions,
  ...malwareQuestions,
  ...browsingQuestions,
  ...aiToolsQuestions,
  ...devicesQuestions,
  ...physicalQuestions,
  ...responseQuestions,
  ...securityHipaaQuestions,
];

export const cybersecurityExamConfig = {
  passPercent: 80,
  maxTries: 3,
  waitMinutesAfterFail: 60,
  renewalMonths: 12,
  tracks: {
    full: { questions: 15 },
    essentials: { questions: 15 },
    refresher: { questions: 15 },
  },
} as const;
