import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fieldCrypto } from "@/lib/crypto";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { customFieldDefs, customFieldValues, emergencyContacts, employeeSensitive, employees } from "@/modules/people/schema";
import { createEmployeeRecord } from "@/modules/people/create";
import { positions, teams, departments } from "@/modules/org/schema";
import { applyReporting, todayInZone } from "@/modules/org/service";
import { recordHistory, upsertSensitive, type Tx } from "@/modules/people/service";
import { changedFields, normalizeRow, type DateFormat, type Issue, type NormalizedRow } from "./normalize";
import { importBatches, importRows } from "./schema";

// Staging, committing and rolling back an import from TalentHR. Callers authorize first (these helpers take the acting user as a
// parameter, so they live outside the "use server" file).

export type Actor = { id: string; email: string };
const IMPORT_DEPARTMENT = "Imported from TalentHR";
const rowContext = (batchId: string, rowNo: number) => `import_row:${batchId}:${rowNo}`;
const encryptRow = (batchId: string, rowNo: number, row: NormalizedRow) => fieldCrypto().encrypt(JSON.stringify(row), rowContext(batchId, rowNo));
export const decryptRow = (batchId: string, rowNo: number, enc: string): NormalizedRow => JSON.parse(fieldCrypto().decrypt(enc, rowContext(batchId, rowNo))) as NormalizedRow;

export type StageInput = { fileName: string; headers: string[]; rows: Record<string, string>[]; mapping: Record<string, string>; dateFormat: DateFormat };

/** Reads the whole file through the mapping, compares it with who is already in ELEVATE and saves the result as a batch to preview. */
export async function stageBatch(actor: Actor, input: StageInput): Promise<{ batchId: string; summary: Record<string, number> }> {
  const today = todayInZone();
  const rows = input.rows.map((r) => normalizeRow(r, input.mapping, { dateFormat: input.dateFormat, today }));

  // Checks that need the whole file
  const emailRow = new Map<string, number>();
  const idRow = new Map<string, number>();
  rows.forEach((r, i) => {
    const email = r.input?.workEmail ?? null;
    if (email) {
      if (emailRow.has(email)) r.issues.push({ level: "error", field: "Work email", message: "The same work email appears on an earlier row" });
      else emailRow.set(email, i);
    }
    if (r.sourceId) {
      if (idRow.has(r.sourceId)) r.issues.push({ level: "error", field: "TalentHR ID", message: "The same TalentHR ID appears on an earlier row" });
      else idRow.set(r.sourceId, i);
    }
  });
  rows.forEach((r, i) => {
    if (!r.supervisorSourceId) return;
    const sup = idRow.get(r.supervisorSourceId);
    if (sup === undefined) r.issues.push({ level: "warning", field: "Reports to", message: "The supervisor's ID is not in this file, so no manager is set" });
    else if (sup === i) r.issues.push({ level: "warning", field: "Reports to", message: "A person cannot report to themselves, no manager is set" });
    else if (rows[sup].input?.status === "separated" && r.input?.status !== "separated") r.issues.push({ level: "warning", field: "Reports to", message: "The supervisor is terminated, so no manager is set" });
  });

  const emails = [...emailRow.keys()];
  const existing = emails.length ? await db.select().from(employees).where(inArray(sql`lower(${employees.workEmail})`, emails)) : [];
  const byEmail = new Map(existing.map((e) => [e.workEmail.toLowerCase(), e]));

  const batchId = randomUUID();
  const staged = rows.map((r, i) => {
    const hasError = r.issues.some((x) => x.level === "error") || !r.input;
    let outcome: "new" | "changed" | "unchanged" | "error" = "error";
    let changed: string[] = [];
    if (!hasError && r.input) {
      const current = byEmail.get(r.input.workEmail);
      if (!current) outcome = "new";
      else {
        changed = changedFields(r.input, current as unknown as Record<string, unknown>);
        if (current.userId) {
          const locked = ["status", "startDate", "endDate"];
          if (changed.some((c) => locked.includes(c))) r.issues.push({ level: "warning", field: "Status and dates", message: "This person already has an ELEVATE account, so status and dates are not changed" });
          changed = changed.filter((c) => !locked.includes(c));
        }
        outcome = changed.length > 0 ? "changed" : "unchanged";
      }
    }
    return { rowNo: i + 1, outcome, changed, row: r };
  });

  const count = (o: string) => staged.filter((s) => s.outcome === o).length;
  const summary: Record<string, number> = {
    total: staged.length,
    new: count("new"),
    changed: count("changed"),
    unchanged: count("unchanged"),
    errors: count("error"),
    warnings: staged.filter((s) => s.row.issues.some((x) => x.level === "warning")).length,
    fileTerminated: staged.filter((s) => s.row.input?.status === "separated").length,
    fileCurrent: staged.filter((s) => s.row.input && s.row.input.status !== "separated").length,
  };

  await db.transaction(async (tx) => {
    await tx.insert(importBatches).values({ id: batchId, fileName: input.fileName.slice(0, 120), dateFormat: input.dateFormat, mapping: input.mapping, rowCount: staged.length, summary, createdBy: actor.id });
    for (let i = 0; i < staged.length; i += 100) {
      const chunk = staged.slice(i, i + 100);
      await tx.insert(importRows).values(
        chunk.map((s) => ({
          batchId,
          rowNo: s.rowNo,
          outcome: s.outcome,
          changedFields: s.changed,
          issues: s.row.issues,
          payloadEnc: s.outcome === "error" && !s.row.input ? null : encryptRow(batchId, s.rowNo, s.row),
        })),
      );
    }
    await writeAudit({ actor, action: "import.stage", targetType: "import_batch", targetId: batchId, after: summary }, tx);
  });
  return { batchId, summary };
}

