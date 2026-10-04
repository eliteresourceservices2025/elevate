import { normalizePayRate } from "@/modules/people/ids";
import { createEmployeeSchema, type CreateEmployeeInput } from "@/modules/people/validators";
import type { Destination } from "./mapping";

// Turns one row of a TalentHR export into what ELEVATE stores, and says what is wrong with it. Pure: no database.
// Issues name the field and the problem, never the value (they are stored and shown without the personal data).

export type Issue = { level: "error" | "warning"; field: string; message: string };
export type DateFormat = "mdy" | "dmy" | "iso";

export type NormalizedRow = {
  sourceId: string | null;
  supervisorSourceId: string | null;
  input: CreateEmployeeInput | null;
  teamName: string | null;
  positionTitle: string | null;
  pay: { rate: string; currency: string } | null;
  emergency: { name: string; phone: string; relationship: string } | null;
  custom: Record<string, string>;
  issues: Issue[];
};

const realDate = (y: number, m: number, d: number) => {
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || !t.toISOString().startsWith(iso) ? null : iso;
};

/** A date as YYYY-MM-DD, or null when it is not a real date in the chosen format. */
export function parseDate(value: string, format: DateFormat): string | null {
  const v = value.trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const sl = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!sl) return null;
  const [a, b, y] = [Number(sl[1]), Number(sl[2]), Number(sl[3])];
  return format === "dmy" ? realDate(y, b, a) : realDate(y, a, b);
}

let countryNames: Map<string, string> | null = null;
/** "United States" or "us" to "US". Null when the name is not recognised. */
export function countryCode(value: string): string | null {
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  if (!countryNames) {
    countryNames = new Map();
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = names.of(code);
        if (name && name !== code) countryNames.set(name.toLowerCase(), code);
      }
    countryNames.set("usa", "US");
    countryNames.set("u.s.a.", "US");
    countryNames.set("united states of america", "US");
  }
  return countryNames.get(v.toLowerCase()) ?? null;
}

const CIVIL: Record<string, string> = { single: "single", married: "married", widowed: "widowed", widow: "widowed", separated: "separated" };

const PHONE = /^\+?[0-9 ()-]{7,20}$/;

