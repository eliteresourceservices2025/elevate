import { deviceRoute, json } from "@/modules/activity/route-helpers";
import { isPlatform, parseVersion } from "@/modules/activity/releases-logic";
import { getPublishedReleases } from "@/modules/activity/releases-service";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";

// The update file for one platform and version: a redirect to a 60-second storage link, after the device token is checked.
// A withdrawn or unknown release is a 404 (the app was told about it by the feed, and the feed never offers a withdrawn one).
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  return deviceRoute(
    request,
    null,
    async () => {
      const version = new URL(request.url).searchParams.get("version") ?? "";
      if (!isPlatform(platform) || !parseVersion(version)) return json({ error: "not_found" }, 404);
      const release = (await getPublishedReleases()).find((r) => r.version === version && r.status === "published");
      const build = release?.builds.find((b) => b.platform === platform && b.kind === "update");
      if (!build) return json({ error: "not_found" }, 404);
      const link = await getDocumentStorage().createSignedDownload(BUCKETS.trackerBuilds, build.storagePath, 60, build.fileName);
      return new Response(null, { status: 302, headers: { location: link, "cache-control": "no-store" } });
    },
    { exemptFromFloor: true },
  );
}
