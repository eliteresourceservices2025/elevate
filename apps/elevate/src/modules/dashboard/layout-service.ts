import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import type { TileLayout } from "./bento-tiles";
import type { LayoutInput } from "./layout-validators";
import type { Lens } from "./lens";
import { dashboardLayouts } from "./schema";

// A person's own dashboard layout. Not a "use server" file: the functions take the acting user, so the actions sign them in first.

/** The person's saved layout for a view, or null for the default. Only their own. */
export async function getLayout(actor: AuthUser, view: Lens): Promise<TileLayout | null> {
  await authorize(actor, "dashboard.customize", { ownerUserId: actor.id });
  const [row] = await db
    .select({ hidden: dashboardLayouts.hidden, order: dashboardLayouts.order })
    .from(dashboardLayouts)
    .where(and(eq(dashboardLayouts.userId, actor.id), eq(dashboardLayouts.view, view)))
    .limit(1);
  if (!row || !Array.isArray(row.hidden) || !Array.isArray(row.order)) return null;
  return { hidden: row.hidden.filter((x): x is string => typeof x === "string"), order: row.order.filter((x): x is string => typeof x === "string") };
}

/** Saves the person's layout for a view (replacing the earlier one). The audit entry holds the view and tile ids only. */
export async function saveLayout(actor: AuthUser, input: LayoutInput): Promise<{ ok: true }> {
  await authorize(actor, "dashboard.customize", { ownerUserId: actor.id });
  await db.transaction(async (tx) => {
    await tx
      .insert(dashboardLayouts)
      .values({ userId: actor.id, view: input.view, hidden: input.hidden, order: input.order })
      .onConflictDoUpdate({ target: [dashboardLayouts.userId, dashboardLayouts.view], set: { hidden: input.hidden, order: input.order, updatedAt: sql`now()` } });
    await writeAudit({ actor, action: "dashboard.layout_save", targetType: "user", targetId: actor.id, after: { view: input.view, hidden: input.hidden, order: input.order } }, tx);
  });
  return { ok: true };
}

/** Puts the view back to its default layout. */
export async function resetLayout(actor: AuthUser, view: Lens): Promise<{ ok: true }> {
  await authorize(actor, "dashboard.customize", { ownerUserId: actor.id });
  await db.transaction(async (tx) => {
    await tx.delete(dashboardLayouts).where(and(eq(dashboardLayouts.userId, actor.id), eq(dashboardLayouts.view, view)));
    await writeAudit({ actor, action: "dashboard.layout_reset", targetType: "user", targetId: actor.id, after: { view } }, tx);
  });
  return { ok: true };
}
