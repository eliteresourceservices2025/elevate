import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { managerChainUserIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { addDays } from "./schedule";
import { hoursMarks } from "./schema";
import { lockEmployeeClock, prefsFor } from "./service";

// "Test only" marks for hours review. Callers sign the person in first (hours-actions.ts); this authorizes the reach again.

type Actor = { id: string; roles: readonly string[] } & Record<string, unknown>;

/** How far back a day can be marked: a test is noticed within days, and an old payroll period is not reopened by a mark. */
export const MAX_MARK_AGE_DAYS = 90;

/**
 * Marks one person's day "test only" (with a note), or takes the mark off. The day stays in the clock history; it is left out of hours
 * review, the export and the unapproved counts while marked. Append-only: every change is a new row, and the audit log names who.
 */
export async function setTestMark(actor: Actor, input: { employeeId: string; date: string; testOnly: boolean; note: string }): Promise<void> {
  const [person] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, input.employeeId));
  if (!person) throw new ActionFailure("That person was not found.");
  await authorize(actor as never, "hours.mark_test", { ownerUserId: person.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, input.employeeId) });

  const prefs = await prefsFor(db, input.employeeId);
  const today = formatInZone(new Date(), prefs.zone, "yyyy-MM-dd");
  if (input.date > today) throw new ActionFailure("That day has not happened yet.");
  if (input.date < addDays(today, -MAX_MARK_AGE_DAYS)) throw new ActionFailure(`Days can be marked up to ${MAX_MARK_AGE_DAYS} days back. Ask HR.`);

  await db.transaction(async (tx) => {
    await lockEmployeeClock(tx, input.employeeId);
    const [day] = (await tx.execute(sql`select 1 as ok from time.attendance_days where employee_id = ${input.employeeId} and date = ${input.date}::date limit 1`)) as unknown as { ok: number }[];
    if (!day) throw new ActionFailure("There are no hours recorded on that day yet. The day appears the morning after the clock-in.");
    const [latest] = await tx
      .select({ testOnly: hoursMarks.testOnly })
      .from(hoursMarks)
      .where(and(eq(hoursMarks.employeeId, input.employeeId), eq(hoursMarks.date, input.date)))
      .orderBy(sql`${hoursMarks.setAt} desc, ${hoursMarks.id} desc`)
      .limit(1);
    const marked = latest?.testOnly === true;
    if (input.testOnly && marked) throw new ActionFailure("That day is already marked test only.");
    if (!input.testOnly && !marked) throw new ActionFailure("That day is not marked test only.");

    await tx.insert(hoursMarks).values({ employeeId: input.employeeId, date: input.date, testOnly: input.testOnly, note: input.note, setBy: actor.id });
    await writeAudit({ actor: actor as never, action: input.testOnly ? "hours.mark_test" : "hours.clear_test", targetType: "employee", targetId: input.employeeId, after: { date: input.date } }, tx);
    if (person.userId && person.userId !== actor.id) {
      await notify(tx, {
        userId: person.userId,
        kind: "hours.test_marked",
        title: input.testOnly ? "A day of yours was marked test only" : "A test-only mark was taken off your day",
        body: input.testOnly ? `${input.date}: ${input.note}. It is left out of hours review and payroll.` : `${input.date}. It counts as normal hours again.`,
        link: "/attendance",
      });
    }
  });
}
