import { clockForDevice } from "@/modules/activity/device-clock";
import { deviceRoute, json } from "@/modules/activity/route-helpers";
import { clockBodySchema } from "@/modules/activity/validators";

// The app's clock buttons (clock in, break, clock out). Outside the sign-in gate like the other device routes. Not blocked by the version
// floor: an old app must still be able to clock someone out. Only the action, client and break length come from the body.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return deviceRoute(
    request,
    clockBodySchema,
    async (device, body) => {
      const r = await clockForDevice(device.employeeId, body.action, { clientId: body.clientId, breakMinutes: body.breakMinutes });
      if (r.ok) return json(r.result);
      if (r.error === "no_person") return json({ error: "no_person" }, 403);
      return json({ error: "refused", message: r.message }, 409);
    },
    { exemptFromFloor: true },
  );
}
