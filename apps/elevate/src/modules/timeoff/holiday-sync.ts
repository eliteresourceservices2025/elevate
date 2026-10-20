import "server-only";
import { and, between, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { fetchNagerYear, type FetchLike, type HolidayCalendarCode } from "./holiday-nager";
import { holidays } from "./schema";

export type HolidaySyncResult = { added: number; alreadyThere: number; failed: string[] };

const CALENDARS: HolidayCalendarCode[] = ["PH", "US"];

/**
 * Adds the holidays Nager.Date lists that ELEVATE does not have yet, for the given years.
 * A day that already has ANY row on that calendar (even an archived one, or one HR renamed) is left alone: the
 * seeded and HR-edited rows win, and Nager's different spelling of the same day never creates a duplicate.
 * One failing year or calendar is reported in `failed` and never stops the rest. Not called with a signed-in
 * person (see importHolidays in actions.ts for the HR button); `actor` only goes on the audit row.
 */
export async function syncHolidays(years: number[], actor?: { id: string; email: string }, fetchImpl?: FetchLike): Promise<HolidaySyncResult> {
  const result: HolidaySyncResult = { added: 0, alreadyThere: 0, failed: [] };
  // The network calls run together (each has its own 10 s limit); the database writes then run one at a time.
  const wanted = [...new Set(years)].flatMap((year) => CALENDARS.map((calendar) => ({ year, calendar })));
  const fetched = await Promise.allSettled(wanted.map((w) => fetchNagerYear(w.year, w.calendar, fetchImpl)));
  for (const [i, { year, calendar }] of wanted.entries()) {
    const outcome = fetched[i];
    if (outcome.status === "rejected") {
      result.failed.push(`${calendar} ${year}: ${outcome.reason instanceof Error ? outcome.reason.message : "failed"}`);
      continue;
    }
    const candidates = outcome.value;
    if (candidates.length === 0) continue;
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ date: holidays.date })
        .from(holidays)
        .where(and(eq(holidays.calendar, calendar), between(holidays.date, `${year}-01-01`, `${year}-12-31`)));
      const taken = new Set(existing.map((r) => r.date));
      const fresh = candidates.filter((c) => !taken.has(c.date));
      result.alreadyThere += candidates.length - fresh.length;
      if (fresh.length === 0) return;
      const inserted = await tx.insert(holidays).values(fresh).onConflictDoNothing().returning({ id: holidays.id });
      result.added += inserted.length;
      await writeAudit({ actor: actor ?? null, action: "holiday.import", targetType: "holiday", metadata: { source: "nager.date", calendar, year, added: inserted.length } }, tx);
    });
  }
  return result;
}

/** The years the monthly job keeps filled: this year and next. */
export function holidayYearsToSync(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return [year, year + 1];
}
