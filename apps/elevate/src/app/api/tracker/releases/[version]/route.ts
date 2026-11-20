import { deviceRoute, json } from "@/modules/activity/route-helpers";
import { parseVersion } from "@/modules/activity/releases-logic";
import { getPublishedReleases } from "@/modules/activity/releases-service";

// What changed in one published release, for the app's "What's new" box after an update. A withdrawn or unknown version is a 404.
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ version: string }> }) {
  const { version } = await context.params;
  return deviceRoute(
    request,
    null,
    async () => {
      if (!parseVersion(version)) return json({ error: "not_found" }, 404);
      const release = (await getPublishedReleases()).find((r) => r.version === version && r.status === "published");
      if (!release) return json({ error: "not_found" }, 404);
      return json({ version: release.version, publishedAt: release.publishedAt, notes: release.notes, minRequired: release.minRequired });
    },
    { exemptFromFloor: true },
  );
}
