import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { todayInZone } from "@/modules/org/service";
import { clients, employees } from "@/modules/people/schema";
import { expiryStatus, type ExpiryStatus } from "./expiry";
import { documentFolders, documentTypes, documents } from "./schema";
import { clientChoices } from "./service";

export type DocumentRow = {
  id: string;
  title: string;
  typeName: string;
  typeSlug: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  clientName: string | null;
  expiresOn: string | null;
  expiry: ExpiryStatus;
  verified: boolean;
  archived: boolean;
  audience: "all_staff" | "hr_only";
  /** The person's folder it sits in; null = no folder (and always null for company documents). */
  folderId: string | null;
  createdAt: Date;
};

function toRow(r: {
  id: string; title: string; typeName: string; typeSlug: string; originalName: string; mimeType: string | null; sizeBytes: number | null;
  clientName: string | null; expiresOn: string | null; verifiedAt: Date | null; archivedAt: Date | null; audience: string; folderId: string | null; createdAt: Date;
}, today: string): DocumentRow {
  return {
    id: r.id,
    title: r.title,
    typeName: r.typeName,
    typeSlug: r.typeSlug,
    fileName: r.originalName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    clientName: r.clientName,
    expiresOn: r.expiresOn,
    expiry: expiryStatus(r.expiresOn, today),
    verified: r.verifiedAt !== null,
    archived: r.archivedAt !== null,
    audience: r.audience === "hr_only" ? "hr_only" : "all_staff",
    folderId: r.folderId,
    createdAt: r.createdAt,
  };
}

const columns = {
  id: documents.id,
  title: documents.title,
  typeName: documentTypes.name,
  typeSlug: documentTypes.slug,
  originalName: documents.originalName,
  mimeType: documents.mimeType,
  sizeBytes: documents.sizeBytes,
  clientName: clients.name,
  expiresOn: documents.expiresOn,
  verifiedAt: documents.verifiedAt,
  archivedAt: documents.archivedAt,
  audience: documents.audience,
  folderId: documents.folderId,
  createdAt: documents.createdAt,
};

/** One person's documents. HR and the person only; archived ones are for HR. */
export async function listEmployeeDocuments(employeeId: string): Promise<DocumentRow[]> {
  const user = await requireUser();
  const [owner] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  await authorize(user, "documents.view", { ownerUserId: owner?.userId ?? undefined });
  if (!owner) return [];

  const isHr = can(user, "documents.verify");
  const rows = await db
    .select(columns)
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.typeId))
    .leftJoin(clients, eq(clients.id, documents.clientId))
    .where(and(eq(documents.employeeId, employeeId), eq(documents.status, "active"), isHr ? undefined : isNull(documents.archivedAt)))
    .orderBy(desc(documents.createdAt));
  const today = todayInZone();
  return rows.map((r) => toRow(r, today));
}

export type FolderRow = { id: string; name: string };

/** A person's folders (not removed ones), by name. HR and the person only. */
export async function listEmployeeFolders(employeeId: string): Promise<FolderRow[]> {
  const user = await requireUser();
  const [owner] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  await authorize(user, "documents.view", { ownerUserId: owner?.userId ?? undefined });
  if (!owner) return [];
  return db
    .select({ id: documentFolders.id, name: documentFolders.name })
    .from(documentFolders)
    .where(and(eq(documentFolders.employeeId, employeeId), isNull(documentFolders.archivedAt)))
    .orderBy(asc(documentFolders.name));
}

/** Company policies and forms. "HR only" ones are hidden from everyone else. */
export async function listCompanyDocuments(): Promise<DocumentRow[]> {
  const user = await requireUser();
  await authorize(user, "documents.view_company");
  const isHr = can(user, "documents.manage_company");

  const rows = await db
    .select(columns)
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.typeId))
    .leftJoin(clients, eq(clients.id, documents.clientId))
    .where(
      and(
        isNull(documents.employeeId),
        eq(documents.status, "active"),
        isHr ? undefined : isNull(documents.archivedAt),
        isHr ? undefined : eq(documents.audience, "all_staff"),
      ),
    )
    .orderBy(asc(documentTypes.name), desc(documents.createdAt));
  const today = todayInZone();
  return rows.map((r) => toRow(r, today));
}

export type TypeOption = { id: string; name: string; requiresExpiry: boolean; requiresClient: boolean };

/** What the upload form offers: active types for the target, and the clients the person may choose. */
export async function getUploadOptions(target: "employee" | "company", employeeId?: string) {
  const user = await requireUser();
  if (target === "company") await authorize(user, "documents.manage_company");
  else {
    const [owner] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId ?? "00000000-0000-0000-0000-000000000000")).limit(1);
    await authorize(user, "documents.upload", { ownerUserId: owner?.userId ?? undefined });
  }

  const types = await db
    .select({ id: documentTypes.id, name: documentTypes.name, requiresExpiry: documentTypes.requiresExpiry, requiresClient: documentTypes.requiresClient })
    .from(documentTypes)
    .where(and(eq(documentTypes.scope, target), isNull(documentTypes.archivedAt)))
    .orderBy(documentTypes.name);

  const clientOptions = target === "employee" && employeeId ? await clientChoices(user, employeeId) : [];
  return { types, clients: clientOptions };
}

