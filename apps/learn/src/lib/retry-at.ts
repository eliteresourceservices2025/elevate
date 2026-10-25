/**
 * The database writes the time to wait until as 2026-10-25T06:44:20+00 (Postgres's "OF" prints the hours of the offset only), which
 * JavaScript cannot read: new Date() gave "Invalid Date", so the message said "You can try again at Invalid Date". This gives it the
 * minutes part so it is a normal ISO time; anything that still does not parse becomes null (the message then simply has no time).
 */
export function retryAtIso(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const fixed = detail.replace(/([+-]\d{2})$/, "$1:00");
  return Number.isNaN(Date.parse(fixed)) ? null : fixed;
}
