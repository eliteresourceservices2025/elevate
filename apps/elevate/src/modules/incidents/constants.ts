// Privacy incident reports: kinds, limits and small pure helpers. No patient information is ever asked for or stored.

export const INCIDENT_KINDS = [
  { value: "wrong_recipient", label: "Information sent to the wrong person" },
  { value: "lost_device", label: "Lost or stolen laptop, phone or storage" },
  { value: "suspicious_link", label: "Clicked a suspicious link or opened a suspicious file" },
  { value: "exposed_password", label: "A password or code was shared or exposed" },
  { value: "unauthorized_access", label: "Someone saw or used information they should not" },
  { value: "left_visible", label: "Documents or a screen left where others could see" },
  { value: "other", label: "Something else that worries me" },
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number]["value"];
export const KIND_VALUES = INCIDENT_KINDS.map((k) => k.value) as [IncidentKind, ...IncidentKind[]];
export const kindLabel = (value: string): string => INCIDENT_KINDS.find((k) => k.value === value)?.label ?? value;

export const STATUSES = ["new", "in_review", "closed"] as const;
export type IncidentStatus = (typeof STATUSES)[number];
export const statusLabel = (s: string): string => (s === "new" ? "New" : s === "in_review" ? "In review" : s === "closed" ? "Closed" : s);

export const LIMITS = { howFound: 1000, whatHappened: 5000, whoElse: 500, actionsTaken: 2000, message: 3000, resolution: 2000 } as const;

/** A short reference people can quote: PI- and the first 8 characters of the id. */
export const incidentReference = (id: string): string => `PI-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/** The text shown with the form: never patient information. */
export const NO_PATIENT_DATA_WARNING =
  "Do not write patient names, birth dates, record numbers or any detail that identifies a patient. Describe what happened in general words, for example: a report with a patient's information was emailed to the wrong person. The privacy team will ask for anything else they need.";
