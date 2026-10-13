/**
 * The training rules that are fixed by decision (docs/learn/04-course-and-exam.md). HR can change the adjustable ones later
 * through audited settings; these are the launch defaults.
 */
export const EXAM_PASS_PERCENT = 85;
export const EXAM_MAX_TRIES = 3;
export const EXAM_QUESTIONS_FULL = 25;
export const EXAM_QUESTIONS_SHORT = 15;
export const EXAM_MINUTES_FULL = 30;
export const EXAM_MINUTES_SHORT = 20;
export const EXAM_WAIT_MINUTES_AFTER_FAIL = 60;

/** New people finish within 30 days of their start; everyone renews every 12 months. */
export const NEW_HIRE_DUE_DAYS = 30;
export const RENEWAL_MONTHS = 12;
export const RENEWAL_OPENS_DAYS_BEFORE = 60;

/** A module's minimum active time is this share of its estimate. */
export const MIN_TIME_SHARE = 0.6;
/** One time credit per 30 seconds while the page is visible and there was input in the last 5 minutes. */
export const HEARTBEAT_SECONDS = 30;
export const ACTIVITY_PROMPT_SECONDS = 5 * 60;

/** Launch token and session limits. */
export const LAUNCH_TOKEN_SECONDS = 60;
export const SESSION_IDLE_MINUTES = 30;
export const SESSION_ABSOLUTE_HOURS = 8;
