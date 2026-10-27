"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { employees } from "@/modules/people/schema";
import { getJibbleClient } from "./client";
import { JibbleError } from "./http-client";
import { processMirrorQueue, runJibbleRepair, syncJibblePeople, type PeopleSync } from "./jobs";
import { jibbleLinkLog, jibblePeople, jibbleSettings } from "./schema";
import { looksLikePersonId, resolveJibbleAccount } from "./match-rules";
import type { JibblePerson } from "./http-client";
import { pauseSchema, retrySchema, setPersonSchema } from "./validators";

const NOT_SET_UP = "Jibble is not set up yet. Add the access token on the server first.";
const BAD = "Check the request and try again.";
const refresh = () => { revalidatePath("/attendance"); revalidatePath("/jibble"); };

const friendly = (e: unknown) =>
  e instanceof JibbleError ? (e.status === 401 ? "Jibble rejected the access token. It may have expired." : e.status === 403 ? "Jibble says this token is not allowed to do that." : `Jibble did not answer properly (${e.message}).`) : "Could not reach Jibble.";

/** Checks the token works by reading the people list. Reads names only to count them. */
export async function testJibbleConnection(): Promise<ActionResult<{ people: number; breaks: number | null }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const client = getJibbleClient();
    if (!client) return fail(NOT_SET_UP);
    try {
      const people = await client.listPeople();
      // Native breaks come from each person's schedule in Jibble; check the first person as a sample. Failing to read them is not a failed connection.
      const breaks = people.length === 0 ? null : await client.listBreaks(people[0].id).then((b) => b.length, () => null);
      await writeAudit({ actor, action: "jibble.test", targetType: "integration", metadata: { people: people.length, breaks } });
      return { ok: true, data: { people: people.length, breaks } };
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
    const { employeeId, jibblePersonId: typed } = parsed.data;
    // What was typed is an email, a member code or an id. The server finds the Jibble account itself and stores the id it found.
    let jibblePersonId: string | null = null;
    if (typed !== null) {
      let people: JibblePerson[] = [];
      if (!looksLikePersonId(typed)) {
        const client = getJibbleClient();
        if (!client) return fail(NOT_SET_UP);
        try {
          people = await client.listPeople();
        } catch (error) {
          return fail(friendly(error));
        }
      }
      const found = resolveJibbleAccount(typed, people);
      if (found.kind === "none") return fail("No Jibble account has that email or member code. Check it exactly as it is in Jibble.");
      if (found.kind === "many") return fail("More than one Jibble account has that. Paste the Jibble person id instead.");
      jibblePersonId = found.kind === "id" ? found.id : found.person.id;
    }
    await db.transaction(async (tx) => {
      const [person] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!person) throw new ActionFailure("That person was not found.");
      if (jibblePersonId === null) {
        await tx.delete(jibblePeople).where(eq(jibblePeople.employeeId, employeeId));
      } else {
        const holders = (await tx.execute(sql`
          select p.employee_id as id, (e.archived_at is not null or e.status = 'separated') as stale
          from time.jibble_people p join core.employees e on e.id = p.employee_id
          where p.jibble_person_id = ${jibblePersonId} and p.employee_id <> ${employeeId}`)) as unknown as { id: string; stale: boolean }[];
        if (holders.some((h) => !h.stale)) throw new ActionFailure("That Jibble account is already matched to someone else.");
        // An archived or departed record's old link is dropped, so the account can move to the current record.
        for (const h of holders) await tx.delete(jibblePeople).where(eq(jibblePeople.employeeId, h.id));
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
    // Never replay an old or superseded action against a person's current session.
    const done = (await db.execute(sql`update time.jibble_link_log l
      set status = 'queued', attempts = greatest(l.attempts, 1), next_attempt_at = now(), last_error = null
      where l.id = ${parsed.data.logId}::uuid and l.status = 'failed' and l.source = 'event'
        and l.created_at >= now() - interval '10 minutes'
        and not exists (select 1 from time.jibble_link_log later where later.employee_id = l.employee_id and later.id <> l.id and later.created_at >= l.created_at)
      returning l.id, l.employee_id`)) as unknown as { id: string; employee_id: string }[];
    if (done.length === 0) return fail("This call cannot be retried. Check the person's current status in ELEVATE and Jibble.");
    await writeAudit({ actor, action: "jibble.retry", targetType: "integration", metadata: { logId: parsed.data.logId } });
    await processMirrorQueue(new Date(), undefined, { employeeId: done[0].employee_id });
    refresh();
    const [result] = await db.select({ status: jibbleLinkLog.status }).from(jibbleLinkLog).where(eq(jibbleLinkLog.id, parsed.data.logId));
    if (result?.status !== "sent") return fail(result?.status === "queued" ? "The call is waiting. Check its status again shortly." : "Jibble did not accept the call. Check the person's current status.");
    return { ok: true, data: undefined };
  });
}

/**
 * HR's pause switch for everything sent to Jibble. While paused, clock calls wait in the queue and nothing is sent. When resumed, calls
 * that waited more than 10 minutes are dropped (replaying a long backlog would put Jibble in a wrong state), and the repair job puts
 * everyone's Jibble state right from ELEVATE's. The ELEVATE clock is never affected.
 */
export async function setJibblePaused(input: unknown): Promise<ActionResult<{ dropped: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "jibble.manage");
    const parsed = pauseSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    let dropped = 0;
    await db.transaction(async (tx) => {
      await tx
        .insert(jibbleSettings)
        .values({ id: 1, paused: parsed.data.paused, pausedBy: actor.id, pausedAt: new Date() })
        .onConflictDoUpdate({ target: jibbleSettings.id, set: { paused: parsed.data.paused, pausedBy: actor.id, pausedAt: new Date() } });
      if (!parsed.data.paused) {
        const old = (await tx.execute(sql`update time.jibble_link_log set status = 'skipped', last_error = 'dropped: waited too long while paused' where status = 'queued' and created_at < now() - interval '10 minutes' returning 1`)) as unknown as unknown[];
        dropped = old.length;
      }
      await writeAudit({ actor, action: parsed.data.paused ? "jibble.pause" : "jibble.resume", targetType: "integration", metadata: { dropped } }, tx);
    });
    if (!parsed.data.paused) {
      await processMirrorQueue();
      await runJibbleRepair();
    }
    refresh();
    return { ok: true, data: { dropped } };
  });
}
