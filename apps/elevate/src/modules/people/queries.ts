import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { can, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fieldCrypto } from "@/lib/crypto";
import { writeAudit } from "@/modules/audit/write";
import type { ChangeCategory, ChangeStatus, CustomFieldType, CustomFieldVisibility, EmployeeStatus } from "./constants";
import {
  changeRequests,
  clientAssignments,
  clients,
  customFieldDefs,
  customFieldValues,
  emergencyContacts,
  employeeSensitive,
  employees,
  employmentHistory,
} from "./schema";
import { changeRequestContext } from "./service";
import { directoryQuerySchema } from "./validators";

const PAGE_SIZE = 25;
// Drizzle drops the table name for columns inside a select-list subquery, which makes `id` ambiguous.
const EMPLOYEE_ID = sql.raw('"core"."employees"."id"');

// --- Directory ---------------------------------------------------------------

export type DirectoryRow = {
  id: string;
  employeeNumber: string;
  legalFirstName: string;
  legalLastName: string;
  preferredName: string | null;
  position: string | null;
  workEmail: string;
  status: EmployeeStatus;
  startDate: string | null;
  archived: boolean;
  /** Only filled for people who may see client names (HR Admin, Super Admin). */
  clientNames: string | null;
};

/**
 * Everyone may list the directory, but only name, position, work email and status.
 * Client names and archived people are for HR only.
 */
export async function listDirectory(rawQuery: unknown) {
  const user = await requireUser();
  await authorize(user, "people.view_directory");

  const q = directoryQuerySchema.parse(rawQuery ?? {});
  const seesClients = scopeFor(user, "people.view_client_assignments") === "all";
  const seesArchived = can(user, "people.archive");

  const conditions: SQL[] = [];
  if (!(seesArchived && q.archived)) conditions.push(isNull(employees.archivedAt));
  if (q.status) conditions.push(eq(employees.status, q.status));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      or(
        ilike(employees.legalFirstName, like),
        ilike(employees.legalLastName, like),
        ilike(employees.preferredName, like),
        ilike(employees.workEmail, like),
        ilike(employees.employeeNumber, like),
        ilike(employees.position, like),
      )!,
    );
  }
  if (q.client && seesClients) {
    conditions.push(
      sql`exists (select 1 from ${clientAssignments} ca where ca.employee_id = ${employees.id}
            and ca.client_id = ${q.client} and ca.end_date is null)`,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const order = q.dir === "desc" ? desc : asc;
  const orderBy =
    q.sort === "position"
      ? [order(employees.position), asc(employees.legalLastName)]
      : q.sort === "status"
        ? [order(employees.status), asc(employees.legalLastName)]
        : q.sort === "start"
          ? [order(employees.startDate), asc(employees.legalLastName)]
          : [order(sql`lower(${employees.legalLastName})`), order(sql`lower(${employees.legalFirstName})`)];

  const clientNames = seesClients
    ? sql<string | null>`(select string_agg(c.name, ', ' order by c.name) from ${clientAssignments} ca
        join ${clients} c on c.id = ca.client_id where ca.employee_id = ${EMPLOYEE_ID} and ca.end_date is null)`
    : sql<string | null>`null`;

  const rows = await db
    .select({
      id: employees.id,
      employeeNumber: employees.employeeNumber,
      legalFirstName: employees.legalFirstName,
      legalLastName: employees.legalLastName,
      preferredName: employees.preferredName,
      position: employees.position,
      workEmail: employees.workEmail,
      status: employees.status,
      startDate: employees.startDate,
      archivedAt: employees.archivedAt,
      clientNames,
    })
    .from(employees)
    .where(where)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset((q.page - 1) * PAGE_SIZE);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(employees).where(where);

  return {
    rows: rows.map<DirectoryRow>((r) => ({
      ...r,
      status: r.status as EmployeeStatus,
      archived: r.archivedAt !== null,
    })),
    total,
    page: q.page,
    pageSize: PAGE_SIZE,
    query: q,
    seesClients,
    seesArchived,
    canCreate: can(user, "people.create"),
  };
}

/** Clients for the directory filter and the assignment form. HR only. */
export async function listClientsForFilter() {
  const user = await requireUser();
  await authorize(user, "people.manage_assignments");
  return db.select({ id: clients.id, name: clients.name, isActive: clients.isActive }).from(clients).where(isNull(clients.archivedAt)).orderBy(clients.name);
}

/** The signed-in person's own people record id, for the "My profile" shortcut. */
export async function getMyEmployeeId(): Promise<string | null> {
  const user = await requireUser();
  const [row] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id)).limit(1);
  return row?.id ?? null;
}

