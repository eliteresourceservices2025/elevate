import "server-only";
import type { ZodType } from "zod";
import { allowRequest } from "@/lib/rate-limit";
import { authenticateDevice } from "./device-auth";
import type { DeviceAuth } from "./ingest";

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

/** Runs a route for an enrolled device: 401 without a valid token, 429 when too busy, 400 for a bad body. */
export async function deviceRoute<T>(request: Request, schema: ZodType<T> | null, run: (device: DeviceAuth, body: T) => Promise<Response>): Promise<Response> {
  const device = await authenticateDevice(request.headers.get("authorization"));
  if (!device) return json({ error: "unauthorized" }, 401);
  if (!(await allowRequest("trackerIngest", device.deviceId))) return json({ error: "too_many_requests" }, 429);
  if (!schema) return run(device, undefined as T);
  const body = await readBody(request, schema);
  if (body === null) return json({ error: "invalid" }, 400);
  return run(device, body);
}
