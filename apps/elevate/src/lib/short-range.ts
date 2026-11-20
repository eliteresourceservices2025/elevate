const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 16 to 30" inside one month, "Oct 28 to Nov 3" across two. Dates are YYYY-MM-DD. */
export function shortRange(start: string, end: string): string {
  const [, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  return sm === em ? `${MONTHS[sm - 1]} ${sd} to ${ed}` : `${MONTHS[sm - 1]} ${sd} to ${MONTHS[em - 1]} ${ed}`;
}
