"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { SENSITIVE_LABELS } from "./constants";
import {
  changeRequests,
  clientAssignments,
  clients,
  customFieldDefs,
  customFieldValues,
  emergencyContacts,
  employeeSensitive,
  employees,
} from "./schema";
import {
  changeRequestContext,
  findLinkableUser,
  recordHistory,
  sensitiveColumn,
  sensitiveContext,
  upsertSensitive,
  type SensitiveValues,
  type Tx,
} from "./service";
import {
  archiveCustomFieldSchema,
  archiveEmployeeSchema,
  assignmentSchema,
  bankChangeSchema,
  cancelChangeSchema,
  clientSchema,
  contactChangeSchema,
  createEmployeeSchema,
  customFieldDefSchema,
  customFieldValuesSchema,
  emergencyContactsChangeSchema,
  endAssignmentSchema,
  revealSensitiveSchema,
  reviewChangeSchema,
  updateClientSchema,
  updateEmployeeSchema,
  updateSensitiveSchema,
} from "./validators";

const BAD_FORM = "Check the form and try again.";
const firstIssue = (error: { issues: { message: string }[] }) => error.issues[0]?.message ?? BAD_FORM;

// Fields HR may edit on a profile, with labels for history summaries.
const PROFILE_FIELDS = {
  legalFirstName: "first name",
  legalMiddleName: "middle name",
  legalLastName: "last name",
  preferredName: "preferred name",
  birthDate: "birth date",
  civilStatus: "civil status",
  workEmail: "work email",
  personalEmail: "personal email",
  mobile: "mobile",
  addressLine: "address",
  city: "city",
  province: "province",
  postalCode: "postal code",
  country: "country",
  startDate: "start date",
  endDate: "end date",
} as const;
type ProfileField = keyof typeof PROFILE_FIELDS;

const CONTACT_FIELDS = ["mobile", "personalEmail", "addressLine", "city", "province", "postalCode", "country"] as const;

function revalidateEmployee(employeeId: string) {
  revalidatePath("/people");
  revalidatePath(`/people/${employeeId}`);
}

// --- Create, update, archive -------------------------------------------------

export async function createEmployee(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.create");
    const parsed = createEmployeeSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;

    try {
      const id = await db.transaction(async (tx) => {
        const userId = await findLinkableUser(tx, [v.workEmail, v.personalEmail]);
        const [created] = await tx
          .insert(employees)
          .values({ ...v, userId, createdBy: actor.id })
          .returning({ id: employees.id, employeeNumber: employees.employeeNumber });

        await recordHistory(tx, {
          employeeId: created.id,
          eventType: "hired",
          summary: v.position ? `Added to ELEVATE as ${v.position}` : "Added to ELEVATE",
          changedBy: actor.id,
          ...(v.startDate ? { effectiveDate: v.startDate } : {}),
        });
        await writeAudit(
          {
            actor,
            action: "people.create",
            targetType: "employee",
            targetId: created.id,
            after: { employeeNumber: created.employeeNumber, status: v.status, workerType: v.workerType, linkedAccount: userId !== null },
          },
          tx,
        );
        return created.id;
      });
      revalidateEmployee(id);
      return { ok: true, data: { id } };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("Someone with that work email already exists.");
      throw error;
    }
  });
}

