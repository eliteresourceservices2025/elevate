import { finalizeShot } from "@/modules/activity/ingest";
import { deviceRoute, json } from "@/modules/activity/route-helpers";
import { shotFinalizeSchema } from "@/modules/activity/validators";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return deviceRoute(request, shotFinalizeSchema, async (device, body) => {
    const result = await finalizeShot(device, body);
    return result.ok ? json({ ok: true }) : json({ error: result.reason }, 409);
  });
}
