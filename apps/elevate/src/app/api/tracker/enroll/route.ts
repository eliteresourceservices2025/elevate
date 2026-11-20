import { allowRequest } from "@/lib/rate-limit";
import { redeemEnrollmentCode } from "@/modules/activity/device-auth";
import { json, readBody } from "@/modules/activity/route-helpers";
import { enrollBodySchema } from "@/modules/activity/validators";

// The ELEVATE Tracker App trades the one-time code a person typed for a device token. No sign-in exists yet, so it is limited per address.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!(await allowRequest("trackerEnroll", `ip:${ip}`))) return json({ error: "too_many_requests" }, 429);
  const body = await readBody(request, enrollBodySchema);
  if (!body) return json({ error: "invalid" }, 400);
  const result = await redeemEnrollmentCode(body);
  if (!result.ok) return json({ error: result.reason }, 400);
  return json({ token: result.token, deviceId: result.deviceId });
}
