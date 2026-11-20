import { deviceRoute, json } from "@/modules/activity/route-helpers";
import { isPlatform, pickUpdate, type ReleaseNotes } from "@/modules/activity/releases-logic";
import { getPublishedReleases } from "@/modules/activity/releases-service";

// The update feed for the ELEVATE Tracker App's updater (Tauri's dynamic update format): 204 when there is nothing newer for this
// platform, otherwise the newest published release. The file itself comes from our own download route, never a storage address.
export const dynamic = "force-dynamic";

const noteText = (n: ReleaseNotes) =>
  [["Added", n.added], ["Improved", n.improved], ["Fixed", n.fixed]]
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => `${label}: ${(items as string[]).join("; ")}`)
    .join("\n");

export async function GET(request: Request) {
  return deviceRoute(
    request,
    null,
    async () => {
      const params = new URL(request.url).searchParams;
      const platform = params.get("platform");
      if (!isPlatform(platform)) return json({ error: "invalid" }, 400);
      const releases = await getPublishedReleases();
      const version = pickUpdate({
        platform,
        currentVersion: params.get("version"),
        published: releases.map((r) => ({ version: r.version, status: r.status, platforms: r.builds.filter((b) => b.kind === "update").map((b) => b.platform) })),
      });
      if (!version) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      const release = releases.find((r) => r.version === version);
      const build = release?.builds.find((b) => b.platform === platform && b.kind === "update");
      if (!release || !build?.signature) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      return json({
        version: release.version,
        notes: noteText(release.notes),
        pub_date: release.publishedAt,
        url: `${new URL(request.url).origin}/api/tracker/update/download/${platform}?version=${release.version}`,
        signature: build.signature,
      });
    },
    { exemptFromFloor: true },
  );
}
