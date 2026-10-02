import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { assignability, assetPath, type AssetStatus, type Condition, type ReturnStatus } from "./constants";
import { assetAssignments, assets } from "./schema";

// Internals for assets (not a "use server" file, so nothing here is a public endpoint). Callers authorize first.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { id: string; email: string };

/** How many things are with this person right now. Offboarding's "assets returned" check reads it. */
export async function activeAssignmentCount(executor: Pick<typeof db, "select">, employeeId: string): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(assetAssignments)
    .where(and(eq(assetAssignments.employeeId, employeeId), isNull(assetAssignments.returnedAt)));
  return row?.n ?? 0;
}

/** Lock the item row for the rest of the transaction so two people cannot hand it over or take it back at once. */
async function lockAsset(tx: Tx, assetId: string) {
  const [asset] = await tx.select().from(assets).where(eq(assets.id, assetId)).for("update");
  if (!asset) throw new ActionFailure("That item was not found.");
  return asset;
}

/** Hand an item to a person: records the date, the condition and who handed it over. Throws ActionFailure when the rules refuse. */
export async function assignAssetTo(tx: Tx, actor: Actor, p: { assetId: string; employeeId: string; condition: Condition; note: string | null }): Promise<{ assignmentId: string; tag: string }> {
  const asset = await lockAsset(tx, p.assetId);
  const verdict = assignability({ status: asset.status as AssetStatus, archived: asset.archivedAt !== null });
  if (!verdict.ok) throw new ActionFailure(verdict.reason);
  const [person] = await tx.select({ id: employees.id, userId: employees.userId, status: employees.status, archivedAt: employees.archivedAt }).from(employees).where(eq(employees.id, p.employeeId));
  if (!person || person.archivedAt) throw new ActionFailure("That person was not found.");
  if (person.status === "separated") throw new ActionFailure("That person has left. Items cannot be assigned to them.");
  const [row] = await tx.insert(assetAssignments).values({ assetId: asset.id, employeeId: person.id, conditionOut: p.condition, assignedBy: actor.id, assignNote: p.note }).returning({ id: assetAssignments.id });
  await tx.update(assets).set({ status: "assigned", updatedAt: new Date() }).where(eq(assets.id, asset.id));
  await writeAudit({ actor, action: "asset.assign", targetType: "asset", targetId: asset.id, before: { status: asset.status }, after: { status: "assigned", assignmentId: row.id, employeeId: person.id, condition: p.condition, handedOverBy: actor.id } }, tx);
  // The person is told in app, with no serial number or item details beyond the tag
  if (person.userId) await notify(tx, { userId: person.userId, kind: "asset.assigned", title: "Equipment assigned to you", body: `Item ${asset.tag} was handed to you. Open it to check the details.`, link: assetPath(asset.tag) });
  return { assignmentId: row.id, tag: asset.tag };
}

/** Take an item back: records the date, the condition and who received it, and moves the item to where it goes next. */
export async function returnAssetFrom(tx: Tx, actor: Actor, p: { assetId: string; condition: Condition; nextStatus: ReturnStatus; note: string | null }): Promise<{ assignmentId: string; tag: string }> {
  const asset = await lockAsset(tx, p.assetId);
  const [active] = await tx.select().from(assetAssignments).where(and(eq(assetAssignments.assetId, asset.id), isNull(assetAssignments.returnedAt))).for("update");
  if (!active) throw new ActionFailure("This item is not assigned to anyone.");
  const now = new Date();
  await tx.update(assetAssignments).set({ returnedAt: now, conditionIn: p.condition, receivedBy: actor.id, returnNote: p.note }).where(eq(assetAssignments.id, active.id));
  await tx.update(assets).set({ status: p.nextStatus, updatedAt: now }).where(eq(assets.id, asset.id));
  await writeAudit({ actor, action: "asset.return", targetType: "asset", targetId: asset.id, before: { status: asset.status, employeeId: active.employeeId }, after: { status: p.nextStatus, assignmentId: active.id, employeeId: active.employeeId, condition: p.condition, receivedBy: actor.id } }, tx);
  const [person] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, active.employeeId));
  if (person?.userId) await notify(tx, { userId: person.userId, kind: "asset.returned", title: "Equipment return recorded", body: `The return of item ${asset.tag} was recorded. Thank you.`, link: assetPath(asset.tag) });
  return { assignmentId: active.id, tag: asset.tag };
}
