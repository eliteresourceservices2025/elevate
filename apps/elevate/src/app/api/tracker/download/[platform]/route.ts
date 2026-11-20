import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { writeAudit } from "@/modules/audit/write";
import { isPlatform } from "@/modules/activity/releases-logic";
import { getPublishedReleases } from "@/modules/activity/releases-service";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";

// The ELEVATE Tracker App installer for one platform. Signed-in people only (a signed-out visitor is sent to sign in, a client guest to
// Messages): the answer is a redirect to a 60-second storage link, and each download is audited with the platform and version only.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ platform: string }> }) {
  const user = await requireUser();
  await authorize(user, "tracker.download", { ownerUserId: user.id });
  const { platform } = await context.params;
  if (!isPlatform(platform)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!(await allowRequest("download", user.id))) return Response.json({ error: "too_many_requests" }, { status: 429 });

  const release = (await getPublishedReleases()).find((r) => r.status === "published");
  const build = release?.builds.find((b) => b.platform === platform && b.kind === "installer");
  if (!release || !build) return Response.json({ error: "not_found" }, { status: 404 });

  // The link first, then the audit row: a download that could not be made must not be recorded as one.
  let link: string;
  try {
    link = await getDocumentStorage().createSignedDownload(BUCKETS.trackerBuilds, build.storagePath, 60, build.fileName);
  } catch {
    return Response.json({ error: "storage_unavailable" }, { status: 503 });
  }
  await writeAudit({ actor: user, action: "tracker.download", targetType: "tracker_release", targetId: release.id, metadata: { platform, version: release.version } });
  return new Response(null, { status: 302, headers: { location: link, "cache-control": "no-store" } });
}
