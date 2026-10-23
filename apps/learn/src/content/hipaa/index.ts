import type { CourseContent, QuestionSeed } from "../schema";
import { m1, q1 } from "./m1-foundations";
import { m2, q2 } from "./m2-phi";
import { m3, q3 } from "./m3-privacy";
import { m4, q4 } from "./m4-rights";
import { m5, q5 } from "./m5-associates";
import { m6, q6 } from "./m6-security";
import { m7, q7 } from "./m7-incidents";
import { m8, q8 } from "./m8-enforcement";
import { m9, q9 } from "./m9-lab-public";
import { m10, q10 } from "./m10-lab-records";
import { m11, q11 } from "./m11-state-laws";

/**
 * The HIPAA course for ERS: HIPAA only, authored in code and validated by `courseContentSchema`. General cybersecurity habits
 * (phishing, passwords, home network) are the separate Cybersecurity course. Counsel reviews this before it is published.
 */
export const HIPAA_COURSE_SLUG = "hipaa";

export const hipaaCourse: CourseContent = {
  title: "HIPAA Privacy, Security and Awareness",
  attestation: {
    version: "v3",
    text: "I have completed this HIPAA training for Elite Resource Services. I understand that I must protect patient information, use it only for my assigned work and only through approved systems, and report any possible privacy or security incident to my team lead and HR immediately. I understand that breaking these rules can lead to ERS sanctions, including the end of my engagement.",
  },
  modules: [m1, m2, m3, m4, m5, m6, m7, m8, m11, m9, m10],
};

export const hipaaQuestions: QuestionSeed[] = [...q1, ...q2, ...q3, ...q4, ...q5, ...q6, ...q7, ...q8, ...q11, ...q9, ...q10];

/** Exam rules: 20 questions on every track (owner decision, version 2), 80% to pass. No time limit: leave `minutes` out. */
export const hipaaExamConfig = {
  passPercent: 80,
  maxTries: 3,
  waitMinutesAfterFail: 60,
  renewalMonths: 24,
  tracks: {
    full: { questions: 20 },
    essentials: { questions: 20 },
    refresher: { questions: 20 },
  },
} as const;

/** A module must be open at least this share of its estimated time before it can be completed. */
export const MIN_TIME_SHARE = 0.4;