// ---- Commit ----------------------------------------------------------------------------------------------------------------

const slug = (label: string) => `imp_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)}`;

async function teamIdFor(tx: Tx, name: string, cache: Map<string, string>): Promise<string> {
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const [found] = await tx.select({ id: teams.id }).from(teams).where(and(sql`lower(${teams.name}) = ${key}`, isNull(teams.archivedAt)));
  if (found) return (cache.set(key, found.id), found.id);
  let [dept] = await tx.select({ id: departments.id }).from(departments).where(sql`lower(${departments.name}) = ${IMPORT_DEPARTMENT.toLowerCase()}`);
  if (!dept) [dept] = await tx.insert(departments).values({ name: IMPORT_DEPARTMENT }).returning({ id: departments.id });
  const [made] = await tx.insert(teams).values({ departmentId: dept.id, name }).returning({ id: teams.id });
  cache.set(key, made.id);
  return made.id;
}

async function positionFor(tx: Tx, title: string, cache: Map<string, { id: string; title: string }>) {
  const key = title.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const [found] = await tx.select({ id: positions.id, title: positions.title }).from(positions).where(and(sql`lower(${positions.title}) = ${key}`, isNull(positions.archivedAt)));
  if (found) return (cache.set(key, found), found);
  const [made] = await tx.insert(positions).values({ title }).returning({ id: positions.id, title: positions.title });
  cache.set(key, made);
  return made;
}

async function customDefId(tx: Tx, label: string, cache: Map<string, string>): Promise<string> {
  const key = slug(label);
  const hit = cache.get(key);
  if (hit) return hit;
  const [found] = await tx.select({ id: customFieldDefs.id }).from(customFieldDefs).where(eq(customFieldDefs.key, key));
  if (found) return (cache.set(key, found.id), found.id);
  const [made] = await tx.insert(customFieldDefs).values({ key, label: label.slice(0, 60), fieldType: "text", visibility: "hr_only" }).returning({ id: customFieldDefs.id });
  cache.set(key, made.id);
  return made.id;
}

export type CommitResult = { created: number; updated: number; restored: number; skipped: number; managersSet: number; managerWarnings: number };

