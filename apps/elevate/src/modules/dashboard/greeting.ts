/** "Good morning" and friends, from the hour (0 to 23) in the person's own time zone. */
export function greetingFor(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The hour (0 to 23) it is right now in a zone. */
export function hourInZone(now: Date, zone: string): number {
  const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: zone }).format(now);
  return Number(h) % 24;
}
