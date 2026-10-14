import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients, employees } from "@/modules/people/schema";
import { previewForBatch } from "./apply";
import { scheduleImportAliases, scheduleImportBatches } from "./schema";

async function gate() {
  const user = await requireUser();
  await authorize(user, "scheduleimport.manage");
  return user;
}

export async function listScheduleImports() {
  await gate();
  return db
    .select({
      id: scheduleImportBatches.id,
      fileName: scheduleImportBatches.fileName,
      layout: scheduleImportBatches.layout,
      status: scheduleImportBatches.status,
      pairCount: scheduleImportBatches.pairCount,
      createdAt: scheduleImportBatches.createdAt,
    })
    .from(scheduleImportBatches)
    .orderBy(desc(scheduleImportBatches.createdAt))
    .limit(30);
}

/** The preview for one upload: compared with what ELEVATE holds right now. Null when it was discarded, applied or expired. */
export async function getScheduleImportPlan(id: string) {
  await gate();
  return previewForBatch(id);
}

/** Active people and clients to choose from when a sheet's spelling needs a decision (HR and Super Admin only). */
export async function listAliasTargets(): Promise<{ people: { id: string; label: string }[]; clients: { id: string; label: string }[] }> {
  await gate();
  const people = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, email: employees.workEmail, status: employees.status })
    .from(employees)
    .where(isNull(employees.archivedAt));
  const cl = await db.select({ id: clients.id, name: clients.name }).from(clients).where(and(isNull(clients.archivedAt), eq(clients.isActive, true)));
  return {
    people: people
      .filter((p) => p.status !== "separated")
      .map((p) => ({ id: p.id, label: `${p.first} ${p.last} (${p.email})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    clients: cl.map((c) => ({ id: c.id, label: c.name })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Matches HR confirmed earlier, with what each points at, for review and removal. */
export async function listAliases() {
  await gate();
  const rows = await db
    .select({
      id: scheduleImportAliases.id,
      kind: scheduleImportAliases.kind,
      sheetKey: scheduleImportAliases.sheetKey,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      clientName: clients.name,
      createdAt: scheduleImportAliases.createdAt,
    })
    .from(scheduleImportAliases)
    .leftJoin(employees, eq(employees.id, scheduleImportAliases.employeeId))
    .leftJoin(clients, eq(clients.id, scheduleImportAliases.clientId))
    .orderBy(desc(scheduleImportAliases.createdAt))
    .limit(200);
  return rows.map((r) => ({ id: r.id, kind: r.kind as "person" | "client", sheetKey: r.sheetKey, target: r.kind === "person" ? `${r.first ?? ""} ${r.last ?? ""}`.trim() : (r.clientName ?? ""), createdAt: r.createdAt }));
}
