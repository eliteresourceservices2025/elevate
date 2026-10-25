/** 2026-11-13 as Nov 13, 2026 (dates in the database are plain days, so no time zone shift). Anything that is not a day comes back as it was. */
export const readableDay = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
