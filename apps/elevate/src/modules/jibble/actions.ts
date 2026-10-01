"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { employees } from "@/modules/people/schema";
import { getJibbleClient } from "./client";
import { JibbleError } from "./http-client";
import { processMirrorQueue, syncJibblePeople, type PeopleSync } from "./jobs";
import { jibbleLinkLog, jibblePeople } from "./schema";
import { retrySchema, setPersonSchema } from "./validators";

const NOT_SET_UP = "Jibble is not set up yet. Add the access token on the server first.";
const BAD = "Check the request and try again.";
const refresh = () => revalidatePath("/attendance");

const friendly = (e: unknown) =>
  e instanceof JibbleError ? (e.status === 401 ? "Jibble rejected the access token. It may have expired." : e.status === 403 ? "Jibble says this token is not allowed to do that." : `Jibble did not answer properly (${e.message}).`) : "Could not reach Jibble.";

/** Checks the token works by reading the people list. Reads names only to count them. */
export async function testJibbleConnection(): Promise<ActionResult<{ people: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const client = getJibbleClient();
    if (!client) return fail(NOT_SET_UP);
    try {
      const people = await client.listPeople();
      await writeAudit({ actor, action: "jibble.test", targetType: "integration", metadata: { people: people.length } });
      return { ok: true, data: { people: people.length } };
    } catch (error) {
      return fail(friendly(error));
    }
  });
}

/** Matches people to Jibble accounts by work email now. Hand-made matches stay. */
export async function syncJibblePeopleNow(): Promise<ActionResult<PeopleSync>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const client = getJibbleClient();
    if (!client) return fail(NOT_SET_UP);
    try {
      const result = await syncJibblePeople(client);
      await writeAudit({ actor, action: "jibble.sync", targetType: "integration", metadata: result });
      refresh();
      return { ok: true, data: result };
    } catch (error) {
      return fail(friendly(error));
    }
  });
}

/** Sets or removes a hand-made match between a person and their Jibble account. */
export async function setJibblePerson(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = setPersonSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? BAD);
    const { employeeId, jibblePersonId } = parsed.data;
    await db.transaction(async (tx) => {
      const [person] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!person) throw new ActionFailure("That person was not found.");
      if (jibblePersonId === null) {
        await tx.delete(jibblePeople).where(eq(jibblePeople.employeeId, employeeId));
      } else {
        const [taken] = await tx.select({ employeeId: jibblePeople.employeeId }).from(jibblePeople).where(eq(jibblePeople.jibblePersonId, jibblePersonId)).limit(1);
        if (taken && taken.employeeId !== employeeId) throw new ActionFailure("That Jibble account is already matched to someone else.");
        await tx
          .insert(jibblePeople)
          .values({ employeeId, jibblePersonId, matchedBy: "manual" })
          .onConflictDoUpdate({ target: jibblePeople.employeeId, set: { jibblePersonId, matchedBy: "manual", matchedAt: new Date() } });
      }
      await writeAudit({ actor, action: "jibble.map", targetType: "employee", targetId: employeeId, after: { matched: jibblePersonId !== null } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Puts a failed call back in the queue and sends the queue now. */
export async function retryJibbleSend(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = retrySchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const done = await db.update(jibbleLinkLog).set({ status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(eq(jibbleLinkLog.id, parsed.data.logId)).returning({ id: jibbleLinkLog.id });
    if (done.length === 0) return fail("That call was not found.");
    await writeAudit({ actor, action: "jibble.retry", targetType: "integration", metadata: { logId: parsed.data.logId } });
    await processMirrorQueue();
    refresh();
    return { ok: true, data: undefined };
  });
}
