import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jibbleOperationGuard } from "./schema";
import type { JibbleAction } from "./mirror-rules";

export type GuardOperation = { kind: "send" | "repair" | "reconcile"; action?: JibbleAction; logId?: string; requestId?: string; jibblePersonId?: string };

/** A durable reservation, not a lease: a crash must never make an uncertain request safe to repeat. */
export async function claimJibbleOperation(employeeId: string, operation: GuardOperation): Promise<string | null> {
  const token = randomUUID();
  const rows = await db.insert(jibbleOperationGuard).values({ employeeId, token, ...operation }).onConflictDoNothing().returning({ token: jibbleOperationGuard.token });
  return rows[0]?.token ?? null;
}

/** Record the intent before making an external request. Only the current owner may transition it. */
export async function markJibbleInFlight(employeeId: string, token: string, operation: Required<Pick<GuardOperation, "action" | "jibblePersonId">> & Pick<GuardOperation, "logId" | "requestId">): Promise<boolean> {
  const rows = await db.update(jibbleOperationGuard).set({ ...operation, phase: "in_flight", updatedAt: new Date() })
    .where(and(eq(jibbleOperationGuard.employeeId, employeeId), eq(jibbleOperationGuard.token, token), eq(jibbleOperationGuard.phase, "claimed")))
    .returning({ token: jibbleOperationGuard.token });
  return rows.length === 1;
}

/** Preserve uncertainty until a deliberate recovery workflow can establish a safe next action. */
export async function markJibbleUncertain(employeeId: string, token: string): Promise<boolean> {
  const rows = await db.update(jibbleOperationGuard).set({ phase: "uncertain", updatedAt: new Date() })
    .where(and(eq(jibbleOperationGuard.employeeId, employeeId), eq(jibbleOperationGuard.token, token), eq(jibbleOperationGuard.phase, "in_flight")))
    .returning({ token: jibbleOperationGuard.token });
  return rows.length === 1;
}

/** Change the recorded intent before a fallback request, while retaining the same reservation. */
export async function updateJibbleInFlightAction(employeeId: string, token: string, action: JibbleAction, requestId: string): Promise<boolean> {
  const rows = await db.update(jibbleOperationGuard).set({ action, requestId, updatedAt: new Date() })
    .where(and(eq(jibbleOperationGuard.employeeId, employeeId), eq(jibbleOperationGuard.token, token), eq(jibbleOperationGuard.phase, "in_flight")))
    .returning({ token: jibbleOperationGuard.token });
  return rows.length === 1;
}

/** After the result has been durably recorded, keep the reservation for the next operation. */
export async function markJibbleSettled(employeeId: string, token: string): Promise<boolean> {
  const rows = await db.update(jibbleOperationGuard).set({ phase: "claimed", action: null, logId: null, requestId: null, jibblePersonId: null, updatedAt: new Date() })
    .where(and(eq(jibbleOperationGuard.employeeId, employeeId), eq(jibbleOperationGuard.token, token), eq(jibbleOperationGuard.phase, "in_flight")))
    .returning({ token: jibbleOperationGuard.token });
  return rows.length === 1;
}

/** Release only after the caller has persisted and settled every request. */
export async function finishJibbleOperation(employeeId: string, token: string): Promise<boolean> {
  const rows = await db.delete(jibbleOperationGuard)
    .where(and(eq(jibbleOperationGuard.employeeId, employeeId), eq(jibbleOperationGuard.token, token), eq(jibbleOperationGuard.phase, "claimed")))
    .returning({ token: jibbleOperationGuard.token });
  return rows.length === 1;
}

/**
 * Wrap one external effect. Persist its result before settling the reservation: a crash or failure leaves a durable
 * in-flight/uncertain record. The caller keeps the reservation until all operations for this person are complete.
 */
export async function runGuardedJibbleEffect<T>(input: {
  employeeId: string;
  token: string;
  operation: Required<Pick<GuardOperation, "action" | "jibblePersonId">> & Pick<GuardOperation, "logId" | "requestId">;
  send: () => Promise<T>;
  persist: (result: T) => Promise<void>;
}): Promise<T> {
  const { employeeId, token, operation, send, persist } = input;
  if (!(await markJibbleInFlight(employeeId, token, operation))) throw new Error("Jibble operation reservation is not available");
  try {
    const result = await send();
    await persist(result);
    if (!(await markJibbleSettled(employeeId, token))) throw new Error("Jibble operation could not be settled");
    return result;
  } catch (error) {
    // An exception does not prove that the provider did not act, including a failure to save its response.
    await markJibbleUncertain(employeeId, token);
    throw error;
  }
}
