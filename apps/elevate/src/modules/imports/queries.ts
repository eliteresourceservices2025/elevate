import "server-only";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { authorize, ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { employees } from "@/modules/people/schema";
import { importBatches, importPullItems, importRows } from "./schema";
import { decryptRow } from "./service";

// Reads for the import pages. HR and Super Admin only. Personal data is shown only for staged rows (decrypted here) and committed people.

async function gate() {
  const user = await requireUser();
  await authorize(user, "imports.manage");
  return user;
}

export async function listBatches() {
  await gate();
  return db.select().from(importBatches).orderBy(desc(importBatches.createdAt)).limit(50);
}

export async function getBatch(id: string) {
  await gate();
  const [b] = await db.select().from(importBatches).where(eq(importBatches.id, id));
  if (!b) throw new ForbiddenError("imports.manage"); // shown as not found
  return b;
}

export const ROW_FILTERS = ["all", "new", "changed", "unchanged", "error", "warnings"] as const;
export type RowFilter = (typeof ROW_FILTERS)[number];

export type RowView = { rowNo: number; outcome: string; state: string; name: string; email: string; detail: string; changedFields: string[]; issues: { level: string; field: string; message: string }[] };

export async function listBatchRows(batchId: string, input: { filter: RowFilter; page: number; pageSize: number }): Promise<{ rows: RowView[]; total: number }> {
  await gate();
  const where =
    input.filter === "all"
      ? eq(importRows.batchId, batchId)
      : input.filter === "warnings"
        ? and(eq(importRows.batchId, batchId), sql`exists (select 1 from jsonb_array_elements(${importRows.issues}) i where i->>'level' = 'warning')`)
        : and(eq(importRows.batchId, batchId), eq(importRows.outcome, input.filter));
  const [{ n }] = await db.select({ n: count() }).from(importRows).where(where);
  const page = await db
    .select()
    .from(importRows)
    .where(where)
    .orderBy(importRows.rowNo)
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const empIds = page.flatMap((r) => (r.employeeId ? [r.employeeId] : []));
  const people = empIds.length ? await db.select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, email: employees.workEmail, status: employees.status }).from(employees).where(inArray(employees.id, empIds)) : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const rows = page.map((r): RowView => {
    let name = "";
    let email = "";
    let detail = "";
    if (r.payloadEnc) {
      try {
        const d = decryptRow(batchId, r.rowNo, r.payloadEnc);
        name = d.input ? `${d.input.legalFirstName} ${d.input.legalLastName}` : "";
        email = d.input?.workEmail ?? "";
        detail = [d.positionTitle, d.teamName, d.input?.status].filter(Boolean).join(", ");
      } catch {
        detail = "Could not be read";
      }
    } else if (r.employeeId) {
      const p = byId.get(r.employeeId);
      if (p) {
        name = `${p.first} ${p.last}`;
        email = p.email;
        detail = p.status;
      }
    }
    return { rowNo: r.rowNo, outcome: r.outcome, state: r.state, name, email, detail, changedFields: r.changedFields, issues: r.issues };
  });
  return { rows, total: n };
}

export type Reconciliation = {
  checks: { label: string; expected: number; actual: number }[];
  clean: boolean;
  warnings: number;
  signedOffAt: Date | null;
  notes: string[];
};

/** File versus ELEVATE for a committed batch. Counts only; documents and leave are compared when they are pulled from TalentHR's API. */
export async function getReconciliation(batchId: string): Promise<Reconciliation> {
  await gate();
  const [b] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!b) throw new ForbiddenError("imports.manage");
  const s = b.summary;
  const rows = await db.select({ employeeId: importRows.employeeId, state: importRows.state }).from(importRows).where(eq(importRows.batchId, batchId));
  const ids = rows.flatMap((r) => (r.employeeId && (r.state === "committed" || r.state === "kept") ? [r.employeeId] : []));
  const people = ids.length ? await db.select({ status: employees.status, archivedAt: employees.archivedAt }).from(employees).where(inArray(employees.id, ids)) : [];
  const live = people.filter((p) => !p.archivedAt);
  const elevateSeparated = live.filter((p) => p.status === "separated").length;
  const checks = [
    { label: "People in the file", expected: s.total ?? 0, actual: rows.filter((r) => r.state === "committed" || r.state === "kept").length + rows.filter((r) => r.state === "skipped").length },
    { label: "Current people (not terminated)", expected: s.fileCurrent ?? 0, actual: live.length - elevateSeparated },
    { label: "Terminated people", expected: s.fileTerminated ?? 0, actual: elevateSeparated },
    { label: "Rows skipped because of errors", expected: 0, actual: rows.filter((r) => r.state === "skipped").length },
    { label: "Managers that could not be set", expected: 0, actual: s.managerWarnings ?? 0 },
  ];
  // Documents and leave histories pulled from the API for the people in this batch
  const docNotes: string[] = [];
  if (ids.length > 0) {
    const items = await db.select({ kind: importPullItems.kind, outcome: importPullItems.outcome, employeeId: importPullItems.employeeId }).from(importPullItems).where(inArray(importPullItems.employeeId, ids));
    const docs = items.filter((i) => i.kind === "document");
    if (docs.length > 0) {
      const ok = (o: string) => o === "imported" || o === "duplicate";
      checks.push({ label: "Documents in TalentHR for these people", expected: docs.length, actual: docs.filter((d) => ok(d.outcome)).length });
      const perPerson = new Map<string, { want: number; have: number }>();
      for (const d of docs) {
        const key = d.employeeId as string;
        const cur = perPerson.get(key) ?? { want: 0, have: 0 };
        cur.want += 1;
        if (ok(d.outcome)) cur.have += 1;
        perPerson.set(key, cur);
      }
      checks.push({ label: "People with a document that was not imported", expected: 0, actual: [...perPerson.values()].filter((p) => p.have < p.want).length });
    } else docNotes.push("No documents have been pulled from TalentHR yet (run the pull script).");
    const leave = items.filter((i) => i.kind === "leave_history" && i.outcome === "archived").length;
    docNotes.push(`Leave histories archived (kept as an encrypted file, not loaded into the leave ledger): ${leave}.`);
  }
  const [{ n: warn }] = await db.select({ n: count() }).from(importRows).where(and(eq(importRows.batchId, batchId), sql`exists (select 1 from jsonb_array_elements(${importRows.issues}) i where i->>'level' = 'warning')`));
  return {
    checks,
    clean: b.status === "committed" && checks.every((c) => c.expected === c.actual),
    warnings: warn,
    signedOffAt: b.signedOffAt,
    notes: [...docNotes, "People who were already in ELEVATE and not in this file are not counted."],
  };
}