export async function commitBatch(actor: Actor, batchId: string, opts: { skipErrors: boolean }): Promise<CommitResult> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for("update");
    if (!batch) throw new ActionFailure("That import was not found.");
    if (batch.status !== "preview") throw new ActionFailure("This import was already committed or closed.");
    const rows = await tx.select().from(importRows).where(eq(importRows.batchId, batchId)).orderBy(asc(importRows.rowNo));
    const errorRows = rows.filter((r) => r.outcome === "error");
    if (errorRows.length > 0 && !opts.skipErrors) throw new ActionFailure(`${errorRows.length} ${errorRows.length === 1 ? "row has" : "rows have"} errors. Fix the file, or choose to skip them.`);

    const teamCache = new Map<string, string>();
    const positionCache = new Map<string, { id: string; title: string }>();
    const defCache = new Map<string, string>();
    const today = todayInZone();
    const result: CommitResult = { created: 0, updated: 0, restored: 0, skipped: 0, managersSet: 0, managerWarnings: 0 };
    const idOfSource = new Map<string, string>();
    const done: { rowId: string; employeeId: string; row: NormalizedRow }[] = [];

    for (const r of rows) {
      if (r.outcome === "error" || !r.payloadEnc) {
        await tx.update(importRows).set({ state: "skipped", payloadEnc: null }).where(eq(importRows.id, r.id));
        result.skipped += 1;
        continue;
      }
      const row = decryptRow(batchId, r.rowNo, r.payloadEnc);
      const input = row.input as NonNullable<NormalizedRow["input"]>;
      const teamId = row.teamName ? await teamIdFor(tx, row.teamName, teamCache) : undefined;
      const position = row.positionTitle ? await positionFor(tx, row.positionTitle, positionCache) : null;

      const [current] = await tx.select().from(employees).where(sql`lower(${employees.workEmail}) = ${input.workEmail}`);
      let employeeId: string;
      let created = false;
      if (!current) {
        const made = await createEmployeeRecord(tx, actor, { ...input, teamId, positionId: position?.id }, "Imported from TalentHR");
        employeeId = made.id;
        created = true;
        result.created += 1;
      } else {
        employeeId = current.id;
        const locked = current.userId !== null;
        const set: Record<string, unknown> = { updatedAt: new Date() };
        for (const k of r.changedFields) {
          // eslint-disable-next-line security/detect-object-injection -- k is a field name saved by stageBatch from a fixed list
          set[k] = (input as unknown as Record<string, unknown>)[k];
        }
        if (!locked) {
          if (input.status) set.status = input.status;
          if (input.startDate) set.startDate = input.startDate;
          set.endDate = input.status === "separated" ? (input.endDate ?? null) : null;
        }
        if (position) {
          set.positionId = position.id;
          set.position = position.title;
        }
        if (current.archivedAt) {
          set.archivedAt = null;
          result.restored += 1;
        }
        await tx.update(employees).set(set).where(eq(employees.id, current.id));
        if (teamId && teamId !== current.teamId) {
          const eff = input.startDate && input.startDate < today ? input.startDate : today;
          const moved = await applyReporting(tx, { employeeId, teamId, effectiveDate: eff }, actor.id);
          if (!moved.ok) await tx.update(importRows).set({ issues: [...r.issues, { level: "warning", field: "Team", message: moved.error }] }).where(eq(importRows.id, r.id));
        }
        await recordHistory(tx, { employeeId, eventType: "profile_changed", summary: "Updated from TalentHR import", after: { fields: r.changedFields }, changedBy: actor.id });
        result.updated += 1;
      }

      if (row.pay) {
        await upsertSensitive(tx, employeeId, { payRate: row.pay.rate }, actor.id);
        await tx.update(employeeSensitive).set({ payCurrency: row.pay.currency }).where(eq(employeeSensitive.employeeId, employeeId));
      }
      if (row.emergency) {
        const have = await tx.select({ id: emergencyContacts.id }).from(emergencyContacts).where(and(eq(emergencyContacts.employeeId, employeeId), isNull(emergencyContacts.archivedAt)));
        if (have.length === 0) await tx.insert(emergencyContacts).values({ employeeId, ...row.emergency, isPrimary: true });
      }
      for (const [label, value] of Object.entries(row.custom)) {
        const fieldDefId = await customDefId(tx, label, defCache);
        await tx.insert(customFieldValues).values({ employeeId, fieldDefId, value, updatedBy: actor.id }).onConflictDoUpdate({ target: [customFieldValues.employeeId, customFieldValues.fieldDefId], set: { value, updatedBy: actor.id, updatedAt: new Date() } });
      }
      if (row.sourceId) idOfSource.set(row.sourceId, employeeId);
      done.push({ rowId: r.id, employeeId, row });
      await tx.update(importRows).set({ state: "committed", employeeId, created: created ? "yes" : "no", payloadEnc: null }).where(eq(importRows.id, r.id));
    }

    // Managers last, once everyone exists. Each goes through the dated reporting rules; a refusal is a warning on that row, not a failure.
    for (const d of done) {
      if (!d.row.supervisorSourceId) continue;
      const managerId = idOfSource.get(d.row.supervisorSourceId);
      if (!managerId || managerId === d.employeeId) continue;
      const input = d.row.input as NonNullable<NormalizedRow["input"]>;
      const eff = input.startDate && input.startDate < today ? input.startDate : today;
      let message: string | null = null;
      try {
        await tx.transaction(async (sp) => {
          const res = await applyReporting(sp as unknown as Tx, { employeeId: d.employeeId, managerId, effectiveDate: eff }, actor.id);
          if (!res.ok) throw new ActionFailure(res.error);
        });
        result.managersSet += 1;
      } catch (e) {
        message = e instanceof ActionFailure ? e.message : "The manager could not be set";
        result.managerWarnings += 1;
      }
      if (message) {
        const [row] = await tx.select({ issues: importRows.issues }).from(importRows).where(eq(importRows.id, d.rowId));
        await tx.update(importRows).set({ issues: [...(row?.issues ?? []), { level: "warning", field: "Reports to", message }] }).where(eq(importRows.id, d.rowId));
      }
    }

    await tx.update(importBatches).set({ status: "committed", committedBy: actor.id, committedAt: new Date(), summary: { ...batch.summary, ...result } }).where(eq(importBatches.id, batchId));
    await writeAudit({ actor, action: "import.commit", targetType: "import_batch", targetId: batchId, after: result }, tx);
    return result;
  });
}