// --- Profile -----------------------------------------------------------------

export type ProfileAccess = {
  isSelf: boolean;
  canEdit: boolean;
  canEditSensitive: boolean;
  canViewSensitive: boolean;
  canViewClients: boolean;
  canViewHistory: boolean;
  canRequestChange: boolean;
  canManageAssignments: boolean;
  canArchive: boolean;
  canManageCustomFields: boolean;
};

async function loadEmployee(employeeId: string) {
  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  return employee ?? null;
}

/**
 * Loads one profile. Throws ForbiddenError (shown as "not found") for anyone without
 * access, including when the record does not exist, so ids cannot be probed.
 */
export async function getProfile(employeeId: string) {
  const user = await requireUser();
  const employee = await loadEmployee(employeeId);
  const resource = { ownerUserId: employee?.userId ?? undefined };

  if (!employee) await authorize({ ...user, roles: [] }, "people.view_profile"); // always forbidden
  await authorize(user, "people.view_profile", resource);
  const e = employee!;

  const isHr = can(user, "people.edit_profile");
  const access: ProfileAccess = {
    isSelf: e.userId === user.id,
    canEdit: isHr,
    canEditSensitive: can(user, "people.edit_sensitive"),
    canViewSensitive: can(user, "people.view_sensitive", resource),
    canViewClients: can(user, "people.view_client_assignments", resource),
    canViewHistory: can(user, "people.view_history", resource),
    canRequestChange: can(user, "people.request_contact_change", resource),
    canManageAssignments: can(user, "people.manage_assignments"),
    canArchive: can(user, "people.archive"),
    canManageCustomFields: can(user, "people.manage_custom_fields"),
  };

  const [contacts, sensitive, assignments, history, fieldDefs, fieldValues, pending] = await Promise.all([
    db
      .select()
      .from(emergencyContacts)
      .where(and(eq(emergencyContacts.employeeId, e.id), isNull(emergencyContacts.archivedAt)))
      .orderBy(desc(emergencyContacts.isPrimary), emergencyContacts.name),
    access.canViewSensitive
      ? db.select({ masks: employeeSensitive.masks, payCurrency: employeeSensitive.payCurrency }).from(employeeSensitive).where(eq(employeeSensitive.employeeId, e.id)).limit(1)
      : Promise.resolve([]),
    access.canViewClients
      ? db
          .select({
            id: clientAssignments.id,
            clientId: clients.id,
            clientName: clients.name,
            clientTimeZone: clients.timeZone,
            startDate: clientAssignments.startDate,
            endDate: clientAssignments.endDate,
            hoursPerWeek: clientAssignments.hoursPerWeek,
          })
          .from(clientAssignments)
          .innerJoin(clients, eq(clients.id, clientAssignments.clientId))
          .where(eq(clientAssignments.employeeId, e.id))
          .orderBy(desc(clientAssignments.startDate))
      : Promise.resolve([]),
    access.canViewHistory
      ? db.select().from(employmentHistory).where(eq(employmentHistory.employeeId, e.id)).orderBy(desc(employmentHistory.createdAt)).limit(200)
      : Promise.resolve([]),
    db.select().from(customFieldDefs).where(isNull(customFieldDefs.archivedAt)).orderBy(customFieldDefs.sortOrder, customFieldDefs.label),
    db.select().from(customFieldValues).where(eq(customFieldValues.employeeId, e.id)),
    db
      .select({ id: changeRequests.id, category: changeRequests.category, createdAt: changeRequests.createdAt })
      .from(changeRequests)
      .where(and(eq(changeRequests.employeeId, e.id), eq(changeRequests.status, "pending"))),
  ]);

  // HR sees every custom field; a person sees only the ones marked visible to them.
  const valueByDef = new Map(fieldValues.map((v) => [v.fieldDefId, v.value]));
  const customFields = fieldDefs
    .filter((d) => isHr || d.visibility === "employee_visible")
    .map((d) => ({
      id: d.id,
      key: d.key,
      label: d.label,
      fieldType: d.fieldType as CustomFieldType,
      options: d.options ?? [],
      visibility: d.visibility as CustomFieldVisibility,
      isRequired: d.isRequired,
      value: valueByDef.get(d.id) ?? "",
    }));

  return {
    employee: {
      id: e.id,
      employeeNumber: e.employeeNumber,
      legalFirstName: e.legalFirstName,
      legalMiddleName: e.legalMiddleName,
      legalLastName: e.legalLastName,
      preferredName: e.preferredName,
      birthDate: e.birthDate,
      civilStatus: e.civilStatus,
      workEmail: e.workEmail,
      personalEmail: e.personalEmail,
      mobile: e.mobile,
      addressLine: e.addressLine,
      city: e.city,
      province: e.province,
      postalCode: e.postalCode,
      country: e.country,
      position: e.position,
      status: e.status as EmployeeStatus,
      workerType: e.workerType,
      startDate: e.startDate,
      endDate: e.endDate,
      linked: e.userId !== null,
      archived: e.archivedAt !== null,
    },
    access,
    emergencyContacts: contacts,
    sensitive: sensitive[0] ? { masks: sensitive[0].masks, payCurrency: sensitive[0].payCurrency } : null,
    assignments,
    history,
    customFields,
    pendingRequests: pending.map((p) => ({ ...p, category: p.category as ChangeCategory })),
  };
}

