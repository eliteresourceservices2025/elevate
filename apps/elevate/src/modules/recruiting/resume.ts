import "server-only";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { applications, candidates } from "./schema";
import { authorizeForOpening, openingIdOfApplication } from "./service";

/**
 * An applicant's resume bytes, for showing in the page. The hiring team (a lead on that job) and HR, Super Admin and recruiters may
 * open it; every open is audited and rate limited. Throws ForbiddenError without access, ActionFailure when there is no file.
 */
export async function openResume(actor: AuthUser, applicationId: string): Promise<{ bytes: Uint8Array; kind: string; name: string }> {
  const openingId = await openingIdOfApplication(db, applicationId);
  if (!openingId) throw new ActionFailure("That application was not found.");
  await authorizeForOpening(actor, "recruiting.download_resume", openingId);
  if (!(await allowRequest("download", actor.id))) throw new ActionFailure("Too many downloads. Wait a few minutes and try again.");
  const [row] = await db.select({ path: candidates.resumePath, name: candidates.resumeName, kind: candidates.resumeKind }).from(applications).innerJoin(candidates, eq(candidates.id, applications.candidateId)).where(eq(applications.id, applicationId));
  if (!row?.path) throw new ActionFailure("There is no resume on file.");
  const bytes = await getDocumentStorage().read(BUCKETS.recruiting, row.path);
  if (!bytes) throw new ActionFailure("There is no resume on file.");
  await writeAudit({ actor, action: "recruiting.resume_view", targetType: "application", targetId: applicationId, metadata: { inline: true } });
  return { bytes, kind: row.kind ?? "pdf", name: row.name ?? "resume" };
}
