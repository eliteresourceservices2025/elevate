import type { CourseContent, QuestionSeed } from "../schema";
import { m1, q1 } from "./m1-foundations";
import { m2, q2 } from "./m2-phi";
import { m3, q3 } from "./m3-privacy";
import { m4, q4 } from "./m4-security";
import { m5, q5 } from "./m5-remote";
import { m6, q6 } from "./m6-phishing";
import { m7, q7 } from "./m7-incidents";
import { m8, q8 } from "./m8-lab";

/** The HIPAA course for ERS: authored text, in code, validated by `courseContentSchema`. Counsel reviews it before it is published. */
export const HIPAA_COURSE_SLUG = "hipaa";

export const hipaaCourse: CourseContent = {
  title: "HIPAA Privacy, Security and Awareness",
  attestation: {
    version: "v1-draft",
    text: "I have completed this HIPAA training for Elite Resource Services. I understand that I must protect patient information, use it only for my assigned work and only through approved systems, and report any possible privacy or security incident to my team lead and HR immediately. I understand that breaking these rules can lead to ERS sanctions, including the end of my engagement.",
  },
  modules: [m1, m2, m3, m4, m5, m6, m7, m8],
};

export const hipaaQuestions: QuestionSeed[] = [...q1, ...q2, ...q3, ...q4, ...q5, ...q6, ...q7, ...q8];

/** Exam rules for this course version (docs/learn/04-course-and-exam.md). HR can change them for a new version. */
export const hipaaExamConfig = {
  passPercent: 85,
  maxTries: 3,
  waitMinutesAfterFail: 60,
  renewalMonths: 12,
  tracks: {
    full: { questions: 25, minutes: 30 },
    essentials: { questions: 15, minutes: 20 },
    refresher: { questions: 15, minutes: 20 },
  },
} as const;

/** A module must be open at least this share of its estimated time before it can be completed. */
export const MIN_TIME_SHARE = 0.6;
