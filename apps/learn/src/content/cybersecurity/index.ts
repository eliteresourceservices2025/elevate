import type { CourseContent, QuestionSeed } from "../schema";
import { everydayModule, everydayQuestions } from "./everyday";
import { phishingModule, phishingQuestions } from "./phishing";

/**
 * The Cybersecurity basics course: general good practice for everyone at ERS, kept apart from the HIPAA course so that one stays
 * about HIPAA alone. Not tied to a client or to patient information. Counsel review is not required for the legal claims (there
 * are none), but the Privacy Officer or IT lead should still read it before it is published.
 */
export const CYBERSECURITY_COURSE_SLUG = "cybersecurity";

export const cybersecurityCourse: CourseContent = {
  title: "Cybersecurity basics for the ERS team",
  attestation: {
    version: "v1-draft",
    text: "I have completed ERS's cybersecurity basics training. I understand that I must keep my passwords and sign-in codes private, use only approved devices, software and networks for work, keep my devices updated, and report anything suspicious or any lost device to my team lead and HR right away.",
  },
  modules: [phishingModule, everydayModule],
};

export const cybersecurityQuestions: QuestionSeed[] = [...phishingQuestions, ...everydayQuestions];

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