export async function updateEmployee(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.edit_profile");
    const parsed = updateEmployeeSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { employeeId, ...v } = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for("update");
        if (!before) return fail("That person was not found.");

        const changedProfile = (Object.keys(PROFILE_FIELDS) as ProfileField[]).filter(
          // eslint-disable-next-line security/detect-object-injection -- keys of PROFILE_FIELDS
          (f) => (before[f] ?? undefined) !== (v[f] ?? undefined),
        );
        const positionChanged = (before.position ?? undefined) !== (v.position ?? undefined);
        const statusChanged = before.status !== v.status;
        const workerTypeChanged = before.workerType !== v.workerType;

        if (!changedProfile.length && !positionChanged && !statusChanged && !workerTypeChanged) return fail("No changes to save.");

        await tx
          .update(employees)
          .set({
            ...Object.fromEntries(Object.keys(PROFILE_FIELDS).map((f) => [f, v[f as ProfileField] ?? null])),
            position: v.position ?? null,
            status: v.status,
            workerType: v.workerType,
            updatedAt: new Date(),
          })
          .where(eq(employees.id, employeeId));

        const pick = (src: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, src[k] ?? null])); // eslint-disable-line security/detect-object-injection
        if (changedProfile.length) {
          await recordHistory(tx, {
            employeeId,
            eventType: "profile_changed",
            summary: `Updated ${changedProfile.map((f) => PROFILE_FIELDS[f]).join(", ")}`, // eslint-disable-line security/detect-object-injection
            before: pick(before, changedProfile),
            after: pick(v, changedProfile),
            changedBy: actor.id,
          });
        }
        if (positionChanged) {
          await recordHistory(tx, {
            employeeId,
            eventType: "position_changed",
            summary: `Position: ${before.position ?? "none"} → ${v.position ?? "none"}`,
            before: { position: before.position },
            after: { position: v.position ?? null },
            changedBy: actor.id,
          });
        }
        if (statusChanged) {
          await recordHistory(tx, {
            employeeId,
            eventType: "status_changed",
            summary: `Status: ${before.status} → ${v.status}`,
            before: { status: before.status },
            after: { status: v.status },
            changedBy: actor.id,
          });
        }
        if (workerTypeChanged) {
          await recordHistory(tx, {
            employeeId,
            eventType: "worker_type_changed",
            summary: `Worker type: ${before.workerType} → ${v.workerType}`,
            before: { workerType: before.workerType },
            after: { workerType: v.workerType },
            changedBy: actor.id,
          });
        }

        const fields = [...changedProfile, ...(positionChanged ? ["position"] : []), ...(statusChanged ? ["status"] : []), ...(workerTypeChanged ? ["workerType"] : [])];
        await writeAudit(
          {
            actor,
            action: "people.update",
            targetType: "employee",
            targetId: employeeId,
            before: pick(before, fields),
            after: pick({ ...v, position: v.position }, fields),
          },
          tx,
        );
        return { ok: true, data: undefined } as const;
      });
      if (result.ok) revalidateEmployee(employeeId);
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) return fail("Someone with that work email already exists.");
      throw error;
    }
  });
}

export async function archiveEmployee(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.archive");
    const parsed = archiveEmployeeSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_FORM);
    const { employeeId, restore } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select({ archivedAt: employees.archivedAt, userId: employees.userId }).from(employees).where(eq(employees.id, employeeId)).for("update");
      if (!row) return fail("That person was not found.");
      if ((row.archivedAt !== null) === !restore) return fail(restore ? "That person is not archived." : "That person is already archived.");
      if (!restore && row.userId === actor.id) return fail("You cannot archive your own record.");

      await tx.update(employees).set({ archivedAt: restore ? null : new Date(), updatedAt: new Date() }).where(eq(employees.id, employeeId));
      await recordHistory(tx, {
        employeeId,
        eventType: restore ? "restored" : "archived",
        summary: restore ? "Record restored" : "Record archived",
        changedBy: actor.id,
      });
      await writeAudit({ actor, action: restore ? "people.restore" : "people.archive", targetType: "employee", targetId: employeeId }, tx);
      return { ok: true, data: undefined } as const;
    });
    if (result.ok) revalidateEmployee(employeeId);
    return result;
  });
}

// --- Sensitive fields ---------------------------------------------------------

export async function updateSensitive(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.edit_sensitive");
    const parsed = updateSensitiveSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { employeeId, values } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [exists] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!exists) return fail("That person was not found.");

      const changed = await upsertSensitive(tx, employeeId, values as SensitiveValues, actor.id);
      if (changed.length === 0) return fail("No changes to save.");

      const labels = changed.map((f) => SENSITIVE_LABELS[f]); // eslint-disable-line security/detect-object-injection
      // History and audit record which fields changed, never the values.
      await recordHistory(tx, {
        employeeId,
        eventType: "sensitive_changed",
        summary: `${labels.join(", ")} updated`,
        changedBy: actor.id,
      });
      await writeAudit({ actor, action: "sensitive.update", targetType: "employee", targetId: employeeId, metadata: { fields: changed } }, tx);
      return { ok: true, data: undefined } as const;
    });
    if (result.ok) revalidateEmployee(employeeId);
    return result;
  });
}

