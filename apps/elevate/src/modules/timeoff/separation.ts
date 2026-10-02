import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/lib/db";
import { leaveRequests } from "./schema";

type Tx = Pick<typeof db, "update">;

/**
 * For someone who is leaving: time-off requests still waiting for a decision are cancelled. Approved days are left alone (undoing
 * them would need ledger reversals, which are HR's call), and the ledger itself is never touched.
 */
export async function cancelWaitingLeave(tx: Tx, employeeId: string, byUserId: string | null, reason: string): Promise<number> {
  const rows = await tx
    .update(leaveRequests)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: byUserId, cancelReason: reason })
    .where(and(eq(leaveRequests.employeeId, employeeId), inArray(leaveRequests.status, ["pending_lead", "pending_hr"])))
    .returning({ id: leaveRequests.id });
  return rows.length;
}
