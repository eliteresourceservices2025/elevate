import { addMonths } from "date-fns";

// Pure rules for people-record retention (docs/modules/people-retention-design.md). No database here, so tests are plain.

export const DEFAULT_ARCHIVE_AFTER_MONTHS = 60;
export const DEFAULT_ANONYMIZE_AFTER_MONTHS = 72;

export type RetentionStage = "retained" | "archive_due" | "anonymize_due" | "skip";

export type RetentionCandidate = {
  status: string;
  /** The separation date, "YYYY-MM-DD". Without one the clock never starts. */
  endDate: string | null;
  legalHold: boolean;
  anonymized: boolean;
};

/** Months are counted from the end date (UTC midnight; a day's difference does not matter at this scale). */
export function retentionStage(
  person: RetentionCandidate,
  periods: { archiveAfterMonths: number; anonymizeAfterMonths: number },
  now: Date,
): RetentionStage {
  if (person.anonymized || person.legalHold) return "skip";
  if (person.status !== "separated" || !person.endDate) return "skip";
  const end = new Date(`${person.endDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return "skip";
  if (addMonths(end, periods.anonymizeAfterMonths) <= now) return "anonymize_due";
  if (addMonths(end, periods.archiveAfterMonths) <= now) return "archive_due";
  return "retained";
}