/** Decrypts one value for display. Audited every time (field name only). */
export async function revealSensitiveField(input: unknown): Promise<ActionResult<{ value: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = revealSensitiveSchema.safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");
    const { employeeId, field } = parsed.data;

    const [employee] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
    // A person may reveal their own values; HR and Super Admin may reveal anyone's.
    await authorize(actor, "people.view_sensitive", { ownerUserId: employee?.userId ?? undefined });
    if (!employee) return fail("That person was not found.");

    if (!(await allowRequest("reveal", actor.id))) return fail("Too many reveals. Wait a few minutes and try again.");

    const column = sensitiveColumn(field);
    // eslint-disable-next-line security/detect-object-injection -- `column` comes from a typed SensitiveField
    const [row] = await db.select({ enc: employeeSensitive[column] }).from(employeeSensitive).where(eq(employeeSensitive.employeeId, employeeId)).limit(1);
    if (!row?.enc) return fail("Nothing is saved for that field.");

    const value = fieldCrypto().decrypt(row.enc, sensitiveContext(field, employeeId));
    await writeAudit({ actor, action: "sensitive.view", targetType: "employee", targetId: employeeId, metadata: { field } });
    return { ok: true, data: { value } };
  });
}

// --- Self-service change requests --------------------------------------------

async function selfEmployee(actorId: string) {
  const [row] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.userId, actorId), isNull(employees.archivedAt)))
    .limit(1);
  return row ?? null;
}

async function createRequest(
  actor: Awaited<ReturnType<typeof requireUser>>,
  category: "contact" | "emergency_contacts" | "bank",
  build: (requestId: string) => { payload?: unknown; payloadEnc?: string },
  employeeId: string,
): Promise<ActionResult> {
  const requestId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(changeRequests).values({ id: requestId, employeeId, category, requestedBy: actor.id, ...build(requestId) });
      await writeAudit({ actor, action: "change_request.create", targetType: "employee", targetId: employeeId, metadata: { category, requestId } }, tx);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("You already have a pending request for this. Wait for HR or cancel it first.");
    throw error;
  }
  revalidatePath("/people/me");
  revalidatePath("/people/requests");
  revalidateEmployee(employeeId);
  return { ok: true, data: undefined };
}

export async function requestContactChange(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const me = await selfEmployee(actor.id);
    await authorize(actor, "people.request_contact_change", { ownerUserId: me?.userId ?? undefined });
    if (!me) return fail("Your people record is not set up yet. Ask HR.");

    const parsed = contactChangeSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const [current] = await db.select().from(employees).where(eq(employees.id, me.id)).limit(1);
    const proposed = Object.fromEntries(
      CONTACT_FIELDS.flatMap((f) => {
        // eslint-disable-next-line security/detect-object-injection -- f is a key of CONTACT_FIELDS
        const next = parsed.data[f];
        // eslint-disable-next-line security/detect-object-injection -- keys of CONTACT_FIELDS
        return next !== undefined && next !== (current[f] ?? undefined) ? [[f, next]] : [];
      }),
    );
    if (Object.keys(proposed).length === 0) return fail("Those details are already on file.");

    return createRequest(actor, "contact", () => ({ payload: proposed }), me.id);
  });
}

export async function requestEmergencyContactsChange(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const me = await selfEmployee(actor.id);
    await authorize(actor, "people.request_contact_change", { ownerUserId: me?.userId ?? undefined });
    if (!me) return fail("Your people record is not set up yet. Ask HR.");

    const parsed = emergencyContactsChangeSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    return createRequest(actor, "emergency_contacts", () => ({ payload: parsed.data }), me.id);
  });
}

export async function requestBankChange(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const me = await selfEmployee(actor.id);
    await authorize(actor, "people.request_contact_change", { ownerUserId: me?.userId ?? undefined });
    if (!me) return fail("Your people record is not set up yet. Ask HR.");

    const parsed = bankChangeSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    // Bank details never sit in the database as plain text, not even while waiting for approval.
    return createRequest(
      actor,
      "bank",
      (requestId) => ({ payloadEnc: fieldCrypto().encrypt(JSON.stringify(parsed.data), changeRequestContext(requestId)) }),
      me.id,
    );
  });
}

