import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userRoles, users } from "@/modules/core/schema";
import { hrUserIds, notify, type NewNotification } from "@/modules/notifications/service";
import { managerChainUserIds, reportName } from "@/modules/org/service";
import { dueAnniversary, yearsText } from "./anniversary";
import { anniversaryNotices, employees } from "./schema";

export type AnniversaryRun = { due: number; recipients: number };

const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const when = (iso: string) => MONTH_DAY.format(new Date(`${iso}T00:00:00Z`));

/**
 * Daily: seven days before someone's work anniversary (one year or more) Super Admin, HR, every recruiter and the person's leads who
 * hold the Team Lead role are told, in one notice per recipient listing who and when. Once per person and year (the row is the claim),
 * and a missed day is made up until the day before. People who have left, and people with no start date, are skipped.
 */
export async function runAnniversaryReminders(today: string): Promise<AnniversaryRun> {
  const candidates = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, startDate: employees.startDate })
    .from(employees)
    .where(and(isNull(employees.archivedAt), eq(employees.status, "active"), sql`${employees.startDate} is not null`));

  type Item = { id: string; name: string; years: number; date: string };
  const due: Item[] = [];
  for (const c of candidates) {
    const d = dueAnniversary(c.startDate, today);
    if (!d) continue;
    due.push({ id: c.id, name: reportName({ first: c.first, last: c.last, preferred: c.preferred }), years: d.years, date: d.date });
  }
  if (due.length === 0) return { due: 0, recipients: 0 };

  // Claim each one; whoever claims it sends it (a second run claims nothing).
  const claimed: Item[] = [];
  for (const item of due) {
    const year = Number(item.date.slice(0, 4));
    const rows = await db.insert(anniversaryNotices).values({ employeeId: item.id, year }).onConflictDoNothing().returning({ employeeId: anniversaryNotices.employeeId });
    if (rows.length > 0) claimed.push(item);
  }
  if (claimed.length === 0) return { due: 0, recipients: 0 };

  // Who hears about whom: HR and Super Admin and recruiters about everyone; leads about the people below them.
  const everyone = new Set<string>(await hrUserIds());
  const recruiters = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleSlug, "recruiter"), isNull(users.archivedAt)));
  for (const r of recruiters) everyone.add(r.id);

  const byRecipient = new Map<string, Item[]>();
  const add = (userId: string, item: Item) => byRecipient.set(userId, [...(byRecipient.get(userId) ?? []), item]);
  for (const userId of everyone) for (const item of claimed) add(userId, item);

  for (const item of claimed) {
    const chain = await managerChainUserIds(db, item.id);
    if (chain.length === 0) continue;
    const leads = await db
      .selectDistinct({ id: userRoles.userId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(inArray(userRoles.userId, chain), eq(userRoles.roleSlug, "team_lead"), isNull(users.archivedAt)));
    for (const l of leads) if (!everyone.has(l.id)) add(l.id, item);
  }

  const notes: NewNotification[] = [...byRecipient.entries()].map(([userId, items]) => {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    return {
      userId,
      kind: "anniversary.upcoming",
      title: sorted.length === 1 ? `Work anniversary coming up: ${sorted[0].name}` : `${sorted.length} work anniversaries coming up`,
      body: sorted.map((i) => `${i.name}: ${yearsText(i.years)} on ${when(i.date)}`).join("; "),
      link: sorted.length === 1 ? `/people/${sorted[0].id}` : "/dashboard",
    };
  });
  await notify(db, notes);
  return { due: claimed.length, recipients: notes.length };
}
