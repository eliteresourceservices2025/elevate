import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fieldCrypto } from "@/lib/crypto";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { todayInZone } from "@/modules/org/service";
import { clients, employees } from "@/modules/people/schema";
import { clientKey, personKey } from "./parse";
import { buildPlan, type LiveData, type Plan } from "./plan";
import type { Layout, Observation } from "./reader";
import { scheduleImportAliases, scheduleImportBatches, scheduleImportLayouts } from "./schema";

// Staging, previewing and remembering matches for an attendance-sheet import. Callers authorize first (these helpers take the acting
// user as a parameter, so they live outside the "use server" file).

export type Actor = { id: string; email: string };
const context = (batchId: string) => `schedule_import:${batchId}`;

export type StageInput = { fileName: string; layout: Layout; columns: Record<string, number | null> | null; observations: Observation[]; sha256: string };

export async function stageSheet(actor: Actor, input: StageInput): Promise<{ batchId: string; observations: number; pairs: number }> {
  if (input.observations.length === 0) throw new ActionFailure("No days with a clock-in were found in that file.");
  const batchId = randomUUID();
  const pairs = new Set(input.observations.map((o) => `${o.name}|${o.client}`)).size;
  const payloadEnc = fieldCrypto().encrypt(JSON.stringify(input.observations), context(batchId));
  await db.transaction(async (tx) => {
    await tx.insert(scheduleImportBatches).values({
      id: batchId,
      fileName: input.fileName.slice(0, 200),
      layout: input.layout,
      columns: input.columns,
      sourceSha256: input.sha256,
      observationCount: input.observations.length,
      pairCount: pairs,
      payloadEnc,
      createdBy: actor.id,
    });
    // Counts only: never a name, a client or a schedule text.
    await writeAudit({ actor, action: "scheduleimport.stage", targetType: "schedule_import_batch", targetId: batchId, after: { layout: input.layout, observations: input.observations.length, pairs } }, tx);
  });
  return { batchId, observations: input.observations.length, pairs };
}

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

/** What ELEVATE holds now, in the shape the plan compares against, with the matches HR confirmed earlier. Read-only. */
export async function loadLiveData(): Promise<LiveData> {
  const employeeRows = await rows<{ id: string; work_email: string; first: string; middle: string | null; last: string; preferred: string | null; status: string }>(sql`
    select id, work_email, legal_first_name as first, legal_middle_name as middle, legal_last_name as last, preferred_name as preferred, status
    from core.employees where archived_at is null`);
  const clientRows = await rows<{ id: string; name: string }>(sql`select id, name from core.clients where archived_at is null and is_active`);
  const assignments = await rows<{ id: string; employee_id: string; client_id: string; start_date: string; end_date: string | null; hours_per_week: string | null }>(sql`
    select id, employee_id, client_id, start_date::text, end_date::text, hours_per_week::text from core.client_assignments where end_date is null`);
  const schedules = await rows<{ id: string; employee_id: string; effective_from: string; effective_to: string | null; start_time: string; end_time: string; zone: string; weekdays: number[]; break_minutes: number }>(sql`
    select id, employee_id, effective_from::text, effective_to::text, start_time, end_time, zone, weekdays, break_minutes from time.schedules where effective_to is null`);
  const aliasRows = await rows<{ kind: string; sheet_key: string; employee_id: string | null; client_id: string | null }>(sql`select kind, sheet_key, employee_id, client_id from ops.schedule_import_aliases`);
  const aliases = { persons: {} as Record<string, string>, clients: {} as Record<string, string> };
  for (const a of aliasRows) {
    if (a.kind === "person" && a.employee_id) aliases.persons[a.sheet_key] = a.employee_id;
    if (a.kind === "client" && a.client_id) aliases.clients[a.sheet_key] = a.client_id;
  }
  return {
    employees: employeeRows.map((e) => ({ id: e.id, workEmail: e.work_email, first: e.first, middle: e.middle, last: e.last, preferred: e.preferred, status: e.status })),
    clients: clientRows,
    assignments: assignments.map((a) => ({ id: a.id, employeeId: a.employee_id, clientId: a.client_id, startDate: a.start_date, endDate: a.end_date, hoursPerWeek: a.hours_per_week === null ? null : Number(a.hours_per_week) })),
    schedules: schedules.map((s) => ({ id: s.id, employeeId: s.employee_id, effectiveFrom: s.effective_from, effectiveTo: s.effective_to, startTime: s.start_time, endTime: s.end_time, zone: s.zone, weekdays: s.weekdays, breakMinutes: s.break_minutes })),
    aliases,
  };
}

export async function planForBatch(batchId: string): Promise<{ batch: { id: string; fileName: string; layout: string; createdAt: Date; observations: number }; plan: Plan } | null> {
  const [b] = await db.select().from(scheduleImportBatches).where(eq(scheduleImportBatches.id, batchId));
  if (!b || b.status !== "preview" || !b.payloadEnc) return null;
  const observations = JSON.parse(fieldCrypto().decrypt(b.payloadEnc, context(b.id))) as Observation[];
  const plan = buildPlan(observations, await loadLiveData(), { today: todayInZone() });
  return { batch: { id: b.id, fileName: b.fileName, layout: b.layout, createdAt: b.createdAt, observations: b.observationCount }, plan };
}