// ---- Rollback, discard, clean-up --------------------------------------------------------------------------------------------

const ACTIVITY_TABLES = ["time.clock_events", "time.leave_ledger", "time.leave_requests", "time.schedules", "talent.asset_assignments"] as const;

async function hasActivity(tx: Tx, employeeId: string): Promise<boolean> {
  for (const table of ACTIVITY_TABLES) {
    const rows = (await tx.execute(sql`select 1 from ${sql.raw(table)} where employee_id = ${employeeId} limit 1`)) as unknown as unknown[];
    if (rows.length > 0) return true;
  }
  return false;
}

export type RollbackResult = { archived: number; kept: number; updatedNotUndone: number };

/**
 * Takes back a committed batch as far as the rules allow: people it CREATED are archived (never deleted) unless they have signed in or
 * have activity (clock events, leave, schedules, equipment); those are kept and counted. Changes the batch made to people who already
 * existed are not undone. Re-importing the same file restores the archived people.
 */
export async function rollbackBatch(actor: Actor, batchId: string): Promise<RollbackResult> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for("update");
    if (!batch) throw new ActionFailure("That import was not found.");
    if (batch.status !== "committed") throw new ActionFailure("Only a committed import can be rolled back.");
    const rows = await tx.select().from(importRows).where(and(eq(importRows.batchId, batchId), eq(importRows.state, "committed")));
    const result: RollbackResult = { archived: 0, kept: 0, updatedNotUndone: rows.filter((r) => r.created === "no").length };
    for (const r of rows) {
      if (r.created !== "yes" || !r.employeeId) continue;
      const [e] = await tx.select({ userId: employees.userId, archivedAt: employees.archivedAt }).from(employees).where(eq(employees.id, r.employeeId));
      if (!e || e.userId !== null || (await hasActivity(tx, r.employeeId))) {
        await tx.update(importRows).set({ state: "kept" }).where(eq(importRows.id, r.id));
        result.kept += 1;
        continue;
      }
      await tx.update(employees).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(employees.id, r.employeeId));
      await recordHistory(tx, { employeeId: r.employeeId, eventType: "profile_changed", summary: "Archived: TalentHR import rolled back", changedBy: actor.id });
      await tx.update(importRows).set({ state: "rolled_back" }).where(eq(importRows.id, r.id));
      result.archived += 1;
    }
    await tx.update(importBatches).set({ status: "rolled_back", rolledBackAt: new Date(), summary: { ...batch.summary, ...result } }).where(eq(importBatches.id, batchId));
    await writeAudit({ actor, action: "import.rollback", targetType: "import_batch", targetId: batchId, after: result }, tx);
    return result;
  });
}

/** Throws a preview batch away: its encrypted rows are wiped at once. */
export async function discardBatch(actor: Actor | null, batchId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [b] = await tx.update(importBatches).set({ status: "discarded" }).where(and(eq(importBatches.id, batchId), eq(importBatches.status, "preview"))).returning({ id: importBatches.id });
    if (!b) return false;
    await tx.update(importRows).set({ payloadEnc: null }).where(eq(importRows.batchId, batchId));
    await writeAudit({ actor, action: "import.discard", targetType: "import_batch", targetId: batchId }, tx);
    return true;
  });
}

/** Daily: a preview nobody committed within 14 days is discarded, so personal data does not sit in the quarantine. */
export async function discardStaleBatches(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 14 * 86_400_000);
  const stale = await db.select({ id: importBatches.id }).from(importBatches).where(and(eq(importBatches.status, "preview"), lt(importBatches.createdAt, cutoff)));
  let n = 0;
  for (const b of stale) if (await discardBatch(null, b.id)) n += 1;
  return n;
}

export type { Issue };
