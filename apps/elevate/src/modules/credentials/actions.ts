"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { planCredentialImport, type SkippedRow } from "./rules";
import { credentials } from "./schema";
import { silenceDueReminders } from "./service";
import { addCredentialSchema, importCredentialsSchema, removeCredentialSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = () => revalidatePath("/credentials");

/** HR records one certificate for a person. */
export async function addCredential(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "credentials.manage");
    const parsed = addCredentialSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const today = todayInZone();
    try {
      const id = await db.transaction(async (tx) => {
        const [person] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, v.employeeId), isNull(employees.archivedAt))).limit(1);
        if (!person) throw new ActionFailure("That person was not found.");
        const [row] = await tx
          .insert(credentials)
          .values({ employeeId: v.employeeId, name: v.name, issuedOn: v.issuedOn ?? null, expiresOn: v.expiresOn, source: "manual", createdBy: actor.id })
          .returning({ id: credentials.id });
        await silenceDueReminders(tx, row.id, v.expiresOn, today);
        await writeAudit({ actor, action: "credential.add", targetType: "credential", targetId: row.id, after: { employeeId: v.employeeId, name: v.name, expiresOn: v.expiresOn } }, tx);
        return row.id;
      });
      refresh();
      return { ok: true, data: { id } };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("That certificate is already recorded for this person with the same end date.");
      throw error;
    }
  });
}

/** Takes a certificate off the list (archived, not erased), for example one entered by mistake. */
export async function removeCredential(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "credentials.manage");
    const parsed = removeCredentialSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [removed] = await tx
        .update(credentials)
        .set({ archivedAt: new Date() })
        .where(and(eq(credentials.id, parsed.data.credentialId), isNull(credentials.archivedAt)))
        .returning({ id: credentials.id, name: credentials.name, employeeId: credentials.employeeId });
      if (!removed) throw new ActionFailure("That certificate was not found.");
      await writeAudit({ actor, action: "credential.remove", targetType: "credential", targetId: removed.id, before: { employeeId: removed.employeeId, name: removed.name } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

export type ImportSummary = {
  committed: boolean;
  /** Rows of the file whose name matched the filter. */
  looked: number;
  /** Certificates created (or that would be created, in a preview). */
  created: number;
  alreadyThere: number;
  skipped: SkippedRow[];
};

/**
 * Loads certificates from TalentHR's assets file. With commit = false it only reports what would happen (a preview, nothing is
 * written); with commit = true it writes them. People are matched by work email, so import the people first. A repeat adds nothing.
 */
export async function importCredentials(input: unknown): Promise<ActionResult<ImportSummary>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "credentials.manage");
    const parsed = importCredentialsSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (!(await allowRequest("upload", actor.id))) return fail("Too many uploads. Try again in a few minutes.");

    const plan = planCredentialImport(v.csv, v.nameContains);
    if (!plan.ok) return fail(plan.error);

    const emails = [...new Set(plan.candidates.map((c) => c.email))];
    const people = emails.length
      ? await db
          .select({ id: employees.id, email: sql<string>`lower(${employees.workEmail})`, status: employees.status })
          .from(employees)
          .where(and(inArray(sql`lower(${employees.workEmail})`, emails), isNull(employees.archivedAt)))
      : [];
    const byEmail = new Map(people.map((p) => [p.email, p]));

    const skipped: SkippedRow[] = [...plan.skipped];
    const matched = [];
    for (const c of plan.candidates) {
      const p = byEmail.get(c.email);
      if (!p) skipped.push({ row: c.row, reason: "No person with that email in ELEVATE (import the people first)" });
      else if (p.status === "separated") skipped.push({ row: c.row, reason: "No longer on the team" });
      else matched.push({ ...c, employeeId: p.id });
    }

    const existing = matched.length
      ? await db
          .select({ employeeId: credentials.employeeId, name: sql<string>`lower(${credentials.name})`, expiresOn: credentials.expiresOn })
          .from(credentials)
          .where(and(inArray(credentials.employeeId, [...new Set(matched.map((m) => m.employeeId))]), isNull(credentials.archivedAt)))
      : [];
    const have = new Set(existing.map((e) => `${e.employeeId}|${e.name}|${e.expiresOn}`));
    const fresh = matched.filter((m) => !have.has(`${m.employeeId}|${m.name.toLowerCase()}|${m.expiresOn}`));
    const summary: ImportSummary = { committed: v.commit, looked: plan.matchedFilter, created: fresh.length, alreadyThere: matched.length - fresh.length, skipped: skipped.sort((a, b) => a.row - b.row) };
    if (!v.commit || fresh.length === 0) return { ok: true, data: summary };

    const today = todayInZone();
    await db.transaction(async (tx) => {
      for (const m of fresh) {
        const [row] = await tx
          .insert(credentials)
          .values({ employeeId: m.employeeId, name: m.name, issuedOn: m.issuedOn, expiresOn: m.expiresOn, source: "talenthr", createdBy: actor.id })
          .onConflictDoNothing()
          .returning({ id: credentials.id });
        if (row) await silenceDueReminders(tx, row.id, m.expiresOn, today);
      }
      // Counts only: the audit log never holds names or dates from the file.
      await writeAudit({ actor, action: "credential.import", metadata: { looked: summary.looked, created: summary.created, alreadyThere: summary.alreadyThere, skipped: summary.skipped.length } }, tx);
    });
    refresh();
    return { ok: true, data: summary };
  });
}
