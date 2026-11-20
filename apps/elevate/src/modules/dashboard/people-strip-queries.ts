import "server-only";
import { sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { anniversariesThisMonth, birthdaysThisMonth, monthDayLabel, shortName, type Celebrant } from "@/modules/people/celebrations";
import { todayInZone } from "@/modules/org/service";

// The "people" tiles: birthdays, anniversaries, new joiners and my team. Every colleague may see these (the same people the directory shows).
// A birthday is read as month and day only: the year is never selected from the database.

async function viewer() {
  const user = await requireUser();
  await authorize(user, "people.view_directory");
  await authorize(user, "dashboard.view", { ownerUserId: user.id });
  return user;
}

const LIVE = sql`e.archived_at is null and e.retention_archived_at is null and e.anonymized_at is null and e.status in ('onboarding', 'active', 'probation', 'on_leave')`;

type NameRow = { first: string; last: string; preferred: string | null };
const nameOf = (r: NameRow) => ({ first: r.preferred?.trim() || r.first, last: r.last });

/** Birthdays this month (month and day only) for everyone who has not hidden theirs, today's first. */
export async function getBirthdaysTile(): Promise<{ today: string; celebrants: Celebrant[] }> {
  await viewer();
  const today = todayInZone();
  const rows = (await db.execute(sql`
    select e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, to_char(e.birth_date, 'MM-DD') as month_day
    from core.employees e
    left join core.birthday_preferences b on b.employee_id = e.id
    where ${LIVE} and e.birth_date is not null and coalesce(b.hidden, false) = false
      and extract(month from e.birth_date)::int = ${Number(today.slice(5, 7))}`)) as unknown as (NameRow & { month_day: string })[];
  return { today, celebrants: birthdaysThisMonth(rows.map((r) => ({ ...nameOf(r), monthDay: r.month_day })), today) };
}

/** Work anniversaries of one year or more that fall in this month. */
export async function getAnniversariesTile(): Promise<Celebrant[]> {
  await viewer();
  const today = todayInZone();
  const rows = (await db.execute(sql`
    select e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, e.start_date::text as start_date
    from core.employees e
    where ${LIVE} and e.status <> 'onboarding' and e.start_date is not null and extract(month from e.start_date)::int = ${Number(today.slice(5, 7))}`)) as unknown as (NameRow & { start_date: string })[];
  return anniversariesThisMonth(rows.map((r) => ({ ...nameOf(r), startDate: r.start_date })), today);
}

export type Joiner = { name: string; label: string };

/** People who started in the last 30 days, newest first. */
export async function getNewJoinersTile(): Promise<Joiner[]> {
  await viewer();
  const today = todayInZone();
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 30);
  const rows = (await db.execute(sql`
    select e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, to_char(e.start_date, 'MM-DD') as month_day
    from core.employees e
    where ${LIVE} and e.start_date between ${since.toISOString().slice(0, 10)}::date and ${today}::date
    order by e.start_date desc, e.legal_last_name limit 6`)) as unknown as (NameRow & { month_day: string })[];
  return rows.map((r) => ({ name: shortName(nameOf(r).first, nameOf(r).last), label: monthDayLabel(r.month_day) }));
}

export type TeamMate = { name: string; lead: boolean };

/** The person's lead and the people who share that lead. Names only: no presence, hours or contact details. */
export async function getMyTeamTile(): Promise<TeamMate[]> {
  const user = await viewer();
  const [self] = (await db.execute(sql`select id, manager_id from core.employees where user_id = ${user.id} and archived_at is null limit 1`)) as unknown as { id: string; manager_id: string | null }[];
  if (!self?.manager_id) return [];
  const rows = (await db.execute(sql`
    select e.id::text as id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from core.employees e
    where ${LIVE} and e.id <> ${self.id}::uuid and (e.id = ${self.manager_id}::uuid or e.manager_id = ${self.manager_id}::uuid)
    order by (e.id = ${self.manager_id}::uuid) desc, e.legal_first_name limit 6`)) as unknown as (NameRow & { id: string })[];
  return rows.map((r) => ({ name: shortName(nameOf(r).first, nameOf(r).last), lead: r.id === self.manager_id }));
}
