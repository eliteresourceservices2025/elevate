import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ForbiddenError, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { acknowledgments, policies, policyVersions } from "@/modules/announcements/schema";
import { collectMyData } from "./service";
import type { MyData } from "./types";

export type PrivacyGate = {
  policyId: string;
  versionId: string;
  title: string;
  version: number;
  body: string;
  changeNote: string | null;
  /** True when the person accepted an earlier version: the screen says the notice changed. */
  updated: boolean;
};

/** The published privacy notice and whether the signed-in person still has to accept it. Null = nothing to accept. */
export async function getPrivacyNotice() {
  const [row] = await db
    .select({
      policyId: policies.id,
      versionId: policyVersions.id,
      title: policies.title,
      version: policyVersions.version,
      body: policyVersions.body,
      changeNote: policyVersions.changeNote,
    })
    .from(policies)
    .innerJoin(policyVersions, eq(policyVersions.policyId, policies.id))
    .where(and(eq(policies.kind, "privacy_notice"), isNull(policies.archivedAt), eq(policyVersions.status, "published")))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  return row ?? null;
}

/**
 * The first-login screen. Nobody is blocked until HR has published a real privacy notice, and if the notice
 * cannot be loaded the app stays usable rather than locking everyone out.
 */
export async function getPrivacyGate(): Promise<PrivacyGate | null> {
  const user = await requireUser();
  await authorize(user, "privacy.view_my_data", { ownerUserId: user.id });
  try {
    const notice = await getPrivacyNotice();
    if (!notice) return null;
    const [accepted] = await db
      .select({ id: acknowledgments.id })
      .from(acknowledgments)
      .where(and(eq(acknowledgments.userId, user.id), eq(acknowledgments.policyVersionId, notice.versionId)))
      .limit(1);
    if (accepted) return null;
    const earlier = await db
      .select({ id: acknowledgments.id })
      .from(acknowledgments)
      .innerJoin(policyVersions, eq(policyVersions.id, acknowledgments.policyVersionId))
      .where(and(eq(acknowledgments.userId, user.id), eq(policyVersions.policyId, notice.policyId)))
      .limit(1);
    return { ...notice, updated: earlier.length > 0 };
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    console.error("privacy gate failed:", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}

/** Everything ELEVATE holds about the signed-in person, plus a link to the current privacy notice. */
export async function getMyData(): Promise<{ data: MyData; noticePolicyId: string | null; openRequest: boolean }> {
  const user = await requireUser();
  await authorize(user, "privacy.view_my_data", { ownerUserId: user.id });
  const data = await collectMyData(user.id, user.email);
  const notice = await getPrivacyNotice();
  return { data, noticePolicyId: notice?.policyId ?? null, openRequest: data.requests.some((r) => r.category === "Data rights request" && r.status === "pending") };
}
