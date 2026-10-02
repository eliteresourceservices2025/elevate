"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize, type Resource } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { managerChainUserIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { goalNotes, goals } from "./schema";
import { goalIdSchema, goalNoteSchema, goalSchema, goalStatusSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";

async function resourceFor(employeeId: string): Promise<(Resource & { userId: string | null }) | null> {
  const [e] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
  if (!e) return null;
  return { ownerUserId: e.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, employeeId), userId: e.userId };
}

/** Add or edit a goal. The person and their chain of leads (and HR) may; the other side is told. */
export async function saveGoal(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = goalSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const res = await resourceFor(v.employeeId);
    if (!res) return fail("You do not have access to do that.");
    await authorize(actor, "goals.manage", res);
    const id = await db.transaction(async (tx) => {
      let goalId = v.id;
      if (goalId) {
        const [row] = await tx.update(goals).set({ title: v.title, description: v.description ?? null, targetOn: v.targetOn ?? null, updatedAt: new Date() }).where(and(eq(goals.id, goalId), eq(goals.employeeId, v.employeeId), isNull(goals.archivedAt))).returning({ id: goals.id });
        if (!row) return null;
      } else {
        const [row] = await tx.insert(goals).values({ employeeId: v.employeeId, title: v.title, description: v.description ?? null, targetOn: v.targetOn ?? null, createdBy: actor.id }).returning({ id: goals.id });
        goalId = row.id;
        if (res.userId && res.userId !== actor.id) await notify(tx, { userId: res.userId, kind: "goal.added", title: "A goal was added for you", body: "Open your goals to read it.", link: "/reviews/goals" });
      }
      await writeAudit({ actor, action: v.id ? "goal.update" : "goal.create", targetType: "goal", targetId: goalId }, tx);
      return goalId;
    });
    if (!id) return fail("That goal was not found.");
    revalidatePath("/reviews/goals");
    return { ok: true, data: { id } };
  });
}

async function loadGoal(goalId: string) {
  const [g] = await db.select().from(goals).where(and(eq(goals.id, goalId), isNull(goals.archivedAt)));
  if (!g) return null;
  const res = await resourceFor(g.employeeId);
  return res ? { goal: g, res } : null;
}

export async function setGoalStatus(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = goalStatusSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const loaded = await loadGoal(parsed.data.goalId);
    if (!loaded) return fail("You do not have access to do that.");
    await authorize(actor, "goals.manage", loaded.res);
    await db.transaction(async (tx) => {
      await tx.update(goals).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(goals.id, loaded.goal.id));
      await writeAudit({ actor, action: "goal.status", targetType: "goal", targetId: loaded.goal.id, after: { status: parsed.data.status } }, tx);
    });
    revalidatePath("/reviews/goals");
    return { ok: true, data: undefined };
  });
}

export async function addGoalNote(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = goalNoteSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const loaded = await loadGoal(parsed.data.goalId);
    if (!loaded) return fail("You do not have access to do that.");
    await authorize(actor, "goals.manage", loaded.res);
    await db.transaction(async (tx) => {
      await tx.insert(goalNotes).values({ goalId: loaded.goal.id, authorUserId: actor.id, note: parsed.data.note });
      await tx.update(goals).set({ updatedAt: new Date() }).where(eq(goals.id, loaded.goal.id));
      await writeAudit({ actor, action: "goal.note", targetType: "goal", targetId: loaded.goal.id }, tx); // never the note text
    });
    revalidatePath("/reviews/goals");
    return { ok: true, data: undefined };
  });
}

/** Goals are archived, never deleted. */
export async function archiveGoal(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = goalIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const loaded = await loadGoal(parsed.data.goalId);
    if (!loaded) return fail("You do not have access to do that.");
    await authorize(actor, "goals.manage", loaded.res);
    await db.transaction(async (tx) => {
      await tx.update(goals).set({ archivedAt: new Date() }).where(eq(goals.id, loaded.goal.id));
      await writeAudit({ actor, action: "goal.archive", targetType: "goal", targetId: loaded.goal.id }, tx);
    });
    revalidatePath("/reviews/goals");
    return { ok: true, data: undefined };
  });
}
