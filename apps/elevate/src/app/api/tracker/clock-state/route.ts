import { clockStateFor } from "@/modules/activity/ingest";
import { deviceRoute, json, requiredUpdateFor } from "@/modules/activity/route-helpers";

// The app asks whether the person is working (so it records) and which settings apply. Time keeping is never blocked by the
// version floor: an out-of-date app still gets the clock state (so its clock buttons keep working) plus `updateRequired`, which
// tells it to stop recording until it is updated.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return deviceRoute(
    request,
    null,
    async (device) => json({ ...(await clockStateFor(device.employeeId)), updateRequired: await requiredUpdateFor(request) }),
    { exemptFromFloor: true },
  );
}
