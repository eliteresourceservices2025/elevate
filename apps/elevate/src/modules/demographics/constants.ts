// Voluntary self-identification: gender, pronouns and religion. Every answer is optional and every list has a
// "prefer not to say". The lists are plain constants so counsel and HR can reword them in one place.

export const GENDERS = ["woman", "man", "non_binary", "self_described", "prefer_not_to_say"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  woman: "Woman",
  man: "Man",
  non_binary: "Non-binary",
  self_described: "I describe it myself",
  prefer_not_to_say: "Prefer not to say",
};

export const PRONOUNS = ["she_her", "he_him", "they_them", "she_they", "he_they", "ask_me", "self_described", "prefer_not_to_say"] as const;
export type Pronouns = (typeof PRONOUNS)[number];
export const PRONOUN_LABELS: Record<Pronouns, string> = {
  she_her: "she/her",
  he_him: "he/him",
  they_them: "they/them",
  she_they: "she/they",
  he_they: "he/they",
  ask_me: "Please ask me",
  self_described: "I write my own",
  prefer_not_to_say: "Prefer not to say",
};
/** What a profile shows next to the name. "Prefer not to say" and no answer show nothing. */
export function pronounText(pronouns: string | null | undefined, other: string | null | undefined): string | null {
  if (!pronouns || pronouns === "prefer_not_to_say") return null;
  if (pronouns === "self_described") return other?.trim() || null;
  return PRONOUN_LABELS[pronouns as Pronouns] ?? null;
}

export const RELIGIONS = [
  "roman_catholic",
  "other_christian",
  "iglesia_ni_cristo",
  "islam",
  "buddhism",
  "hinduism",
  "judaism",
  "indigenous_folk",
  "no_religion",
  "self_described",
  "prefer_not_to_say",
] as const;
export type Religion = (typeof RELIGIONS)[number];
export const RELIGION_LABELS: Record<Religion, string> = {
  roman_catholic: "Roman Catholic",
  other_christian: "Other Christian",
  iglesia_ni_cristo: "Iglesia ni Cristo",
  islam: "Islam",
  buddhism: "Buddhism",
  hinduism: "Hinduism",
  judaism: "Judaism",
  indigenous_folk: "Indigenous or folk belief",
  no_religion: "No religion",
  self_described: "Other (I describe it myself)",
  prefer_not_to_say: "Prefer not to say",
};

/** A group smaller than this is never shown in a summary (the same rule as people analytics). */
export const MIN_GROUP = 5;
export const OTHER_TEXT_MAX = 60;

export const DEMOGRAPHICS_NOTE =
  "Optional. Only you can see your gender and religion. HR sees combined counts for groups of 5 or more, never a name. Choosing a pronoun shows it next to your name for colleagues. You can change or remove any of it at any time.";
export const APPLICANT_NOTE =
  "Optional and separate from your application. It is not used to decide whether to hire you and the hiring team never sees it. We use it only for combined counts of 5 or more people, to check that our hiring is fair.";
