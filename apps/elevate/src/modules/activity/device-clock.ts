import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { performClock, type ClockInput } from "@/modules/attendance/service";
import { employees } from "@/modules/people/schema";
import { users } from "@/modules/core/schema";
import { revalidatePath } from "next/cache";
import type { CLOCK_ACTIONS } from "./validators";

export type DeviceClockResult =
  | { ok: true; result: { state: string; at: string; outsideAllowedRange: boolean } }
  | { ok: false; error: "no_person" }
  | { ok: false; error: "refused"; message: string };

/**
 * Clocks a person in or out for the tracker app, through the same code as the web clock (server clock, request IP, leave and client
 * checks, audit, Jibble rules). The device has already been checked by the route; this only maps the device's person to their account.
 */
export async function clockForDevice(employeeId: string, action: (typeof CLOCK_ACTIONS)[number], input: Pick<ClockInput, "clientId" | "breakMinutes">): Promise<DeviceClockResult> {
  const [owner] = await db.select({ userId: employees.userId, email: users.email }).from(employees).innerJoin(users, eq(users.id, employees.userId)).where(eq(employees.id, employeeId)).limit(1);
  if (!owner?.userId) return { ok: false, error: "no_person" };
  try {
    const r = await performClock({ id: owner.userId, email: owner.email }, action, { ...input, via: "tracker_app" });
    revalidatePath("/attendance");
    revalidatePath("/dashboard");
    return { ok: true, result: { state: r.state, at: r.at, outsideAllowedRange: r.outsideAllowedRange } };
  } catch (error) {
    if (error instanceof ActionFailure) return { ok: false, error: "refused", message: error.message };
    throw error;
  }
}