// --- Change requests (HR review queue) ---------------------------------------

export type ChangeRequestRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  category: ChangeCategory;
  status: ChangeStatus;
  createdAt: Date;
  payload: unknown;
  reviewNote: string | null;
};

export async function listChangeRequests(status: ChangeStatus = "pending") {
  const user = await requireUser();
  await authorize(user, "people.approve_change");

  const rows = await db
    .select({
      id: changeRequests.id,
      employeeId: changeRequests.employeeId,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      preferred: employees.preferredName,
      employeeNumber: employees.employeeNumber,
      category: changeRequests.category,
      status: changeRequests.status,
      createdAt: changeRequests.createdAt,
      payload: changeRequests.payload, // null for bank requests: their values stay encrypted
      reviewNote: changeRequests.reviewNote,
    })
    .from(changeRequests)
    .innerJoin(employees, eq(employees.id, changeRequests.employeeId))
    .where(eq(changeRequests.status, status))
    .orderBy(desc(changeRequests.createdAt))
    .limit(200);

  return rows.map<ChangeRequestRow>((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: `${r.preferred?.trim() || r.first} ${r.last}`,
    employeeNumber: r.employeeNumber,
    category: r.category as ChangeCategory,
    status: r.status as ChangeStatus,
    createdAt: r.createdAt,
    payload: r.payload,
    reviewNote: r.reviewNote,
  }));
}

/**
 * The values in a pending bank request. Decrypting is a sensitive view, so it is audited
 * (field name only) and only happens when a reviewer asks for it.
 */
export async function viewBankChangeRequest(requestId: string) {
  const user = await requireUser();
  await authorize(user, "people.approve_change");

  const [row] = await db
    .select({ id: changeRequests.id, employeeId: changeRequests.employeeId, enc: changeRequests.payloadEnc, status: changeRequests.status, category: changeRequests.category })
    .from(changeRequests)
    .where(eq(changeRequests.id, requestId))
    .limit(1);
  if (!row || row.category !== "bank" || row.status !== "pending" || !row.enc) return null;

  const values = JSON.parse(fieldCrypto().decrypt(row.enc, changeRequestContext(row.id))) as {
    bankName: string;
    bankAccountName: string;
    bankAccountNumber: string;
  };
  await writeAudit({
    actor: user,
    action: "sensitive.view",
    targetType: "employee",
    targetId: row.employeeId,
    metadata: { field: "change_request.bank", requestId: row.id },
  });
  return values;
}

export async function countPendingChangeRequests() {
  const user = await requireUser();
  if (!can(user, "people.approve_change")) return 0;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(changeRequests).where(eq(changeRequests.status, "pending"));
  return n;
}

// --- Admin lists --------------------------------------------------------------

export async function listClients() {
  const user = await requireUser();
  await authorize(user, "people.manage_clients");
  return db.select().from(clients).where(isNull(clients.archivedAt)).orderBy(clients.name);
}

export async function listCustomFieldDefs() {
  const user = await requireUser();
  await authorize(user, "people.manage_custom_fields");
  return db.select().from(customFieldDefs).where(isNull(customFieldDefs.archivedAt)).orderBy(customFieldDefs.sortOrder, customFieldDefs.label);
}
