"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { formatDays } from "./ledger";
import { holidays, leaveLedger, leaveTypes } from "./schema";
import { balanceNow, lockEmployeeLedger } from "./service";
import {
  adjustSchema,
  archiveHolidaySchema,
  archiveLeaveTypeSchema,
  awardSchema,
  holidaySchema,
  leaveTypeSchema,
  updateHolidaySchema,
  updateLeaveTypeSchema,
} from "./validators";

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;

function refresh(employeeId?: string) {
  revalidatePath("/time-off");
  revalidatePath("/dashboard");
  if (employeeId) revalidatePath(`/time-off/${employeeId}`);
}

/** The person a ledger entry is for: active, and never the person making the entry (four eyes). */
async function ledgerSubject(tx: Pick<typeof db, "select">, employeeId: string, actorId: string, verb: string) {
  const [e] = await tx
    .select({ id: employees.id, userId: employees.userId, status: employees.status, archivedAt: employees.archivedAt })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!e || e.archivedAt || e.status === "separated") throw new ActionFailure("That person was not found.");
  if (e.userId === actorId) throw new ActionFailure(`Another admin must ${verb} your own days.`);
  return e;
}

async function trackedType(tx: Pick<typeof db, "select">, leaveTypeId: string) {
  const [t] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.id, leaveTypeId), isNull(leaveTypes.archivedAt))).limit(1);
  if (!t || !t.tracksBalance) throw new ActionFailure("Choose a leave type that has a balance.");
  return t;
}

// --- Awards and corrections ----------------------------------------------------------------

/** HR awards prize days (for example a game prize). Optional expiry. Never to yourself. */
export async function awardDays(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.award");
    const parsed = awardSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const today = todayInZone();
    if (v.expiresOn && v.expiresOn <= today) return fail("The expiry date must be after today.");

    await db.transaction(async (tx) => {
      const person = await ledgerSubject(tx, v.employeeId, actor.id, "award");
      const type = await trackedType(tx, v.leaveTypeId);
      await lockEmployeeLedger(tx, v.employeeId);

      const [row] = await tx
        .insert(leaveLedger)
        .values({ employeeId: v.employeeId, leaveTypeId: type.id, entryType: "award", days: String(v.days), reason: v.reason, effectiveOn: today, expiresOn: v.expiresOn ?? null, createdBy: actor.id })
        .returning({ id: leaveLedger.id });
      if (person.userId) {
        await notify(tx, {
          userId: person.userId,
          kind: "timeoff.awarded",
          title: `You received ${formatDays(v.days)} off`,
          body: v.expiresOn ? `${v.reason}. Use it by ${v.expiresOn}.` : v.reason,
          link: "/time-off",
        });
      }
      await writeAudit({ actor, action: "leave.award", targetType: "employee", targetId: v.employeeId, metadata: { entryId: row.id, days: v.days, leaveType: type.slug, expiresOn: v.expiresOn ?? null, reason: v.reason } }, tx);
    });

    refresh(v.employeeId);
    return { ok: true, data: undefined };
  });
}

/** A correction, up or down, with a reason. A balance can never go below zero. */
export async function adjustBalance(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.adjust");
    const parsed = adjustSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;

    await db.transaction(async (tx) => {
      const person = await ledgerSubject(tx, v.employeeId, actor.id, "adjust");
      const type = await trackedType(tx, v.leaveTypeId);
      await lockEmployeeLedger(tx, v.employeeId);

      const balance = await balanceNow(tx, v.employeeId, type.id);
      if (Math.round((balance + v.days) * 100) < 0) throw new ActionFailure(`That would take the balance below zero. The balance is ${formatDays(balance)}.`);

      const [row] = await tx
        .insert(leaveLedger)
        .values({ employeeId: v.employeeId, leaveTypeId: type.id, entryType: "adjustment", days: String(v.days), reason: v.reason, effectiveOn: todayInZone(), createdBy: actor.id })
        .returning({ id: leaveLedger.id });
      if (person.userId) {
        await notify(tx, { userId: person.userId, kind: "timeoff.adjusted", title: "Your prize days were corrected", body: v.reason, link: "/time-off" });
      }
      await writeAudit({ actor, action: "leave.adjust", targetType: "employee", targetId: v.employeeId, metadata: { entryId: row.id, days: v.days, leaveType: type.slug, reason: v.reason } }, tx);
    });

    refresh(v.employeeId);
    return { ok: true, data: undefined };
  });
}