export type AttentionRow = DocumentRow & { employeeId: string; employeeName: string; employeeNumber: string; daysLeft: number };
export type MissingRow = { employeeId: string; employeeName: string; employeeNumber: string; typeName: string; reason: "none" | "expired" };
export type UnverifiedRow = { documentId: string; employeeId: string; employeeName: string; employeeNumber: string; typeName: string; title: string; uploadedAt: Date };

/** HR overview across everyone: what is expiring or expired, what is missing, and what needs verifying. */
export async function getDocumentOverview() {
  const user = await requireUser();
  await authorize(user, "documents.view_overview");
  const today = todayInZone();

  const name = sql<string>`coalesce(nullif(btrim(e.preferred_name), ''), e.legal_first_name) || ' ' || e.legal_last_name`;

  const attention = (await db.execute(sql`
    select d.id, d.title, t.name as type_name, t.slug as type_slug, d.original_name, d.mime_type, d.size_bytes, c.name as client_name,
           d.expires_on::text as expires_on, d.verified_at, d.archived_at, d.audience, d.created_at,
           e.id as employee_id, e.employee_number, ${name} as employee_name,
           (d.expires_on - ${today}::date) as days_left
    from docs.documents d
    join docs.document_types t on t.id = d.type_id
    join core.employees e on e.id = d.employee_id
    left join core.clients c on c.id = d.client_id
    where d.status = 'active' and d.archived_at is null and d.expires_on is not null
      and d.expires_on <= ${today}::date + 30
      and e.archived_at is null and e.status <> 'separated'
    order by d.expires_on asc, e.legal_last_name
    limit 300`)) as unknown as Record<string, unknown>[];

  const missing = (await db.execute(sql`
    select e.id as employee_id, e.employee_number, ${name} as employee_name, t.name as type_name,
           case when exists (
             select 1 from docs.documents d where d.employee_id = e.id and d.type_id = t.id and d.status = 'active' and d.archived_at is null
           ) then 'expired' else 'none' end as reason
    from core.employees e
    cross join docs.document_types t
    where t.required_for_all and t.archived_at is null and t.scope = 'employee'
      and e.archived_at is null and e.status <> 'separated'
      and not exists (
        select 1 from docs.documents d
        where d.employee_id = e.id and d.type_id = t.id and d.status = 'active' and d.archived_at is null
          and (d.expires_on is null or d.expires_on >= ${today}::date)
      )
    order by e.legal_last_name, t.name
    limit 500`)) as unknown as Record<string, unknown>[];

  const unverified = (await db.execute(sql`
    select d.id as document_id, e.id as employee_id, e.employee_number, ${name} as employee_name, t.name as type_name, d.title, d.finalized_at as uploaded_at
    from docs.documents d
    join docs.document_types t on t.id = d.type_id
    join core.employees e on e.id = d.employee_id
    where d.status = 'active' and d.archived_at is null and d.verified_at is null and e.archived_at is null
    order by d.finalized_at desc
    limit 300`)) as unknown as Record<string, unknown>[];

  return {
    today,
    attention: attention.map<AttentionRow>((r) => ({
      ...toRow(
        {
          id: String(r.id), title: String(r.title), typeName: String(r.type_name), typeSlug: String(r.type_slug), originalName: String(r.original_name),
          mimeType: (r.mime_type as string | null) ?? null, sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
          clientName: (r.client_name as string | null) ?? null, expiresOn: (r.expires_on as string | null) ?? null,
          verifiedAt: r.verified_at ? new Date(String(r.verified_at)) : null, archivedAt: null, audience: String(r.audience), folderId: null, createdAt: new Date(String(r.created_at)),
        },
        today,
      ),
      employeeId: String(r.employee_id),
      employeeName: String(r.employee_name),
      employeeNumber: String(r.employee_number),
      daysLeft: Number(r.days_left),
    })),
    missing: missing.map<MissingRow>((r) => ({
      employeeId: String(r.employee_id),
      employeeName: String(r.employee_name),
      employeeNumber: String(r.employee_number),
      typeName: String(r.type_name),
      reason: r.reason === "expired" ? "expired" : "none",
    })),
    unverified: unverified.map<UnverifiedRow>((r) => ({
      documentId: String(r.document_id),
      employeeId: String(r.employee_id),
      employeeName: String(r.employee_name),
      employeeNumber: String(r.employee_number),
      typeName: String(r.type_name),
      title: String(r.title),
      uploadedAt: new Date(String(r.uploaded_at)),
    })),
  };
}

export type TypeAdminRow = {
  id: string; slug: string; name: string; scope: "employee" | "company";
  requiresExpiry: boolean; requiresClient: boolean; requiredForAll: boolean; documents: number;
};

export async function listDocumentTypes(): Promise<TypeAdminRow[]> {
  const user = await requireUser();
  await authorize(user, "documents.manage_types");
  const rows = await db
    .select({
      id: documentTypes.id, slug: documentTypes.slug, name: documentTypes.name, scope: documentTypes.scope,
      requiresExpiry: documentTypes.requiresExpiry, requiresClient: documentTypes.requiresClient, requiredForAll: documentTypes.requiredForAll,
      documents: sql<number>`(select count(*)::int from docs.documents d where d.type_id = ${documentTypes.id} and d.status = 'active' and d.archived_at is null)`,
    })
    .from(documentTypes)
    .where(isNull(documentTypes.archivedAt))
    .orderBy(documentTypes.scope, documentTypes.name);
  return rows.map((r) => ({ ...r, scope: r.scope === "company" ? "company" : "employee" }));
}
