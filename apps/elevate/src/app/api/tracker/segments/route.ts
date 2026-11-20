import { ingestSegments } from "@/modules/activity/ingest";
import { deviceRoute, json } from "@/modules/activity/route-helpers";
import { segmentsBodySchema } from "@/modules/activity/validators";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return deviceRoute(request, segmentsBodySchema, async (device, body) => {
    const result = await ingestSegments(device, body);
    return result.ok ? json(result) : json({ error: result.reason }, 403);
  });
}
