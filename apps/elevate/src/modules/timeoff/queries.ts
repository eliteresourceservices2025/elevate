import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { ForbiddenError, authorize, can, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { downlineEmployeeIds, managerChainUserIds, reportName, todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { balanceOf, unusedByPool, type LedgerEntryType } from "./ledger";
import { holidays, leaveTypes } from "./schema";
import { holidayCalendarsFor, loadLedger } from "./service";

// Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

export type LeaveTypeRow = { id: string; slug: string; name: string; tracksBalance: boolean; skipHr: boolean; archived: boolean };

export async function listLeaveTypes(): Promise<LeaveTypeRow[]> {
  const user = await requireUser();
  await authorize(user, "timeoff.manage_types");
  const rows = await db.select().from(leaveTypes).orderBy(asc(leaveTypes.name));
  return rows.map((t) => ({ id: t.id, slug: t.slug, name: t.name, tracksBalance: t.tracksBalance, skipHr: t.skipHr, archived: t.archivedAt !== null }));
}

export type BalanceCard = {
  leaveTypeId: string;
  leaveTypeName: string;
  balance: number;
  /** Days that will expire if not used, soonest first. */
  expiring: { expiresOn: string; days: number }[];
};

export type LedgerLine = {
  id: string;
  leaveTypeName: string;
  entryType: LedgerEntryType;
  days: number;
  reason: string | null;
  effectiveOn: string;
  expiresOn: string | null;
  /** "HR", "System", or "You" for entries the viewer made; other people are not named. */
  by: string;
};

export type PersonTimeOff = {
  employeeId: string;
  name: string;
  employeeNumber: string;
  cards: BalanceCard[];
  lines: LedgerLine[];
};

/** Balances and the full ledger for one person. The caller has already authorized access to this person. */
async function buildPersonTimeOff(employeeId: string, name: string, employeeNumber: string, viewerId: string): Promise<PersonTimeOff> {
  const today = todayInZone();
  const types = await db.select().from(leaveTypes).where(eq(leaveTypes.tracksBalance, true)).orderBy(asc(leaveTypes.name));
  const cards: BalanceCard[] = [];
  const lines: LedgerLine[] = [];

  for (const type of types) {
    const rows = await loadLedger(db, employeeId, type.id);
    if (type.archivedAt && rows.length === 0) continue;
    const unused = unusedByPool(rows, today);
    cards.push({
      leaveTypeId: type.id,
      leaveTypeName: type.name,
      balance: balanceOf(rows),
      expiring: rows
        .filter((r) => r.entryType === "award" && r.expiresOn && r.expiresOn >= today && (unused.get(r.id) ?? 0) > 0)
        .map((r) => ({ expiresOn: r.expiresOn!, days: unused.get(r.id)! }))
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)),
    });
  }

  const raw = (await db.execute(sql`
    select l.id, t.name as type_name, l.entry_type, l.days::float8 as days, l.reason, l.effective_on::text as effective_on,
           l.expires_on::text as expires_on, l.created_by
    from time.leave_ledger l join time.leave_types t on t.id = l.leave_type_id
    where l.employee_id = ${employeeId}
    order by l.created_at desc, l.id`)) as unknown as {
    id: string; type_name: string; entry_type: LedgerEntryType; days: number; reason: string | null; effective_on: string; expires_on: string | null; created_by: string | null;
  }[];
  for (const r of raw) {
    lines.push({
      id: r.id,
      leaveTypeName: r.type_name,
      entryType: r.entry_type,
      days: Number(r.days),
      reason: r.reason,
      effectiveOn: r.effective_on,
      expiresOn: r.expires_on,
      by: r.created_by === null ? "System" : r.created_by === viewerId ? "You" : "HR",
    });
  }
  return { employeeId, name, employeeNumber, cards, lines };
}

/** The signed-in person's own balances and ledger. Null when they have no people record. */
export async function getMyTimeOff(): Promise<PersonTimeOff | null> {
  const user = await requireUser();
  await authorize(user, "timeoff.view_balance", { ownerUserId: user.id });
  const [me] = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, number: employees.employeeNumber })
    .from(employees)
    .where(and(eq(employees.userId, user.id), isNull(employees.archivedAt)))
    .limit(1);
  if (!me) return null;
  return buildPersonTimeOff(me.id, reportName({ first: me.first, last: me.last, preferred: me.preferred }), me.number, user.id);
}

