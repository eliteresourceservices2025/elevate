// When a payment was sent and when it should reach the contractor. Dates are YYYY-MM-DD and times are HH:MM on the wall clock in
// Manila (the contractor's side of the transfer), never converted: what is typed is what is stored and shown, with the zone named.
// Pure: nothing here reads a clock.

export const PAYMENT_ZONE_LABEL = "PHT";

const DAY = 86_400_000;
const parse = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const plain = (d: Date) => d.toISOString().slice(0, 10);

/** "Tue, Nov 25" for a date, then " · 9:30 AM PHT" when a time is given. */
export function whenLabel(date: string, time: string | null | undefined): string {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(parse(date));
  const t = time ? timeLabel(time) : null;
  return t ? `${day} · ${t} ${PAYMENT_ZONE_LABEL}` : day;
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
