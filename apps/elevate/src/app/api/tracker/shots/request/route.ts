import { requestShot } from "@/modules/activity/ingest";
import { deviceRoute, json } from "@/modules/activity/route-helpers";
import { shotRequestSchema } from "@/modules/activity/validators";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return deviceRoute(request, shotRequestSchema, async (device, body) => {
    const result = await requestShot(device, body);
    return result.ok ? json({ shotId: result.shotId, path: result.path, token: result.token, bucket: "activity-shots" }) : json({ error: result.reason }, 409);
  });
}
