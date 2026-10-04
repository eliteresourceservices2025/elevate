// Where each column of a TalentHR export goes in ELEVATE. Pure: no database.

export const DESTINATIONS = [
  { value: "ignore", label: "Do not import" },
  { value: "id", label: "TalentHR employee ID (to link supervisors)" },
  { value: "email", label: "Work email (required, how people are matched)" },
  { value: "first_name", label: "First name (required)" },
  { value: "last_name", label: "Last name (required)" },
  { value: "supervisor_id", label: "Supervisor's TalentHR ID (reports to)" },
  { value: "hire_date", label: "Start date" },
  { value: "termination_date", label: "Last working day" },
  { value: "status_text", label: "Employment status (Terminated means separated)" },
  { value: "team", label: "Team (created if missing)" },
  { value: "position", label: "Position (created if missing)" },
  { value: "pay_rate", label: "Pay rate (encrypted, HR only)" },
  { value: "pay_currency", label: "Pay currency" },
  { value: "pay_period", label: "Pay period (checked only)" },
  { value: "birth_date", label: "Birth date" },
  { value: "civil_status", label: "Civil status" },
  { value: "mobile", label: "Mobile phone" },
  { value: "address", label: "Address" },
  { value: "city", label: "City" },
  { value: "postal_code", label: "Postal code" },
  { value: "country", label: "Country" },
  { value: "emergency_name", label: "Emergency contact: name" },
  { value: "emergency_phone", label: "Emergency contact: phone" },
  { value: "emergency_relationship", label: "Emergency contact: relationship" },
] as const;

export type FixedDestination = (typeof DESTINATIONS)[number]["value"];
/** "custom:Label" saves the column as an HR-only custom field called Label. Custom fields are never for sensitive data. */
export type Destination = FixedDestination | `custom:${string}`;

const FIXED = new Set<string>(DESTINATIONS.map((d) => d.value));

export const isDestination = (v: string): v is Destination => FIXED.has(v) || (v.startsWith("custom:") && v.slice(7).trim().length >= 2 && v.length <= 80);

const norm = (h: string) => h.replace(/\*/g, "").replace(/^custom_fields:/i, "").trim().toLowerCase();

// Columns known from TalentHR's export. Anything sensitive or not needed by ELEVATE defaults to "Do not import".
const KNOWN: Record<string, Destination> = {
  "employee id": "id",
  "first name": "first_name",
  "last name": "last_name",
  email: "email",
  "supervisor id": "supervisor_id",
  "hire date": "hire_date",
  "termination date": "termination_date",
  "employment status": "status_text",
  department: "team",
  location: "custom:Location",
  division: "custom:Division",
  "job title": "position",
  "pay rate": "pay_rate",
  "pay rate currency": "pay_currency",
  "pay rate period": "pay_period",
  address: "address",
  city: "city",
  "postal code": "postal_code",
  country: "country",
  "marital status": "civil_status",
  "birth date": "birth_date",
  phone: "mobile",
  "emergency contact full name": "emergency_name",
  "emergency contact phone": "emergency_phone",
  "emergency contact relationship": "emergency_relationship",
  "shirt size": "custom:Shirt size",
  "onboarding date": "custom:Onboarding date",
  // Left out on purpose: gender, citizenship, avatar, free-text compensation and notes (sensitive), pay schedule, overtime, approvers
};

export function defaultMapping(headers: readonly string[]): Record<string, Destination> {
  const out: Record<string, Destination> = {};
  for (const h of headers) {
    // eslint-disable-next-line security/detect-object-injection -- looked up in a fixed table
    out[h] = KNOWN[norm(h)] ?? "ignore";
  }
  return out;
}

/** Problems with a mapping before any row is read. */
export function checkMapping(mapping: Record<string, string>, headers: readonly string[]): string[] {
  const problems: string[] = [];
  const used = new Map<string, string>();
  for (const h of headers) {
    // eslint-disable-next-line security/detect-object-injection -- h is one of this file's headers
    const d = mapping[h] ?? "ignore";
    if (!isDestination(d)) {
      problems.push(`"${h}" has an unknown destination.`);
      continue;
    }
    if (d === "ignore" || d.startsWith("custom:")) continue;
    const prior = used.get(d);
    if (prior) problems.push(`"${prior}" and "${h}" both go to the same place.`);
    else used.set(d, h);
  }
  for (const need of ["email", "first_name", "last_name"] as const) if (!used.has(need)) problems.push(`Choose which column holds the ${need.replace("_", " ")}.`);
  const customLabels = headers.flatMap((h) => {
    // eslint-disable-next-line security/detect-object-injection -- h is one of this file's headers
    const d = mapping[h];
    return d?.startsWith("custom:") ? [d.slice(7).trim().toLowerCase()] : [];
  });
  if (new Set(customLabels).size !== customLabels.length) problems.push("Two columns have the same custom field name.");
  return problems;
}
