import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/modules/people/schema";
import { notify } from "@/modules/notifications/service";
import { reportName, timeNoticeUserIds } from "@/modules/org/service";
import type { Tx } from "@/modules/people/service";
import { jibbleMismatch, jibbleMismatchNotice } from "./schema";

type WorkingMismatch = "working_jibble_out" | "working_jibble_break";

/** Call only after an eligible person and a current mismatch have been confirmed. */
export async function recordWorkingMismatch(employeeId: string, kind: WorkingMismatch, now = new Date(), executor?: Tx): Promise<boolean> {
  const record = async (tx: Tx) => {
    const [person] = await tx.select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
      .from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!person) return false;
    const [created] = await tx.insert(jibbleMismatch).values({ employeeId, kind, family: "working", firstSeenAt: now, lastSeenAt: now })
      .onConflictDoNothing().returning({ id: jibbleMismatch.id });
    let mismatchId = created?.id;
    if (!mismatchId) {
      await tx.update(jibbleMismatch).set({ kind, lastSeenAt: now }).where(and(eq(jibbleMismatch.employeeId, employeeId), eq(jibbleMismatch.family, "working"), isNull(jibbleMismatch.resolvedAt)));
      const [existing] = await tx.select({ id: jibbleMismatch.id }).from(jibbleMismatch)
        .where(and(eq(jibbleMismatch.employeeId, employeeId), eq(jibbleMismatch.family, "working"), isNull(jibbleMismatch.resolvedAt))).limit(1);
      mismatchId = existing?.id;
    }
    if (!mismatchId) return false;
    const leads = await timeNoticeUserIds(tx, employeeId);
    const recipients = new Set([...(person.userId ? [person.userId] : []), ...leads]);
    const newlyNotified = recipients.size ? await tx.insert(jibbleMismatchNotice)
      .values([...recipients].map((userId) => ({ mismatchId, userId }))).onConflictDoNothing().returning({ userId: jibbleMismatchNotice.userId }) : [];
    await notify(tx, newlyNotified.map(({ userId }) => ({
      userId, kind: "jibble.working_mismatch", title: "Check the Jibble connection",
      body: `${reportName(person)} is clocked in on ELEVATE, but Jibble is ${kind === "working_jibble_out" ? "clocked out" : "on a break"}. Check both apps; screenshot capture cannot be confirmed here.`,
      link: "/attendance",
    })));
    return Boolean(created);
  };
  return executor ? record(executor) : db.transaction(record);
}

type OutMismatch = "possible_jibble_only" | "elevate_out_jibble_in";

/** A Jibble entry alone is not proof of its origin. The issue is for review, not automatic payroll changes. */
export async function recordOutMismatch(employeeId: string, kind: OutMismatch, entry: { id: string; time: string }, now = new Date(), executor?: Tx): Promise<void> {
  const record = async (tx: Tx) => {
    const [person] = await tx.select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
      .from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!person) return;
    const [created] = await tx.insert(jibbleMismatch).values({ employeeId, kind, family: "out", jibbleEntryId: entry.id, jibbleEntryTime: new Date(entry.time), firstSeenAt: now, lastSeenAt: now })
      .onConflictDoNothing().returning({ id: jibbleMismatch.id, firstSeenAt: jibbleMismatch.firstSeenAt });
    let incident = created;
    if (!incident) {
      // Keep evidence of a possible missed start until it is deliberately reviewed, even if later observations differ.
      const [existing] = await tx.select({ kind: jibbleMismatch.kind }).from(jibbleMismatch)
        .where(and(eq(jibbleMismatch.employeeId, employeeId), eq(jibbleMismatch.family, "out"), isNull(jibbleMismatch.resolvedAt))).limit(1).for("update");
      const keepEvidence = existing?.kind === "possible_jibble_only";
      const [updated] = await tx.update(jibbleMismatch).set(keepEvidence ? { lastSeenAt: now } : { kind, jibbleEntryId: entry.id, jibbleEntryTime: new Date(entry.time), lastSeenAt: now })
        .where(and(eq(jibbleMismatch.employeeId, employeeId), eq(jibbleMismatch.family, "out"), isNull(jibbleMismatch.resolvedAt)))
        .returning({ id: jibbleMismatch.id, firstSeenAt: jibbleMismatch.firstSeenAt });
      incident = updated;
    }
    if (!incident) return;
    const leads = now.getTime() - incident.firstSeenAt.getTime() >= 10 * 60_000 ? await timeNoticeUserIds(tx, employeeId) : [];
    const recipients = new Set([...(person.userId ? [person.userId] : []), ...leads]);
    const newlyNotified = recipients.size ? await tx.insert(jibbleMismatchNotice)
      .values([...recipients].map((userId) => ({ mismatchId: incident.id, userId }))).onConflictDoNothing().returning({ userId: jibbleMismatchNotice.userId }) : [];
    await notify(tx, newlyNotified.map(({ userId }) => ({
      userId, kind: "jibble.out_mismatch", title: "Check your ELEVATE and Jibble clock status",
      body: `${reportName(person)} is clocked out on ELEVATE while Jibble has an active entry. Check both apps and request an attendance correction if needed. Screenshot capture cannot be confirmed here.`,
      link: "/attendance",
    })));
  };
  if (executor) await record(executor); else await db.transaction(record);
}

/** Call only after a fresh check confirms the mismatch has cleared. */
export async function closeWorkingMismatches(employeeId: string, now = new Date(), executor: Pick<typeof db, "update"> = db, resolution: "status aligned" | "ELEVATE on break" | "ELEVATE clocked out" = "status aligned"): Promise<void> {
  await executor.update(jibbleMismatch).set({ resolvedAt: now, resolution })
    .where(and(eq(jibbleMismatch.employeeId, employeeId), eq(jibbleMismatch.family, "working"), isNull(jibbleMismatch.resolvedAt)));
}
