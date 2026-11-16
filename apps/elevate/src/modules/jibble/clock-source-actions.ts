"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { replayClock } from "@/modules/attendance/clock";
import { clockSourceOf } from "@/modules/attendance/clock-source";
import { clockSource } from "@/modules/attendance/schema";
import { loadRecentEvents, lockEmployeeClock } from "@/modules/attendance/service";
import { notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { runJibbleImport } from "./import";
import { jibbleClientMap, jibblePeople } from "./schema";
import { clientMapSchema, clockSourceSchema, importHoursSchema, removeClientMapSchema } from "./validators";

// HR: whose hours come from Jibble, importing them by hand, and which Jibble project or activity means which client.
// Every export here is a public endpoint: it signs the person in and authorizes first.

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;
const refresh = () => revalidatePath("/jibble");

/**
 * Says where a person's hours come from. "jibble": they clock in Jibble and a job imports their time entries (they must be matched to a
 * Jibble account, and not be clocked in right now, so no session is cut in two). "elevate": back to the ELEVATE clock. Append-only: every
 * change is a new row, audited, and the person is told.
 */
export async function setClockSource(input: unknown): Promise<ActionResult<{ source: "elevate" | "jibble" }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = clockSourceSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, source } = parsed.data;
    await db.transaction(async (tx) => {
      const [person] = await tx
        .select({ userId: employees.userId })
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
      if (!person) throw new ActionFailure("That person was not found.");
      await lockEmployeeClock(tx, employeeId);
      const current = await clockSourceOf(tx, employeeId);
      if (current === source) return;
      if (source === "jibble") {
        const [match] = await tx.select({ id: jibblePeople.jibblePersonId }).from(jibblePeople).where(eq(jibblePeople.employeeId, employeeId));
        if (!match) throw new ActionFailure("Match them to their Jibble account first.");
      }
      if (replayClock(await loadRecentEvents(tx, employeeId)).state !== "out") throw new ActionFailure("They are clocked in right now. Change this after they clock out, so no session is cut in two.");
      await tx.insert(clockSource).values({ employeeId, source, setBy: actor.id });
      await writeAudit({ actor, action: "clock_source.set", targetType: "employee", targetId: employeeId, before: { source: current }, after: { source } }, tx);
      if (person.userId) {
        await notify(tx, {
          userId: person.userId,
          kind: "clock_source.changed",
          title: source === "jibble" ? "Your hours now come from Jibble" : "You clock in ELEVATE again",
          body: source === "jibble" ? "Clock in and out in Jibble. ELEVATE reads your hours from there, so the ELEVATE clock is switched off for you." : "Use the clock in ELEVATE. Your Jibble hours so far stay as they were.",
          link: "/attendance",
        });
      }
    });
    refresh();
    return { ok: true, data: { source } };
  });
}

/** Imports the last few days of Jibble entries now for one person whose hours come from Jibble (the job does it every 30 minutes). */
export async function importJibbleHours(input: unknown): Promise<ActionResult<{ imported: number; voided: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = importHoursSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, days } = parsed.data;
    if ((await clockSourceOf(db, employeeId)) !== "jibble") return fail("Their hours do not come from Jibble.");
    const result = await runJibbleImport({ employeeId, days });
    if (result.skipped === "not_configured") return fail("Jibble is not set up yet, or cannot list time entries.");
    if (result.skipped === "paused") return fail("The Jibble link is paused. Turn it on first.");
    if (result.failed > 0) return fail("Jibble could not be reached for that person. Try again in a few minutes.");
    await writeAudit({ actor, action: "jibble.import_requested", targetType: "employee", targetId: employeeId, metadata: { days, imported: result.imported, voided: result.voided } });
    refresh();
    return { ok: true, data: { imported: result.imported, voided: result.voided } };
  });
}

/** Says which ELEVATE client a Jibble project or activity means. It applies at the next import (within 30 minutes). */
export async function saveClientMap(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = clientMapSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { kind, jibbleId, clientId } = parsed.data;
    await db.transaction(async (tx) => {
      const [client] = (await tx.execute(sql`select id from core.clients where id = ${clientId} and archived_at is null`)) as unknown as { id: string }[];
      if (!client) throw new ActionFailure("That client was not found.");
      await tx
        .insert(jibbleClientMap)
        .values({ kind, jibbleId, clientId, setBy: actor.id })
        .onConflictDoUpdate({ target: [jibbleClientMap.kind, jibbleClientMap.jibbleId], set: { clientId, setBy: actor.id, setAt: sql`now()` } });
      await tx.execute(sql`delete from time.jibble_unmapped_ids where kind = ${kind} and jibble_id = ${jibbleId}`);
      await writeAudit({ actor, action: "jibble.client_map", targetType: "client", targetId: clientId, after: { kind, jibbleId } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Removes a mapping (the Jibble id then shows up as unmapped again the next time it is seen). */
export async function removeClientMap(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = removeClientMapSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [row] = await tx.delete(jibbleClientMap).where(eq(jibbleClientMap.id, parsed.data.id)).returning({ kind: jibbleClientMap.kind, jibbleId: jibbleClientMap.jibbleId, clientId: jibbleClientMap.clientId });
      if (!row) throw new ActionFailure("That mapping was not found.");
      await writeAudit({ actor, action: "jibble.client_unmap", targetType: "client", targetId: row.clientId, before: { kind: row.kind, jibbleId: row.jibbleId } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