export async function cancelChangeRequest(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = cancelChangeSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_FORM);

    const result = await db.transaction(async (tx) => {
      const [req] = await tx.select().from(changeRequests).where(eq(changeRequests.id, parsed.data.requestId)).for("update");
      const [owner] = req ? await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, req.employeeId)).limit(1) : [];
      await authorize(actor, "people.request_contact_change", { ownerUserId: owner?.userId ?? undefined });
      if (!req || req.status !== "pending") return fail("That request is no longer pending.");

      await tx.update(changeRequests).set({ status: "cancelled", payloadEnc: null, reviewedAt: new Date() }).where(eq(changeRequests.id, req.id));
      await writeAudit({ actor, action: "change_request.cancel", targetType: "employee", targetId: req.employeeId, metadata: { category: req.category, requestId: req.id } }, tx);
      return { ok: true, data: undefined } as const;
    });
    revalidatePath("/people/requests");
    return result;
  });
}

export async function reviewChangeRequest(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.approve_change");
    const parsed = reviewChangeSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { requestId, decision, note } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [req] = await tx.select().from(changeRequests).where(eq(changeRequests.id, requestId)).for("update");
      if (!req) return fail("That request was not found.");
      if (req.status !== "pending") return fail("That request was already handled.");
      // Four eyes: nobody approves a change to their own record.
      if (req.requestedBy === actor.id) return fail("Another admin must review your own request.");

      const approve = decision === "approve";
      if (approve) {
        const applied = await applyChange(tx, req, actor.id);
        if (!applied.ok) return applied;
      }

      await tx
        .update(changeRequests)
        .set({ status: approve ? "approved" : "rejected", reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note ?? null, payloadEnc: null })
        .where(eq(changeRequests.id, req.id));
      await writeAudit(
        {
          actor,
          action: approve ? "change_request.approve" : "change_request.reject",
          targetType: "employee",
          targetId: req.employeeId,
          metadata: { category: req.category, requestId: req.id },
        },
        tx,
      );
      return { ok: true, data: undefined } as const;
    });

    revalidatePath("/people/requests");
    if (result.ok) revalidatePath("/people");
    return result;
  });
}

type RequestRow = typeof changeRequests.$inferSelect;

async function applyChange(tx: Tx, req: RequestRow, actorId: string): Promise<ActionResult> {
  if (req.category === "contact") {
    const proposed = (req.payload ?? {}) as Record<string, string>;
    const keys = CONTACT_FIELDS.filter((f) => f in proposed);
    const [before] = await tx.select().from(employees).where(eq(employees.id, req.employeeId)).for("update");
    if (!before) return fail("That person was not found.");

    await tx.update(employees).set({ ...Object.fromEntries(keys.map((k) => [k, proposed[k]])), updatedAt: new Date() }).where(eq(employees.id, req.employeeId)); // eslint-disable-line security/detect-object-injection
    await recordHistory(tx, {
      employeeId: req.employeeId,
      eventType: "profile_changed",
      summary: `Contact details updated (${keys.join(", ")}), approved request`,
      before: Object.fromEntries(keys.map((k) => [k, before[k] ?? null])), // eslint-disable-line security/detect-object-injection
      after: Object.fromEntries(keys.map((k) => [k, proposed[k]])), // eslint-disable-line security/detect-object-injection
      changedBy: actorId,
    });
    return { ok: true, data: undefined };
  }

  if (req.category === "emergency_contacts") {
    const { contacts } = (req.payload ?? { contacts: [] }) as { contacts: { name: string; relationship: string; phone: string; isPrimary: boolean }[] };
    await tx.update(emergencyContacts).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(emergencyContacts.employeeId, req.employeeId), isNull(emergencyContacts.archivedAt)));
    if (contacts.length) await tx.insert(emergencyContacts).values(contacts.map((c) => ({ ...c, employeeId: req.employeeId })));
    await recordHistory(tx, {
      employeeId: req.employeeId,
      eventType: "profile_changed",
      summary: `Emergency contacts updated (${contacts.length}), approved request`,
      changedBy: actorId,
    });
    return { ok: true, data: undefined };
  }

  // bank
  if (!req.payloadEnc) return fail("This request has no details to apply.");
  const v = JSON.parse(fieldCrypto().decrypt(req.payloadEnc, changeRequestContext(req.id))) as { bankName: string; bankAccountName: string; bankAccountNumber: string };
  const changed = await upsertSensitive(tx, req.employeeId, { bankName: v.bankName, bankAccountName: v.bankAccountName, bankAccountNumber: v.bankAccountNumber }, actorId);
  await recordHistory(tx, {
    employeeId: req.employeeId,
    eventType: "sensitive_changed",
    summary: changed.length ? "Bank details updated, approved request" : "Bank details request approved, nothing changed",
    changedBy: actorId,
  });
  return { ok: true, data: undefined };
}

