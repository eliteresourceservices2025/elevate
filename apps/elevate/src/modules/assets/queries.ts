import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageInfo } from "@/lib/pagination";
import { downlineEmployeeIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { assignability, canArchive, normalizeTag, type AssetStatus, type Category, type Condition } from "./constants";
import { assetAssignments, assets } from "./schema";
import { listFiltersSchema, type ListFilters } from "./validators";

// Reads for the assets pages. Each starts with requireUser and works out the viewer itself: HR everything, a team lead what is
// assigned to their downline, an employee what is (or was) assigned to them. Nobody else gets in.

const personName = (p: { first: string | null; last: string | null }) => `${p.first ?? ""} ${p.last ?? ""}`.trim();
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export type AssetRow = {
  id: string;
  tag: string;
  name: string;
  category: Category;
  status: AssetStatus;
  archived: boolean;
  holder: { employeeId: string; name: string } | null;
};

async function requireAll(): Promise<void> {
  const user = await requireUser();
  if (scopeFor(user, "assets.view") !== "all") throw new ForbiddenError("assets.view");
}

/** HR inventory: filtered by status, category and a search on tag, name or serial number, one page at a time. */
export async function listAssets(rawFilters: unknown, paging: { page: number; pageSize: number }): Promise<{ rows: AssetRow[]; total: number; info: ReturnType<typeof pageInfo> }> {
  await requireAll();
  const parsed = listFiltersSchema.safeParse(rawFilters ?? {});
  const f: ListFilters = parsed.success ? parsed.data : {};
  const conditions = [
    f.archived ? isNotNull(assets.archivedAt) : isNull(assets.archivedAt),
    ...(f.status ? [eq(assets.status, f.status)] : []),
    ...(f.category ? [eq(assets.category, f.category)] : []),
    ...(f.q ? [or(ilike(assets.tag, `%${escapeLike(f.q)}%`), ilike(assets.name, `%${escapeLike(f.q)}%`), ilike(assets.serialNumber, `%${escapeLike(f.q)}%`))] : []),
  ];
  const where = and(...conditions);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(where);
  const info = pageInfo(n, paging.page, paging.pageSize);
  const rows = await db
    .select({
      id: assets.id,
      tag: assets.tag,
      name: assets.name,
      category: assets.category,
      status: assets.status,
      archivedAt: assets.archivedAt,
      holderId: employees.id,
      first: employees.legalFirstName,
      last: employees.legalLastName,
    })
    .from(assets)
    .leftJoin(assetAssignments, and(eq(assetAssignments.assetId, assets.id), isNull(assetAssignments.returnedAt)))
    .leftJoin(employees, eq(employees.id, assetAssignments.employeeId))
    .where(where)
    .orderBy(asc(assets.tag))
    .limit(info.pageSize)
    .offset(info.offset);
  return {
    total: n,
    info,
    rows: rows.map((r) => ({ id: r.id, tag: r.tag, name: r.name, category: r.category as Category, status: r.status as AssetStatus, archived: r.archivedAt !== null, holder: r.holderId ? { employeeId: r.holderId, name: personName(r) } : null })),
  };
}

/** Counts by status for the HR inventory header. */
export async function assetStatusCounts(): Promise<Record<AssetStatus, number>> {
  await requireAll();
  const rows = await db.select({ status: assets.status, n: sql<number>`count(*)::int` }).from(assets).where(isNull(assets.archivedAt)).groupBy(assets.status);
  const out: Record<AssetStatus, number> = { in_stock: 0, assigned: 0, repair: 0, lost: 0, retired: 0 };
  for (const r of rows) out[r.status as AssetStatus] = r.n;
  return out;
}

export type HeldRow = { tag: string; name: string; category: Category; assignedAt: Date; condition: Condition; holder: string | null };

/** What is with the signed-in person right now. Anyone who may view assets sees their own; nothing else. */
export async function getMyAssets(): Promise<HeldRow[]> {
  const user = await requireUser();
  if (!scopeFor(user, "assets.view")) throw new ForbiddenError("assets.view");
  const rows = await db
    .select({ tag: assets.tag, name: assets.name, category: assets.category, assignedAt: assetAssignments.assignedAt, condition: assetAssignments.conditionOut })
    .from(assetAssignments)
    .innerJoin(assets, eq(assets.id, assetAssignments.assetId))
    .innerJoin(employees, eq(employees.id, assetAssignments.employeeId))
    .where(and(eq(employees.userId, user.id), isNull(assetAssignments.returnedAt)))
    .orderBy(desc(assetAssignments.assignedAt));
  return rows.map((r) => ({ tag: r.tag, name: r.name, category: r.category as Category, assignedAt: r.assignedAt, condition: r.condition as Condition, holder: null }));
}

/** What is assigned to a team lead's downline right now (view only). HR gets the whole inventory instead, so it is refused for them. */
export async function listTeamAssets(): Promise<HeldRow[]> {
  const user = await requireUser();
  if (scopeFor(user, "assets.view") !== "team") throw new ForbiddenError("assets.view");
  const ids = await downlineEmployeeIds(db, user.id);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ tag: assets.tag, name: assets.name, category: assets.category, assignedAt: assetAssignments.assignedAt, condition: assetAssignments.conditionOut, first: employees.legalFirstName, last: employees.legalLastName })
    .from(assetAssignments)
    .innerJoin(assets, eq(assets.id, assetAssignments.assetId))
    .innerJoin(employees, eq(employees.id, assetAssignments.employeeId))
    .where(and(inArray(assetAssignments.employeeId, ids), isNull(assetAssignments.returnedAt)))
    .orderBy(asc(employees.legalLastName), asc(assets.tag));
  return rows.map((r) => ({ tag: r.tag, name: r.name, category: r.category as Category, assignedAt: r.assignedAt, condition: r.condition as Condition, holder: personName(r) }));
}