// --- Leave types ---------------------------------------------------------------------------

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "leave";

export async function createLeaveType(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.manage_types");
    const parsed = leaveTypeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;

    const base = slugify(v.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}_${attempt + 1}`;
      try {
        await db.transaction(async (tx) => {
          const [t] = await tx.insert(leaveTypes).values({ slug, name: v.name, tracksBalance: v.tracksBalance, skipHr: v.skipHr }).returning({ id: leaveTypes.id });
          await writeAudit({ actor, action: "leave_type.create", targetType: "leave_type", targetId: t.id, after: { slug, ...v } }, tx);
        });
        refresh();
        return { ok: true, data: undefined };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const [same] = await db.select({ id: leaveTypes.id }).from(leaveTypes).where(sql`lower(${leaveTypes.name}) = lower(${v.name})`).limit(1);
        if (same) return fail("A leave type with that name already exists.");
      }
    }
    return fail("Choose a different name.");
  });
}

export async function updateLeaveType(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.manage_types");
    const parsed = updateLeaveTypeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { leaveTypeId, ...v } = parsed.data;

    try {
      await db.transaction(async (tx) => {
        const [before] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, leaveTypeId)).for("update");
        if (!before || before.archivedAt) throw new ActionFailure("That leave type was not found.");
        await tx.update(leaveTypes).set({ ...v, updatedAt: new Date() }).where(eq(leaveTypes.id, leaveTypeId));
        await writeAudit({ actor, action: "leave_type.update", targetType: "leave_type", targetId: leaveTypeId, before: { name: before.name, skipHr: before.skipHr }, after: v }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("A leave type with that name already exists.");
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Retiring a type hides it from new awards and requests; its ledger rows stay. */
export async function archiveLeaveType(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.manage_types");
    const parsed = archiveLeaveTypeSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    await db.transaction(async (tx) => {
      const done = await tx.update(leaveTypes).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(leaveTypes.id, parsed.data.leaveTypeId), isNull(leaveTypes.archivedAt))).returning({ id: leaveTypes.id });
      if (done.length === 0) throw new ActionFailure("That leave type was not found.");
      await writeAudit({ actor, action: "leave_type.archive", targetType: "leave_type", targetId: parsed.data.leaveTypeId }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

// --- Holidays ------------------------------------------------------------------------------

export async function createHoliday(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.manage_holidays");
    const parsed = holidaySchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    try {
      await db.transaction(async (tx) => {
        const [h] = await tx.insert(holidays).values(parsed.data).returning({ id: holidays.id });
        await writeAudit({ actor, action: "holiday.create", targetType: "holiday", targetId: h.id, after: parsed.data }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("That holiday is already on the calendar.");
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

export async function updateHoliday(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.manage_holidays");
    const parsed = updateHolidaySchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { holidayId, ...v } = parsed.data;
    try {
      await db.transaction(async (tx) => {
        const [before] = await tx.select().from(holidays).where(eq(holidays.id, holidayId)).for("update");
        if (!before || before.archivedAt) throw new ActionFailure("That holiday was not found.");
        await tx.update(holidays).set({ ...v, updatedAt: new Date() }).where(eq(holidays.id, holidayId));
        await writeAudit(
          { actor, action: "holiday.update", targetType: "holiday", targetId: holidayId, before: { calendar: before.calendar, date: before.date, name: before.name, kind: before.kind, verified: before.verified }, after: v },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("That holiday is already on the calendar.");
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

export async function archiveHoliday(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "timeoff.manage_holidays");
    const parsed = archiveHolidaySchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    await db.transaction(async (tx) => {
      const done = await tx.update(holidays).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(holidays.id, parsed.data.holidayId), isNull(holidays.archivedAt))).returning({ id: holidays.id });
      if (done.length === 0) throw new ActionFailure("That holiday was not found.");
      await writeAudit({ actor, action: "holiday.archive", targetType: "holiday", targetId: parsed.data.holidayId }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