export async function discardBatch(actor: Actor, batchId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [b] = await tx.select({ id: scheduleImportBatches.id, status: scheduleImportBatches.status }).from(scheduleImportBatches).where(eq(scheduleImportBatches.id, batchId)).for("update");
    if (!b) throw new ActionFailure("That import was not found.");
    if (b.status === "discarded") return;
    await tx.update(scheduleImportBatches).set({ status: "discarded", payloadEnc: null, discardedAt: new Date() }).where(eq(scheduleImportBatches.id, batchId));
    await writeAudit({ actor, action: "scheduleimport.discard", targetType: "schedule_import_batch", targetId: batchId }, tx);
  });
}

/** Previews nobody used within 14 days are wiped (the daily import purge calls this). */
export async function purgeStaleScheduleBatches(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 14 * 86_400_000);
  const stale = await db
    .update(scheduleImportBatches)
    .set({ status: "discarded", payloadEnc: null, discardedAt: now })
    .where(and(eq(scheduleImportBatches.status, "preview"), isNotNull(scheduleImportBatches.payloadEnc), lt(scheduleImportBatches.createdAt, cutoff)))
    .returning({ id: scheduleImportBatches.id });
  return stale.length;
}

// ---- Remembered matches ---------------------------------------------------------------------------------------------------------

export type AliasInput = { kind: "person" | "client"; sheetValue: string; targetId: string };

/**
 * Remembers that a sheet's spelling of a person or client is a specific record, so later sheets match without asking. The record must
 * exist and be active. A repeat for the same spelling replaces the earlier choice. Audited with the kind only.
 */
export async function saveAlias(actor: Actor, input: AliasInput): Promise<void> {
  const key = input.kind === "person" ? personKey(input.sheetValue) : clientKey(input.sheetValue);
  if (!key) throw new ActionFailure("That spelling cannot be remembered.");
  await db.transaction(async (tx) => {
    if (input.kind === "person") {
      const [p] = await tx.select({ id: employees.id, status: employees.status }).from(employees).where(and(eq(employees.id, input.targetId), isNull(employees.archivedAt)));
      if (!p || p.status === "separated") throw new ActionFailure("That person was not found or is no longer active.");
    } else {
      const [c] = await tx.select({ id: clients.id, isActive: clients.isActive }).from(clients).where(and(eq(clients.id, input.targetId), isNull(clients.archivedAt)));
      if (!c || !c.isActive) throw new ActionFailure("That client was not found or is inactive.");
    }
    const values = { kind: input.kind, sheetKey: key, employeeId: input.kind === "person" ? input.targetId : null, clientId: input.kind === "client" ? input.targetId : null, createdBy: actor.id };
    await tx
      .insert(scheduleImportAliases)
      .values(values)
      .onConflictDoUpdate({ target: [scheduleImportAliases.kind, scheduleImportAliases.sheetKey], set: { employeeId: values.employeeId, clientId: values.clientId, createdBy: actor.id, createdAt: new Date() } });
    await writeAudit({ actor, action: "scheduleimport.alias_save", targetType: "schedule_import_alias", targetId: input.targetId, after: { kind: input.kind } }, tx);
  });
}

export async function removeAlias(actor: Actor, aliasId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx.delete(scheduleImportAliases).where(eq(scheduleImportAliases.id, aliasId)).returning({ kind: scheduleImportAliases.kind });
    if (removed.length === 0) throw new ActionFailure("That remembered match was not found.");
    await writeAudit({ actor, action: "scheduleimport.alias_remove", targetType: "schedule_import_alias", targetId: aliasId, after: { kind: removed[0].kind } }, tx);
  });
}

// ---- Remembered column layouts --------------------------------------------------------------------------------------------------

/** A header row as a stable key: case, spacing and punctuation ignored, order kept. */
export const headerKey = (headers: string[]): string =>
  createHash("sha256")
    .update(headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).join("|"))
    .digest("hex");

export async function findLayout(headers: string[]): Promise<Record<string, number | null> | null> {
  const [row] = await db.select({ columns: scheduleImportLayouts.columns }).from(scheduleImportLayouts).where(eq(scheduleImportLayouts.headerKey, headerKey(headers)));
  return row?.columns ?? null;
}

export async function saveLayout(actor: Actor, headers: string[], columns: Record<string, number | null>): Promise<void> {
  const key = headerKey(headers);
  await db
    .insert(scheduleImportLayouts)
    .values({ headerKey: key, columns, createdBy: actor.id })
    .onConflictDoUpdate({ target: scheduleImportLayouts.headerKey, set: { columns, createdBy: actor.id, updatedAt: new Date() } });
}
