"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { assetPath, canArchive, canSetStatus, type AssetStatus } from "./constants";
import { assets } from "./schema";
import { assignAssetTo, returnAssetFrom } from "./service";
import { archiveAssetSchema, assignAssetSchema, createAssetSchema, returnAssetSchema, setAssetStatusSchema, updateAssetSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = (tag?: string) => {
  revalidatePath("/assets");
  revalidatePath("/offboarding");
  if (tag) revalidatePath(assetPath(tag));
};

/** HR registers an item. The tag is printed on its label and never changes. */
export async function createAsset(input: unknown): Promise<ActionResult<{ id: string; tag: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "assets.manage");
    const parsed = createAssetSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    try {
      const row = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(assets)
          .values({ tag: v.tag, name: v.name, category: v.category, serialNumber: v.serialNumber ?? null, notes: v.notes ?? null, purchaseDate: v.purchaseDate ?? null, createdBy: actor.id })
          .returning({ id: assets.id, tag: assets.tag });
        await writeAudit({ actor, action: "asset.create", targetType: "asset", targetId: r.id, after: { tag: v.tag, name: v.name, category: v.category } }, tx);
        return r;
      });
      refresh();
      return { ok: true, data: row };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("That tag is already used by another item.");
      throw error;
    }
  });
}

/** Edits the details (not the tag, not the status: those have their own rules). */
export async function updateAsset(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "assets.manage");
    const parsed = updateAssetSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const tag = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(assets).where(eq(assets.id, v.assetId)).for("update");
      if (!before) throw new ActionFailure("That item was not found.");
      await tx
        .update(assets)
        .set({ name: v.name, category: v.category, serialNumber: v.serialNumber ?? null, notes: v.notes ?? null, purchaseDate: v.purchaseDate ?? null, updatedAt: new Date() })
        .where(eq(assets.id, v.assetId));
      await writeAudit({ actor, action: "asset.update", targetType: "asset", targetId: v.assetId, before: { name: before.name, category: before.category, hasSerial: Boolean(before.serialNumber) }, after: { name: v.name, category: v.category, hasSerial: Boolean(v.serialNumber) } }, tx);
      return before.tag;
    });
    refresh(tag);
    return { ok: true, data: undefined };
  });
}

/** In stock, in repair, lost or retired. An assigned item changes only through its return. */
export async function setAssetStatus(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "assets.manage");
    const parsed = setAssetStatusSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const tag = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(assets).where(eq(assets.id, v.assetId)).for("update");
      if (!before) throw new ActionFailure("That item was not found.");
      const from = before.status as AssetStatus;
      if (before.archivedAt) throw new ActionFailure("This item is archived.");
      if (from === "assigned") throw new ActionFailure("This item is assigned. Record its return instead.");
      if (!canSetStatus(from, v.status)) throw new ActionFailure("That status change is not allowed.");
      await tx.update(assets).set({ status: v.status, updatedAt: new Date() }).where(eq(assets.id, v.assetId));
      await writeAudit({ actor, action: "asset.status", targetType: "asset", targetId: v.assetId, before: { status: from }, after: { status: v.status, note: v.note ?? null } }, tx);
      return before.tag;
    });
    refresh(tag);
    return { ok: true, data: undefined };
  });
}

/** Archive (or restore) an item. Items are never deleted: their history stays. */
export async function archiveAsset(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "assets.manage");
    const parsed = archiveAssetSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const tag = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(assets).where(eq(assets.id, v.assetId)).for("update");
      if (!before) throw new ActionFailure("That item was not found.");
      if (v.archive) {
        const verdict = canArchive({ status: before.status as AssetStatus, archived: before.archivedAt !== null });
        if (!verdict.ok) throw new ActionFailure(verdict.reason);
      } else if (!before.archivedAt) {
        throw new ActionFailure("This item is not archived.");
      }
      await tx.update(assets).set({ archivedAt: v.archive ? new Date() : null, updatedAt: new Date() }).where(eq(assets.id, v.assetId));
      await writeAudit({ actor, action: v.archive ? "asset.archive" : "asset.restore", targetType: "asset", targetId: v.assetId }, tx);
      return before.tag;
    });
    refresh(tag);
    return { ok: true, data: undefined };
  });
}

/** Hand an item to a person: date, condition and who handed it over are recorded. */
export async function assignAsset(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "assets.assign");
    const parsed = assignAssetSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    try {
      const { tag } = await db.transaction((tx) => assignAssetTo(tx, actor, { assetId: v.assetId, employeeId: v.employeeId, condition: v.condition, note: v.note ?? null }));
      refresh(tag);
      return { ok: true, data: undefined };
    } catch (error) {
      // The database allows only one open assignment per item: a race that got past the status check lands here
      if (isUniqueViolation(error)) return fail("This item is already assigned. Record its return first.");
      throw error;
    }
  });
}

/** Take an item back: date, condition and who received it are recorded, and the item goes to its next status. */
export async function returnAsset(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "assets.assign");
    const parsed = returnAssetSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const { tag } = await db.transaction((tx) => returnAssetFrom(tx, actor, { assetId: v.assetId, condition: v.condition, nextStatus: v.nextStatus, note: v.note ?? null }));
    refresh(tag);
    return { ok: true, data: undefined };
  });
}
