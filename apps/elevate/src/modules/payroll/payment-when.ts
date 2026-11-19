import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// When a payment was sent and when it should reach the contractor. Dates are YYYY-MM-DD and times are HH:MM on the wall clock of a
// named zone, never converted when stored: what is typed is what is kept and shown, with the zone named. The time sent is always in
// the company zone (Arizona, where the payment is made); the expected arrival is in Arizona time too unless the person picks Manila.
// Pure: nothing here reads a clock.

export const PAYMENT_ZONES = ["America/Phoenix", "Asia/Manila"] as const;
export type PaymentZone = (typeof PAYMENT_ZONES)[number];
export const DEFAULT_PAYMENT_ZONE: PaymentZone = "America/Phoenix";

/** The short names shown beside a time. */
export const ZONE_LABELS: Record<PaymentZone, string> = { "America/Phoenix": "MST", "Asia/Manila": "PHT" };
/** The same zones named for a choice list. */
export const ZONE_CHOICES: { value: PaymentZone; label: string }[] = [
  { value: "America/Phoenix", label: "Arizona time (MST)" },
  { value: "Asia/Manila", label: "Manila time (PHT)" },
];

export const isPaymentZone = (v: unknown): v is PaymentZone => typeof v === "string" && (PAYMENT_ZONES as readonly string[]).includes(v);
/** A stored zone read back; anything unknown or missing is Arizona time. */
export const zoneOf = (v: unknown): PaymentZone => (isPaymentZone(v) ? v : DEFAULT_PAYMENT_ZONE);

const DAY = 86_400_000;
const parse = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const plain = (d: Date) => d.toISOString().slice(0, 10);

/** "Tue, Nov 25" for a date, then " · 9:30 AM MST" when a time is given. */
export function whenLabel(date: string, time: string | null | undefined, zone: PaymentZone = DEFAULT_PAYMENT_ZONE): string {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(parse(date));
  const t = time ? timeLabel(time) : null;
  return t ? `${day} · ${t} ${ZONE_LABELS[zone]}` : day;
}

/** "09:30" is "9:30 AM"; "14:05" is "2:05 PM". An unreadable value is shown as typed. */
export function timeLabel(time: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** The time column comes back as "09:30:00": the form and the labels use "09:30". */
export const hhmm = (time: string | null | undefined): string | null => (time ? time.slice(0, 5) : null);

/**
 * The same moment on the other zone's clock ("Mon, Nov 24 · 6:00 PM MST" for a Manila time), or null when no time was typed, the date
 * or time can't be read, or there is no other zone to show.
 */
export function inOtherZone(date: string, time: string | null | undefined, zone: PaymentZone): string | null {
  if (!time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01][0-9]|2[0-3]):[0-5][0-9]/.test(time)) return null;
  const other: PaymentZone = zone === "Asia/Manila" ? "America/Phoenix" : "Asia/Manila";
  const moment = fromZonedTime(`${date}T${time.slice(0, 5)}:00`, zone);
  if (Number.isNaN(moment.getTime())) return null;
  const day = formatInTimeZone(moment, other, "yyyy-MM-dd");
  const clock = formatInTimeZone(moment, other, "HH:mm");
  return whenLabel(day, clock, other);
}

/** Today, tomorrow and the coming Tuesday (never today itself) from a given day, for the quick picks beside the calendar. */
export function quickDates(today: string): { label: string; value: string }[] {
  const t = parse(today);
  const ahead = ((2 - t.getUTCDay() + 7) % 7) || 7;
  return [
    { label: "Today", value: today },
    { label: "Tomorrow", value: plain(new Date(t.getTime() + DAY)) },
    { label: "Next Tuesday", value: plain(new Date(t.getTime() + ahead * DAY)) },
  ];
}
