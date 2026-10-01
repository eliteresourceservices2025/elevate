import "server-only";
import { and, eq } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { esignEnvelopes, esignSigners } from "./schema";
import { appendEvent } from "./service";

export type SigningDocument = { envelopeId: string; path: string; sealed: boolean; fileName: string };

/**
 * Checks that this person may see this envelope's document (HR: any; a signer: their own, once it is sent), records the first time
 * a pending signer opens it (signing needs it), audits the view, and says which stored file to show: the sealed copy once the
 * envelope is complete, the original before. Used by the in-page viewer (bytes) and the download button (signed link).
 * Throws ForbiddenError when they have no access, ActionFailure for a missing document or a rate limit.
 */
export async function openSigningDocument(actor: AuthUser, envelopeId: string): Promise<SigningDocument> {
  const [env] = await db.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId));
  const [mine] = await db.select().from(esignSigners).where(and(eq(esignSigners.envelopeId, envelopeId), eq(esignSigners.userId, actor.id)));
  if (!env) throw new ActionFailure("That document was not found.");
  const isManager = await authorize(actor, "signing.manage").then(() => true, () => false);
  if (!isManager) {
    await authorize(actor, "signing.view_own", { ownerUserId: mine?.userId });
    if (env.status === "draft") throw new ActionFailure("That document was not found.");
  }
  if (!(await allowRequest("download", actor.id))) throw new ActionFailure("Too many downloads. Wait a few minutes and try again.");

  const sealed = Boolean(env.sealedPath);
  if (mine && mine.status === "pending" && !mine.viewedAt) {
    const ip = await clientIp();
    await db.transaction(async (tx) => {
      await tx.update(esignSigners).set({ viewedAt: new Date() }).where(and(eq(esignSigners.id, mine.id), eq(esignSigners.status, "pending")));
      await appendEvent(tx, envelopeId, { type: "viewed", actorUserId: actor.id, signerId: mine.id, ip: ip === "unknown" ? null : ip });
    });
  }
  await writeAudit({ actor, action: "signing.document_view", targetType: "esign_envelope", targetId: envelopeId, metadata: { sealed } });
  const base = env.title.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 60) || "document";
  return { envelopeId, path: env.sealedPath ?? env.originalPath, sealed, fileName: `${base}${sealed ? " (signed)" : ""}.pdf` };
}
