// Seeded placeholder policies carry this text; publishing refuses a draft that still contains it.
export const PLACEHOLDER_MARK = "DRAFT PLACEHOLDER";

/**
 * The privacy notice and the monitoring policy are edited in place over time, so their version number is never shown to
 * people (it is still kept, because acknowledgments are recorded per version). Other policies show "Version N".
 */
export const hidesVersion = (kind: string | null | undefined) => kind === "privacy_notice" || kind === "monitoring";
