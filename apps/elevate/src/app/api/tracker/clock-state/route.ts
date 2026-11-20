import { clockStateFor } from "@/modules/activity/ingest";
import { deviceRoute, json } from "@/modules/activity/route-helpers";

// The app asks whether the person is working (so it records) and which settings apply.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return deviceRoute(request, null, async (device) => json(await clockStateFor(device.employeeId)));
}
