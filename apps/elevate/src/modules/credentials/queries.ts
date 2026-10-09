import "server-only";
import { and, asc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageInfo } from "@/lib/pagination";
import { expiryStatus } from "@/modules/documents/expiry";
import { downlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { EXPIRING_WITHIN_DAYS, type CredentialStatus } from "./rules";
import { credentials } from "./schema";
import { isRenewed } from "./service";
import { listFiltersSchema, type ListFilters } from "./validators";

// Reads for the certificates page. Each starts with requireUser and works out the viewer itself: HR everything, a team lead their
// downline, an employee their own. Nobody else gets in.

const personName = (p: { first: string | null; last: string | null }) => `${p.last ?? ""}, ${p.first ?? ""}`.replace(/^, |, $/g, "").trim();
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type CredentialRow = {
  id: string;
  employeeId: string;
  person: string;
  name: string;
  issuedOn: string | null;
  expiresOn: string;
  status: CredentialStatus;
  /** A later certificate with the same name exists for this person, so this one is history. */
  renewed: boolean;
};

const columns = {
  id: credentials.id,
  employeeId: credentials.employeeId,
  name: credentials.name,
  issuedOn: credentials.issuedOn,
  expiresOn: credentials.expiresOn,
  first: employees.legalFirstName,
  last: employees.legalLastName,
};


type Raw = { id: string; employeeId: string; name: string; issuedOn: string | null; expiresOn: string; first: string | null; last: string | null; renewed: boolean };
function toRow(r: Raw, today: string): CredentialRow {
  const s = expiryStatus(r.expiresOn, today);
  return { id: r.id, employeeId: r.employeeId, person: personName(r), name: r.name, issuedOn: r.issuedOn, expiresOn: r.expiresOn, status: s === "none" ? "valid" : s, renewed: r.renewed };
}

async function requireAll(): Promise<void> {
  const user = await requireUser();
  if (scopeFor(user, "credentials.view") !== "all") throw new ForbiddenError("credentials.view");
}

/** HR list: every current certificate, soonest end date first, filtered by status and a search on the certificate or the person. */
export async function listCredentials(rawFilters: unknown, paging: { page: number; pageSize: number }): Promise<{ rows: CredentialRow[]; total: number; info: ReturnType<typeof pageInfo> }> {
  await requireAll();
  const parsed = listFiltersSchema.safeParse(rawFilters ?? {});
  const f: ListFilters = parsed.success ? parsed.data : {};
  const today = todayInZone();
  const soon = addDays(today, EXPIRING_WITHIN_DAYS);
  const q = f.q ? `%${escapeLike(f.q)}%` : null;
  const where = and(
    isNull(credentials.archivedAt),
    isNull(employees.archivedAt),
    f.status === "expired" ? lt(credentials.expiresOn, today) : undefined,
    f.status === "expiring" ? and(gte(credentials.expiresOn, today), lte(credentials.expiresOn, soon)) : undefined,
    f.status === "valid" ? sql`${credentials.expiresOn} > ${soon}` : undefined,
    // Expired and expiring lists are about what needs action now, so a certificate that was renewed is left out of them.
    f.status === "expired" || f.status === "expiring" ? sql`not ${isRenewed()}` : undefined,
    q ? or(ilike(credentials.name, q), ilike(employees.legalFirstName, q), ilike(employees.legalLastName, q)) : undefined,
  );
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(credentials).innerJoin(employees, eq(employees.id, credentials.employeeId)).where(where);
  const info = pageInfo(n, paging.page, paging.pageSize);
  const rows = await db
    .select({ ...columns, renewed: sql<boolean>`${isRenewed()}` })
    .from(credentials)
    .innerJoin(employees, eq(employees.id, credentials.employeeId))
    .where(where)
    .orderBy(asc(credentials.expiresOn), asc(employees.legalLastName))
    .limit(info.pageSize)
    .offset(info.offset);
  return { total: n, info, rows: rows.map((r) => toRow(r, today)) };
}

/** Counts for the HR header and the dashboard: certificates that need action (the newest of each kind per person, people still on the team). */
export async function credentialCounts(): Promise<{ expired: number; expiring: number }> {
  await requireAll();
  return currentCounts();
}

/** The same counts without a signed-in check, for code that already authorized (the dashboard). */
export async function currentCounts(): Promise<{ expired: number; expiring: number }> {
  const today = todayInZone();
  const soon = addDays(today, EXPIRING_WITHIN_DAYS);
  const rows = await db
    .select({ expiresOn: credentials.expiresOn })
    .from(credentials)
    .innerJoin(employees, eq(employees.id, credentials.employeeId))
    .where(and(isNull(credentials.archivedAt), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`, lte(credentials.expiresOn, soon), sql`not ${isRenewed()}`));
  let expired = 0;
  let expiring = 0;
  for (const r of rows) {
    if (r.expiresOn < today) expired++;
    else expiring++;
  }
  return { expired, expiring };
}

/** The signed-in person's own certificates. */
export async function getMyCredentials(): Promise<CredentialRow[]> {
  const user = await requireUser();
  if (!scopeFor(user, "credentials.view")) throw new ForbiddenError("credentials.view");
  const today = todayInZone();
  const rows = await db
    .select({ ...columns, renewed: sql<boolean>`${isRenewed()}` })
    .from(credentials)
    .innerJoin(employees, eq(employees.id, credentials.employeeId))
    .where(and(eq(employees.userId, user.id), isNull(credentials.archivedAt)))
    .orderBy(asc(credentials.expiresOn));
  return rows.map((r) => toRow(r, today));
}

/** A team lead's downline (view only). HR reads the full list instead, so it is refused for them. */
export async function listTeamCredentials(): Promise<CredentialRow[]> {
  const user = await requireUser();
  if (scopeFor(user, "credentials.view") !== "team") throw new ForbiddenError("credentials.view");
  const ids = await downlineEmployeeIds(db, user.id);
  if (ids.length === 0) return [];
  const today = todayInZone();
  const rows = await db
    .select({ ...columns, renewed: sql<boolean>`${isRenewed()}` })
    .from(credentials)
    .innerJoin(employees, eq(employees.id, credentials.employeeId))
    .where(and(inArray(credentials.employeeId, ids), isNull(credentials.archivedAt)))
    .orderBy(asc(credentials.expiresOn), asc(employees.legalLastName));
  return rows.map((r) => toRow(r, today));
}

/** People HR can record a certificate for: everyone not archived and not separated. */
export async function listCredentialPeople(): Promise<{ id: string; label: string }[]> {
  await requireAll();
  const rows = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, status: employees.status })
    .from(employees)
    .where(isNull(employees.archivedAt))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  return rows.filter((r) => r.status !== "separated").map((r) => ({ id: r.id, label: personName(r) }));
}
