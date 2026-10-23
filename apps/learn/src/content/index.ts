import { CYBERSECURITY_COURSE_SLUG, cybersecurityCourse, cybersecurityExamConfig, cybersecurityQuestions } from "./cybersecurity";
import { HIPAA_COURSE_SLUG, hipaaCourse, hipaaExamConfig, hipaaQuestions } from "./hipaa";
import type { CallSeed, CourseContent, QuestionSeed } from "./schema";

export { MIN_TIME_SHARE } from "./hipaa";

export type CourseDefinition = {
  slug: string;
  content: CourseContent;
  questions: QuestionSeed[];
  /** The mock-call pool, when the course has a graded call (docs/learn/14-mock-call.md). */
  calls?: CallSeed[];
  examConfig: unknown;
  /** The exam must be drawn from a bank at least this many times its size (so attempts differ). */
  minPoolFactor: number;
};

/** Every course ELEVATE Learn can load. Add a course here and it can be published and assigned like the others. */
export const COURSES: Record<string, CourseDefinition> = {
  [HIPAA_COURSE_SLUG]: { slug: HIPAA_COURSE_SLUG, content: hipaaCourse, questions: hipaaQuestions, examConfig: hipaaExamConfig, minPoolFactor: 3 },
  [CYBERSECURITY_COURSE_SLUG]: { slug: CYBERSECURITY_COURSE_SLUG, content: cybersecurityCourse, questions: cybersecurityQuestions, examConfig: cybersecurityExamConfig, minPoolFactor: 3 },
};