// --- Clients and assignments --------------------------------------------------

export async function createClient(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.manage_clients");
    const parsed = clientSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    try {
      await db.transaction(async (tx) => {
        const [c] = await tx.insert(clients).values({ ...parsed.data, createdBy: actor.id }).returning({ id: clients.id });
        await writeAudit({ actor, action: "client.create", targetType: "client", targetId: c.id, after: parsed.data }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("A client with that name already exists.");
      throw error;
    }
    revalidatePath("/people/clients");
    return { ok: true, data: undefined };
  });
}

export async function updateClient(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.manage_clients");
    const parsed = updateClientSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { clientId, ...v } = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(clients).where(eq(clients.id, clientId)).for("update");
        if (!before) return fail("That client was not found.");
        await tx.update(clients).set({ ...v, updatedAt: new Date() }).where(eq(clients.id, clientId));
        await writeAudit(
          {
            actor,
            action: "client.update",
            targetType: "client",
            targetId: clientId,
            before: { name: before.name, timeZone: before.timeZone, isActive: before.isActive },
            after: v,
          },
          tx,
        );
        return { ok: true, data: undefined } as const;
      });
      revalidatePath("/people/clients");
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) return fail("A client with that name already exists.");
      throw error;
    }
  });
}

export async function assignClient(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.manage_assignments");
    const parsed = assignmentSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        const [client] = await tx.select({ name: clients.name, isActive: clients.isActive }).from(clients).where(and(eq(clients.id, v.clientId), isNull(clients.archivedAt))).limit(1);
        const [person] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, v.employeeId), isNull(employees.archivedAt))).limit(1);
        if (!client || !person) return fail("That person or client was not found.");
        if (!client.isActive) return fail("That client is inactive.");

        const [a] = await tx
          .insert(clientAssignments)
          .values({ employeeId: v.employeeId, clientId: v.clientId, startDate: v.startDate, hoursPerWeek: v.hoursPerWeek?.toString(), createdBy: actor.id })
          .returning({ id: clientAssignments.id });
        await recordHistory(tx, {
          employeeId: v.employeeId,
          eventType: "client_assigned",
          summary: `Assigned to ${client.name}${v.hoursPerWeek ? ` (${v.hoursPerWeek} h/week)` : ""}`,
          after: { clientId: v.clientId, startDate: v.startDate, hoursPerWeek: v.hoursPerWeek ?? null },
          changedBy: actor.id,
          effectiveDate: v.startDate,
        });
        await writeAudit({ actor, action: "assignment.create", targetType: "employee", targetId: v.employeeId, metadata: { assignmentId: a.id, clientId: v.clientId } }, tx);
        return { ok: true, data: undefined } as const;
      });
      if (result.ok) revalidateEmployee(v.employeeId);
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) return fail("That person is already assigned to this client.");
      throw error;
    }
  });
}

export async function endAssignment(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.manage_assignments");
    const parsed = endAssignmentSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const result = await db.transaction(async (tx) => {
      const [a] = await tx.select().from(clientAssignments).where(eq(clientAssignments.id, parsed.data.assignmentId)).for("update");
      if (!a) return fail("That assignment was not found.");
      if (a.endDate) return fail("That assignment has already ended.");
      if (parsed.data.endDate < a.startDate) return fail("The end date cannot be before the start date.");

      const [client] = await tx.select({ name: clients.name }).from(clients).where(eq(clients.id, a.clientId)).limit(1);
      await tx.update(clientAssignments).set({ endDate: parsed.data.endDate, updatedAt: new Date() }).where(eq(clientAssignments.id, a.id));
      await recordHistory(tx, {
        employeeId: a.employeeId,
        eventType: "client_ended",
        summary: `Assignment to ${client?.name ?? "client"} ended`,
        before: { endDate: null },
        after: { endDate: parsed.data.endDate },
        changedBy: actor.id,
        effectiveDate: parsed.data.endDate,
      });
      await writeAudit({ actor, action: "assignment.end", targetType: "employee", targetId: a.employeeId, metadata: { assignmentId: a.id } }, tx);
      revalidateEmployee(a.employeeId);
      return { ok: true, data: undefined } as const;
    });
    return result;
  });
}