export type HistoryRow = {
  id: string;
  employeeId: string;
  person: string;
  assignedAt: Date;
  conditionOut: Condition;
  assignedBy: string | null;
  assignNote: string | null;
  returnedAt: Date | null;
  conditionIn: Condition | null;
  receivedBy: string | null;
  returnNote: string | null;
};

export type AssetDetail = {
  id: string;
  tag: string;
  name: string;
  category: Category;
  status: AssetStatus;
  archived: boolean;
  serialNumber: string | null;
  /** HR only. */
  notes: string | null;
  purchaseDate: string | null;
  history: HistoryRow[];
  canManage: boolean;
  canAssign: boolean;
  assignable: { ok: boolean; reason?: string };
  archivable: { ok: boolean; reason?: string };
  holderEmployeeId: string | null;
};

/**
 * One item by its tag (what a scanned QR code carries). HR sees everything. A team lead sees it only if it is or was with someone in
 * their downline (and only those rows of history); an employee only if it is or was theirs (only their own rows). Otherwise null:
 * the page shows "not found", the same as for a tag that does not exist.
 */
export async function getAsset(rawTag: string): Promise<AssetDetail | null> {
  const user = await requireUser();
  const scope = scopeFor(user, "assets.view");
  if (!scope) throw new ForbiddenError("assets.view");
  let decoded = rawTag;
  try {
    decoded = decodeURIComponent(rawTag);
  } catch {
    return null;
  }
  const tag = normalizeTag(decoded.slice(0, 60));
  const [asset] = await db.select().from(assets).where(sql`upper(${assets.tag}) = ${tag}`);
  if (!asset) return null;
  const rows = await db
    .select({ a: assetAssignments, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName })
    .from(assetAssignments)
    .innerJoin(employees, eq(employees.id, assetAssignments.employeeId))
    .where(eq(assetAssignments.assetId, asset.id))
    .orderBy(desc(assetAssignments.assignedAt));
  const downline = scope === "team" ? new Set(await downlineEmployeeIds(db, user.id)) : new Set<string>();
  // A lead who is also an employee (own scope through another role) keeps their own rows too
  const visible = rows.filter((r) => scope === "all" || (scope === "team" && downline.has(r.a.employeeId)) || r.userId === user.id);
  if (scope !== "all" && visible.length === 0) return null;
  const names = new Map<string, string>();
  const userIds = [...new Set(visible.flatMap((r) => [r.a.assignedBy, r.a.receivedBy]).filter((x): x is string => Boolean(x)))];
  if (userIds.length > 0) {
    const people = await db.select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName }).from(employees).where(inArray(employees.userId, userIds));
    for (const p of people) if (p.userId) names.set(p.userId, personName(p));
  }
  const hr = scope === "all";
  const status = asset.status as AssetStatus;
  const archived = asset.archivedAt !== null;
  const assignable = assignability({ status, archived });
  const archivable = canArchive({ status, archived });
  return {
    id: asset.id,
    tag: asset.tag,
    name: asset.name,
    category: asset.category as Category,
    status,
    archived,
    serialNumber: asset.serialNumber,
    notes: hr ? asset.notes : null,
    purchaseDate: hr ? asset.purchaseDate : null,
    holderEmployeeId: rows.find((r) => r.a.returnedAt === null)?.a.employeeId ?? null,
    history: visible.map((r) => ({
      id: r.a.id,
      employeeId: r.a.employeeId,
      person: personName(r),
      assignedAt: r.a.assignedAt,
      conditionOut: r.a.conditionOut as Condition,
      // Who handed over or received it is shown to HR only; people see their own dates and conditions
      assignedBy: hr ? (names.get(r.a.assignedBy) ?? "HR") : null,
      assignNote: r.a.assignNote,
      returnedAt: r.a.returnedAt,
      conditionIn: r.a.conditionIn as Condition | null,
      receivedBy: hr && r.a.receivedBy ? (names.get(r.a.receivedBy) ?? "HR") : null,
      returnNote: r.a.returnNote,
    })),
    canManage: scopeFor(user, "assets.manage") === "all",
    canAssign: scopeFor(user, "assets.assign") === "all",
    assignable: assignable.ok ? { ok: true } : { ok: false, reason: assignable.reason },
    archivable: archivable.ok ? { ok: true } : { ok: false, reason: archivable.reason },
  };
}

/** People HR can hand an item to: everyone not archived and not separated. */
export async function listAssignablePeople(): Promise<{ id: string; name: string; position: string | null }[]> {
  const user = await requireUser();
  if (scopeFor(user, "assets.assign") !== "all") throw new ForbiddenError("assets.assign");
  const rows = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, position: employees.position, status: employees.status })
    .from(employees)
    .where(isNull(employees.archivedAt))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  return rows.filter((r) => r.status !== "separated").map((r) => ({ id: r.id, name: `${r.last}, ${r.first}`, position: r.position }));
}

/** Tag and name for the label sheet. HR only. With no tags given, every item that is not archived. */
export async function getLabelItems(tags?: string[]): Promise<{ tag: string; name: string }[]> {
  const user = await requireUser();
  if (scopeFor(user, "assets.manage") !== "all") throw new ForbiddenError("assets.manage");
  const wanted = (tags ?? []).map(normalizeTag).filter(Boolean).slice(0, 200);
  const rows = await db
    .select({ tag: assets.tag, name: assets.name })
    .from(assets)
    .where(and(isNull(assets.archivedAt), wanted.length > 0 ? inArray(sql`upper(${assets.tag})`, wanted) : undefined))
    .orderBy(asc(assets.tag))
    .limit(500);
  return rows;
}