/** Reads one raw row through the column mapping. */
export function normalizeRow(raw: Record<string, string>, mapping: Record<string, string>, opts: { dateFormat: DateFormat; today: string }): NormalizedRow {
  const issues: Issue[] = [];
  const by: Partial<Record<Destination, string>> = {};
  const custom: Record<string, string> = {};
  for (const [header, dest] of Object.entries(mapping)) {
    // eslint-disable-next-line security/detect-object-injection -- header comes from the mapping, raw is a plain record
    const value = (raw[header] ?? "").trim();
    if (!value || dest === "ignore") continue;
    if (dest.startsWith("custom:")) custom[dest.slice(7).trim()] = value.slice(0, 500);
    else by[dest as Destination] = value;
    // The status text also stays visible to HR as a custom field
    if (dest === "status_text") custom["TalentHR employment status"] = value.slice(0, 80);
  }
  const get = (d: Destination) => by[d] ?? "";
  const date = (d: Destination, label: string): string | undefined => {
    const v = get(d);
    if (!v) return undefined;
    const out = parseDate(v, opts.dateFormat);
    if (!out) issues.push({ level: d === "birth_date" ? "warning" : "error", field: label, message: `${label} is not a date in the chosen format` });
    return out ?? undefined;
  };

  const startDate = date("hire_date", "Start date");
  let endDate = date("termination_date", "Last working day");
  const statusText = get("status_text");
  const terminated = /terminat|resign|separat|inactive/i.test(statusText) || Boolean(get("termination_date"));
  if (terminated && !endDate) {
    issues.push({ level: "error", field: "Last working day", message: "Marked as terminated but there is no usable termination date" });
    endDate = undefined;
  }
  const status = terminated ? "separated" : startDate && startDate > opts.today ? "onboarding" : "active";

  const civilRaw = get("civil_status").toLowerCase();
  let civilStatus: string | undefined;
  if (civilRaw) {
    civilStatus = CIVIL[civilRaw] ?? "other";
    if (!CIVIL[civilRaw]) issues.push({ level: "warning", field: "Civil status", message: "Not a known civil status, saved as other" });
  }

  const countryRaw = get("country");
  let country: string | undefined;
  if (countryRaw) {
    country = countryCode(countryRaw) ?? undefined;
    if (!country) issues.push({ level: "warning", field: "Country", message: "Country not recognised, left as Philippines" });
  }

  const mobileRaw = get("mobile");
  let mobile: string | undefined;
  if (mobileRaw) {
    if (PHONE.test(mobileRaw)) mobile = mobileRaw;
    else issues.push({ level: "warning", field: "Mobile phone", message: "Phone number format not accepted, left empty" });
  }

  let pay: NormalizedRow["pay"] = null;
  const rateRaw = get("pay_rate");
  if (rateRaw) {
    const rate = normalizePayRate(rateRaw);
    const currency = (get("pay_currency") || "PHP").toUpperCase();
    if (!rate) issues.push({ level: "error", field: "Pay rate", message: "Pay rate must be a number like 25000 or 25000.50" });
    else if (!/^[A-Z]{3}$/.test(currency)) issues.push({ level: "error", field: "Pay currency", message: "Currency must be a 3-letter code" });
    else pay = { rate, currency };
    const period = get("pay_period");
    if (period && !/^month/i.test(period)) issues.push({ level: "warning", field: "Pay period", message: "Pay period is not monthly: ELEVATE keeps the amount as given" });
  }

  let emergency: NormalizedRow["emergency"] = null;
  const en = get("emergency_name");
  const ep = get("emergency_phone");
  if (en || ep) {
    if (en && ep && PHONE.test(ep)) emergency = { name: en.slice(0, 120), phone: ep, relationship: (get("emergency_relationship") || "Other").slice(0, 60) };
    else issues.push({ level: "warning", field: "Emergency contact", message: "Needs a name and a valid phone number, not imported" });
  }

  const supervisorSourceId = get("supervisor_id") || null;
  const candidate = {
    legalFirstName: get("first_name"),
    legalLastName: get("last_name"),
    workEmail: get("email"),
    birthDate: date("birth_date", "Birth date"),
    civilStatus,
    mobile,
    addressLine: get("address") || undefined,
    city: get("city") || undefined,
    postalCode: get("postal_code") || undefined,
    country,
    status,
    workerType: "contractor",
    startDate,
    endDate: status === "separated" ? endDate : undefined,
  };
  const parsed = createEmployeeSchema.safeParse(candidate);
  let input: CreateEmployeeInput | null = null;
  if (parsed.success) input = parsed.data;
  else for (const i of parsed.error.issues) issues.push({ level: "error", field: String(i.path[0] ?? "Row"), message: i.message });

  return {
    sourceId: get("id") || null,
    supervisorSourceId,
    input,
    teamName: get("team") ? get("team").slice(0, 80) : null,
    positionTitle: get("position") ? get("position").slice(0, 80) : null,
    pay,
    emergency,
    custom,
    issues,
  };
}

/** Field names (never values) whose imported value differs from what ELEVATE already holds. */
export function changedFields(next: CreateEmployeeInput, current: Record<string, unknown>): string[] {
  const keys: (keyof CreateEmployeeInput)[] = ["legalFirstName", "legalLastName", "birthDate", "civilStatus", "mobile", "addressLine", "city", "postalCode", "country", "startDate", "endDate", "status"];
  const out: string[] = [];
  for (const k of keys) {
    // eslint-disable-next-line security/detect-object-injection -- k comes from the fixed list above
    const a = (next[k] ?? null) as unknown;
    // eslint-disable-next-line security/detect-object-injection -- k comes from the fixed list above
    const b = (current[k] ?? null) as unknown;
    if (a !== null && a !== b) out.push(k);
  }
  return out;
}
