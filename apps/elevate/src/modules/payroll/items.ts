import { EXTRA_KEYS, type ItemLine, type LineInput } from "./calculate";
import { EXTRA_KEY_ITEM, ITEMIZED_TYPES, type ItemizedType, type PayItemType } from "./constants";
import { formatPesos, parseMoney } from "./money";

// Run items: what a Preparer types for one pay line in one run, and how those values become calculator input. Pure.
// The calculator has no input guards, so every value is checked here: whole minutes, day hundredths and non-negative money only.

type Unit = "minutes" | "days" | "hours" | "money";

const UNIT: Record<PayItemType, Unit> = {
  absence_days: "days",
  sick_leave_days: "days",
  bereavement_days: "days",
  pto_days: "days",
  late_minutes: "minutes",
  partial_days: "days",
  partial_minutes: "minutes",
  extra_regular: "minutes",
  extra_rest_day: "minutes",
  extra_rest_day_over_8: "minutes",
  holiday: "minutes",
  allowance: "money",
  reimbursement: "money",
  bonus: "money",
  adjustment: "money",
  loan: "money",
  other_deduction: "money",
  client_hours: "hours",
};

const MAX_MINUTES = 44_640n; // 31 days
const MAX_DAY_HUNDREDTHS = 3_100n;
const MAX_HOUR_HUNDREDTHS = 74_400n; // 744 hours

export const itemUnit = (type: PayItemType): Unit => UNIT[type]; // eslint-disable-line security/detect-object-injection

/**
 * A length of time typed by a person, in whole minutes, or null when it is not clearly one. Accepts "90", "90m", "90 min", "1.5h",
 * "1.5 hours", "1h30m", "1 h 30 min" and "1:30". A plain number is minutes.
 */
export function parseDuration(raw: string): bigint | null {
  const text = raw.trim().toLowerCase();
  if (/^\d{1,6}$/.test(text)) return BigInt(text);
  const clock = /^(\d{1,3}):(\d{1,2})$/.exec(text);
  if (clock) return Number(clock[2]) < 60 ? BigInt(Number(clock[1]) * 60 + Number(clock[2])) : null;
  const decimalHours = /^(\d{1,3}(?:\.\d{1,2})?)\s*h(?:ours?|rs?)?$/.exec(text);
  if (decimalHours) return BigInt(Math.round(Number(decimalHours[1]) * 60));
  const parts = /^(?:(\d{1,3})\s*h(?:ours?|rs?)?)?\s*(?:(\d{1,4})\s*m(?:in(?:ute)?s?)?)?$/.exec(text);
  if (parts && (parts[1] !== undefined || parts[2] !== undefined)) return BigInt(Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0));
  return null;
}

/** Minutes as people read them: 45 -> "45 min", 90 -> "1 h 30 min", 120 -> "2 h". */
export function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} h` : "", m > 0 || h === 0 ? `${m} min` : ""].filter(Boolean).join(" ");
}

export const ITEM_UNIT_HINTS: Record<Unit, string> = {
  minutes: "Hours or minutes, like 1.5 h, 90 m or 1:30. A plain number is minutes.",
  days: "Days, like 1 or 0.5.",
  hours: "Hours, like 86 or 86.5.",
  money: "An amount like 1,250.50.",
};

/** A typed value in the item's smallest unit (minutes, hundredths of a day or hour, centavos or cents), or null when it isn't clearly valid. */
export function parseItemValue(type: PayItemType, raw: string): bigint | null {
  const text = raw.trim();
  switch (itemUnit(type)) {
    case "minutes": {
      const n = parseDuration(text);
      return n !== null && n >= 1n && n <= MAX_MINUTES ? n : null;
    }
    case "days":
    case "hours": {
      const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text);
      if (!match) return null;
      const n = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
      return n >= 1n && n <= (UNIT[type] === "days" ? MAX_DAY_HUNDREDTHS : MAX_HOUR_HUNDREDTHS) ? n : null; // eslint-disable-line security/detect-object-injection
    }
    case "money": {
      const n = parseMoney(text);
      return n !== null && n > 0n ? n : null;
    }
  }
}

/** A stored value as people type it ("1.5" days, "1,250.50"). */
export function formatItemValue(type: PayItemType, value: bigint): string {
  switch (itemUnit(type)) {
    case "minutes":
      return minutesText(Number(value));
    case "days":
    case "hours": {
      const whole = value / 100n;
      const cents = value % 100n;
      if (cents === 0n) return whole.toString();
      return `${whole}.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
    }
    default:
      return formatPesos(value);
  }
}

/** The longest name an itemized line may have. */
export const MAX_ITEM_LABEL = 60;

/** A typed line name: one line of plain text, or null when it is empty or too long. */
export function cleanItemLabel(raw: string): string | null {
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length >= 1 && text.length <= MAX_ITEM_LABEL ? text : null;
}

export type LineRate = { monthlyCentavos: bigint };

export type ItemizedLines = Record<ItemizedType, ItemLine[]>;
export const noItemizedLines = (): ItemizedLines => Object.fromEntries(ITEMIZED_TYPES.map((t) => [t, []])) as unknown as ItemizedLines;

/**
 * Calculator input for one line: the line's own rate, then the confirmed items (newest per type) and the itemized lines (each named
 * line is its own item). Client hours are reference only and are returned beside the input, never inside it.
 */
export function buildLineInput(
  rate: LineRate,
  hoursPerDay: number,
  items: ReadonlyMap<PayItemType, bigint>,
  itemized: ItemizedLines = noItemizedLines(),
): { input: LineInput; clientHoursHundredths: bigint } {
  const get = (t: PayItemType) => items.get(t);
  const minutes = (t: PayItemType) => Number(get(t) ?? 0n);

  const extra = {} as LineInput["extra"];
  for (const key of EXTRA_KEYS) extra[key] = minutes(EXTRA_KEY_ITEM[key]); // eslint-disable-line security/detect-object-injection

  const partialDays = minutes("partial_days");
  const partialMinutes = minutes("partial_minutes");
  return {
    input: {
      monthlyCentavos: rate.monthlyCentavos,
      hoursPerDay,
      partial: partialDays > 0 || partialMinutes > 0 ? { dayHundredths: partialDays, minutes: partialMinutes } : null,
      absenceDayHundredths: minutes("absence_days"),
      sickLeaveDayHundredths: minutes("sick_leave_days"),
      bereavementDayHundredths: minutes("bereavement_days"),
      ptoDayHundredths: minutes("pto_days"),
      lateMinutes: minutes("late_minutes"),
      extra,
      allowances: itemized.allowance,
      reimbursements: itemized.reimbursement,
      bonuses: itemized.bonus,
      adjustments: itemized.adjustment,
      loan: get("loan") ?? 0n,
      otherDeductions: get("other_deduction") ?? 0n,
    },
    clientHoursHundredths: get("client_hours") ?? 0n,
  };
}