// --- Custom fields -------------------------------------------------------------

export async function createCustomFieldDef(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.manage_custom_fields");
    const parsed = customFieldDefSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    try {
      await db.transaction(async (tx) => {
        const [d] = await tx.insert(customFieldDefs).values({ ...parsed.data, options: parsed.data.fieldType === "select" ? parsed.data.options : null }).returning({ id: customFieldDefs.id });
        await writeAudit({ actor, action: "custom_field.create", targetType: "custom_field", targetId: d.id, after: { key: parsed.data.key, label: parsed.data.label, fieldType: parsed.data.fieldType, visibility: parsed.data.visibility } }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("A field with that key already exists.");
      throw error;
    }
    revalidatePath("/people/fields");
    return { ok: true, data: undefined };
  });
}

export async function archiveCustomFieldDef(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.manage_custom_fields");
    const parsedId = archiveCustomFieldSchema.safeParse(input);
    if (!parsedId.success) return fail(BAD_FORM);
    const id = { data: parsedId.data.fieldDefId };

    const result = await db.transaction(async (tx) => {
      const [d] = await tx.update(customFieldDefs).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(customFieldDefs.id, id.data), isNull(customFieldDefs.archivedAt))).returning({ key: customFieldDefs.key });
      if (!d) return fail("That field was not found.");
      await writeAudit({ actor, action: "custom_field.archive", targetType: "custom_field", targetId: id.data, metadata: { key: d.key } }, tx);
      return { ok: true, data: undefined } as const;
    });
    revalidatePath("/people/fields");
    return result;
  });
}

export async function setCustomFieldValues(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "people.edit_profile");
    const parsed = customFieldValuesSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_FORM);
    const { employeeId, values } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const defs = await tx.select().from(customFieldDefs).where(isNull(customFieldDefs.archivedAt));
      const byId = new Map(defs.map((d) => [d.id, d]));
      const changedKeys: string[] = [];

      for (const [defId, raw] of Object.entries(values)) {
        const def = byId.get(defId);
        if (!def) return fail("One of those fields no longer exists.");

        if (raw === "") {
          if (def.isRequired) return fail(`${def.label} is required.`);
          const removed = await tx.delete(customFieldValues).where(and(eq(customFieldValues.employeeId, employeeId), eq(customFieldValues.fieldDefId, defId))).returning({ v: customFieldValues.value });
          if (removed.length) changedKeys.push(def.key);
          continue;
        }
        if (def.fieldType === "number" && !Number.isFinite(Number(raw))) return fail(`${def.label} must be a number.`);
        if (def.fieldType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail(`${def.label} must be a date (YYYY-MM-DD).`);
        if (def.fieldType === "select" && !(def.options ?? []).includes(raw)) return fail(`Choose one of the listed options for ${def.label}.`);

        await tx
          .insert(customFieldValues)
          .values({ employeeId, fieldDefId: defId, value: raw, updatedBy: actor.id })
          .onConflictDoUpdate({ target: [customFieldValues.employeeId, customFieldValues.fieldDefId], set: { value: raw, updatedBy: actor.id, updatedAt: new Date() }, setWhere: sql`${customFieldValues.value} is distinct from ${raw}` });
        changedKeys.push(def.key);
      }

      if (changedKeys.length === 0) return fail("No changes to save.");
      await writeAudit({ actor, action: "custom_field.value_update", targetType: "employee", targetId: employeeId, metadata: { fields: changedKeys } }, tx);
      return { ok: true, data: undefined } as const;
    });
    if (result.ok) revalidateEmployee(employeeId);
    return result;
  });
}

