import { requestShot } from "@/modules/activity/ingest";
import { deviceRoute, json } from "@/modules/activity/route-helpers";
import { shotRequestSchema } from "@/modules/activity/validators";

export const dynamic = "force-dynamic";

const BUCKET = "activity-shots";

/** The address the app PUTs the blurred picture to (a one-time storage link), so the app never needs to know the storage service. */
function uploadUrl(path: string, token: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${encodeURIComponent(token)}`;
}

export async function POST(request: Request) {
  return deviceRoute(request, shotRequestSchema, async (device, body) => {
    const result = await requestShot(device, body);
    if (!result.ok) return json({ error: result.reason }, 409);
    return json({ shotId: result.shotId, uploadUrl: uploadUrl(result.path, result.token) });
  });
}
