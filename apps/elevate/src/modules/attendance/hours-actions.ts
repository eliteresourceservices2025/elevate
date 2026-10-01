"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { downlineEmployeeIds } from "@/modules/org/service";
import { buildHoursExport } from "./hours-export";
import { approvePersonWeek } from "./hours-approve";
import { CLEAN_FLAGS, attendanceRows } from "./hours-service";
import { addDays, periodContaining, type PayPeriodKind } from "./pay-periods";
import { hoursSettings } from "./schema";
import { approveCleanSchema, approveWeekSchema, exportHoursSchema, payPeriodSchema } from "./validators";

// Hours approval (lead or HR, per person and week) and the payroll export (HR). ELEVATE labels and totals hours; it never computes pay.

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;
const refresh = () => revalidatePath("/attendance");

/** Approves one person's week through the last finished day. Nobody approves their own. */
export async function approveHoursWeek(input: unknown): Promise<ActionResult<{ approved: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const reach = scopeFor(actor, "hours.approve");
    if (reach !== "all" && reach !== "team") throw new ForbiddenError("hours.approve");
    const parsed = approveWeekSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const result = await approvePersonWeek(actor, parsed.data.employeeId, parsed.data.weekStart, parsed.data.note);
    refresh();
    return { ok: true, data: { approved: result.approved } };
  });
}

/**
 * Approves everyone's week whose days have no flag beyond the harmless ones (on leave, corrected, extra hours already explained).
 * A lead covers their team, HR everyone. People with flags are left for a person to look at.
 */
export async function approveCleanWeeks(input: unknown): Promise<ActionResult<{ approved: number; withFlags: number; skipped: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const reach = scopeFor(actor, "hours.approve");
    if (reach !== "all" && reach !== "team") throw new ForbiddenError("hours.approve");
    const parsed = approveCleanSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { weekStart } = parsed.data;
    const ids =
      reach === "team"
        ? await downlineEmployeeIds(db, actor.id)
        : ((await db.execute(sql`select distinct employee_id from time.attendance_days where date between ${weekStart}::date and ${addDays(weekStart, 6)}::date`)) as unknown as { employee_id: string }[]).map((r) => r.employee_id);
    let approved = 0;
    let withFlags = 0;
    let skipped = 0;
    for (const employeeId of ids) {
      try {
        const week = (await attendanceRows(db, [employeeId], weekStart, addDays(weekStart, 6))).filter((r) => r.sessions > 0 || r.scheduledMinutes !== null);
        if (week.length === 0) continue;
        if (week.some((r) => r.flags.some((f) => !CLEAN_FLAGS.has(f)))) {
          withFlags += 1;
          continue;
        }
        const done = await approvePersonWeek(actor, employeeId, weekStart, undefined, { onlyIfClean: true });
        if (done.skipped === "flags") withFlags += 1;
        else if (done.approved > 0) approved += 1;
      } catch (error) {
        if (!(error instanceof ActionFailure) && !(error instanceof ForbiddenError)) throw error;
        skipped += 1; // still clocked in, nothing finished yet, or the person is the signed-in one
      }
    }
    await writeAudit({ actor, action: "hours.approve_clean", targetType: "team", targetId: undefined, metadata: { weekStart, approved, withFlags, skipped } });
    refresh();
    return { ok: true, data: { approved, withFlags, skipped } };
  });
}

/** How pay periods are cut for the export. HR only. */
export async function savePayPeriod(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "hours.export");
    const parsed = payPeriodSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { kind, biweeklyAnchor } = parsed.data;
    if (biweeklyAnchor && new Date(`${biweeklyAnchor}T00:00:00Z`).getUTCDay() !== 1) return fail("The first day of a two-week period must be a Monday.");
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(hoursSettings).limit(1);
      const values = { payPeriodKind: kind, ...(biweeklyAnchor ? { biweeklyAnchor } : {}), updatedBy: actor.id, updatedAt: new Date() };
      await tx.insert(hoursSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: hoursSettings.id, set: values });
      await writeAudit({ actor, action: "hours.settings", targetType: "settings", targetId: undefined, before: before ? { kind: before.payPeriodKind, anchor: before.biweeklyAnchor } : null, after: { kind, anchor: biweeklyAnchor ?? before?.biweeklyAnchor ?? null } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** A CSV of a pay period's hours: the daily detail or a per-person summary. Approved days only unless asked otherwise. Audited. */
export async function exportHours(input: unknown): Promise<ActionResult<{ fileName: string; csv: string; rows: number; unapprovedDays: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "hours.export");
    const parsed = exportHoursSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    if (!(await allowRequest("download", actor.id))) return fail("Too many exports. Wait a few minutes and try again.");
    const [settings] = await db.select().from(hoursSettings).where(eq(hoursSettings.id, 1)).limit(1);
    const period = periodContaining((settings?.payPeriodKind ?? "semi_monthly") as PayPeriodKind, parsed.data.periodStart, settings?.biweeklyAnchor);
    if (period.start !== parsed.data.periodStart) return fail("That is not the first day of a pay period.");
    const built = await buildHoursExport({ periodStart: period.start, periodEnd: period.end, kind: parsed.data.kind, includeUnapproved: parsed.data.includeUnapproved });
    await writeAudit({ actor, action: "hours.export", targetType: "pay_period", targetId: undefined, metadata: { periodStart: period.start, periodEnd: period.end, kind: parsed.data.kind, includeUnapproved: parsed.data.includeUnapproved, rows: built.rows } });
    return { ok: true, data: built };
  });
}
