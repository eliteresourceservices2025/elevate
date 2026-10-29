// Contact support: topics, limits and the address. Pure.

export const SUPPORT_TOPICS = [
  { value: "sign_in", label: "Signing in or my account" },
  { value: "time_clock", label: "The time clock or my hours" },
  { value: "jibble", label: "Jibble or screenshots" },
  { value: "data", label: "My information or a record is wrong" },
  { value: "other", label: "Something else" },
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number]["value"];
export const TOPIC_VALUES = SUPPORT_TOPICS.map((t) => t.value) as [SupportTopic, ...SupportTopic[]];
export const topicLabel = (value: string): string => SUPPORT_TOPICS.find((t) => t.value === value)?.label ?? value;

export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 2000;

/** Where support requests are emailed (and shown publicly as "email us"). A deployment can change it with SUPPORT_EMAIL. */
export const DEFAULT_SUPPORT_EMAIL = "elitehelpdesk@ersva.com";

/** The support address for this deployment (SUPPORT_EMAIL), else the default. Safe in server and client components. */
export const supportAddress = (): string => process.env.SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL;