/** One person's balances and ledger: their own, their downline's (Team Lead), or anyone's (HR). Null if not found. */
export async function getPersonTimeOff(employeeId: string): Promise<PersonTimeOff | null> {
  const user = await requireUser();
  if (!scopeFor(user, "timeoff.view_balance")) throw new ForbiddenError("timeoff.view_balance"); // no role that could ever see anyone
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) return null;
  const [e] = await db
    .select({ id: employees.id, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, number: employees.employeeNumber })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!e) return null;
  await authorize(user, "timeoff.view_balance", { ownerUserId: e.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, e.id) });
  return buildPersonTimeOff(e.id, reportName({ first: e.first, last: e.last, preferred: e.preferred }), e.number, user.id);
}

export type BalanceOverviewRow = {
  employeeId: string;
  name: string;
  employeeNumber: string;
  team: string | null;
  balance: number;
  nextExpiry: string | null;
};

/** Who holds prize days, and the next date any of them expire. HR sees everyone; a Team Lead their downline. */
export async function listBalances(): Promise<{ rows: BalanceOverviewRow[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "timeoff.view_overview");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("timeoff.view_overview");
  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { rows: [], scope };

  const today = todayInZone();
  const filter = restrict ? sql`and e.id in (${sql.join(restrict.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const raw = (await db.execute(sql`
    select e.id, e.employee_number, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, tm.name as team,
           sum(l.days)::float8 as balance,
           min(l.expires_on) filter (where l.entry_type = 'award' and l.expires_on >= ${today}::date) ::text as next_expiry
    from time.leave_ledger l
    join time.leave_types t on t.id = l.leave_type_id and t.tracks_balance
    join core.employees e on e.id = l.employee_id
    left join core.teams tm on tm.id = e.team_id
    where e.archived_at is null and e.status <> 'separated' ${filter}
    group by e.id, tm.name
    order by sum(l.days) desc, e.legal_last_name`)) as unknown as {
    id: string; employee_number: string; first: string; last: string; preferred: string | null; team: string | null; balance: number; next_expiry: string | null;
  }[];
  return {
    scope,
    rows: raw.map((r) => ({
      employeeId: r.id,
      name: reportName({ first: r.first, last: r.last, preferred: r.preferred }),
      employeeNumber: r.employee_number,
      team: r.team,
      balance: Number(r.balance),
      nextExpiry: r.next_expiry,
    })),
  };
}

/** People and balance-tracking leave types HR can pick when awarding or adjusting. */
export async function getAwardOptions() {
  const user = await requireUser();
  await authorize(user, "timeoff.award");
  const people = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, number: employees.employeeNumber })
    .from(employees)
    .where(and(isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  const types = await db.select({ id: leaveTypes.id, name: leaveTypes.name }).from(leaveTypes).where(and(eq(leaveTypes.tracksBalance, true), isNull(leaveTypes.archivedAt))).orderBy(asc(leaveTypes.name));
  return {
    people: people.map((p) => ({ id: p.id, label: `${reportName({ first: p.first, last: p.last, preferred: p.preferred })} (${p.number})` })),
    types,
  };
}

export type HolidayRow = { id: string; calendar: "PH" | "US"; date: string; name: string; kind: string; verified: boolean };

/**
 * Holidays for a year. Everyone may view; people who are not HR see the calendars that apply to them
 * (the Philippines plus their clients'), HR sees both and can manage them.
 */
export async function getHolidays(year: number): Promise<{ rows: HolidayRow[]; calendars: ("PH" | "US")[]; canManage: boolean }> {
  const user = await requireUser();
  await authorize(user, "timeoff.view_holidays");
  const canManage = can(user, "timeoff.manage_holidays");
  const [me] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id)).limit(1);
  const calendars: ("PH" | "US")[] = canManage || !me ? ["PH", "US"] : await holidayCalendarsFor(db, me.id);

  const y = Math.min(2100, Math.max(2000, Math.trunc(year)));
  const rows = await db
    .select()
    .from(holidays)
    .where(and(isNull(holidays.archivedAt), sql`${holidays.date} >= ${`${y}-01-01`}::date and ${holidays.date} <= ${`${y}-12-31`}::date`))
    .orderBy(asc(holidays.date), asc(holidays.calendar));
  return {
    calendars,
    canManage,
    rows: rows
      .filter((h) => (calendars as string[]).includes(h.calendar))
      .map((h) => ({ id: h.id, calendar: h.calendar === "PH" ? "PH" : "US", date: h.date, name: h.name, kind: h.kind, verified: h.verified })),
  };
}
