import "server-only";
import type { ZodType } from "zod";
import { allowRequest } from "@/lib/rate-limit";
import { authenticateDevice } from "./device-auth";
import type { DeviceAuth } from "./ingest";
import { compareVersions, parseVersion } from "./releases-logic";
import { minRequiredVersion } from "./releases-service";

// Shared steps of the /api/tracker/* routes. They sit outside the sign-in gate, so every route checks the device token itself:
// token, then rate limit, then the body. Answers are small JSON objects; nothing about the request is ever logged.

const MAX_BODY_CHARS = 256 * 1024;

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Reads and checks a JSON body; null when it is too big, not JSON, or does not fit the schema. */
export async function readBody<T>(request: Request, schema: ZodType<T>): Promise<T | null> {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return null;
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Runs a route for an enrolled device: 401 without a valid token, 429 when too busy, 426 when the app reports a version below the
 * required one, 400 for a bad body. The version comes from the `X-Tracker-Version` header; with no header (or one that is not a
 * version) nothing is enforced. Routes the app needs in order to update itself pass `exemptFromFloor`.
 */
export async function deviceRoute<T>(
  request: Request,
  schema: ZodType<T> | null,
  run: (device: DeviceAuth, body: T) => Promise<Response>,
  options: { exemptFromFloor?: boolean } = {},
): Promise<Response> {
  const device = await authenticateDevice(request.headers.get("authorization"));
  if (!device) return json({ error: "unauthorized" }, 401);
  if (!(await allowRequest("trackerIngest", device.deviceId))) return json({ error: "too_many_requests" }, 429);
  if (!options.exemptFromFloor) {
    const reported = request.headers.get("x-tracker-version");
    if (reported && parseVersion(reported)) {
      const required = await minRequiredVersion();
      if (required && compareVersions(reported, required) < 0) return json({ error: "update_required", minVersion: required }, 426);
    }
  }
  if (!schema) return run(device, undefined as T);
  const body = await readBody(request, schema);
  if (body === null) return json({ error: "invalid" }, 400);
  return run(device, body);
}
