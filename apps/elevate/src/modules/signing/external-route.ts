import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { SESSION_COOKIE, resolveToken, sessionValid, type ExternalContext } from "./external";
import { sha256 } from "./external-mail";

// Shared by the public /api/sign/[token]/* routes: rate limits, the token lookup, the session cookie check, and one plain way to answer.
// Nothing here ever echoes the token, a code or an email address.

export const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const NOT_VALID = "This link is not valid anymore. If you still need to sign, ask the sender for a new one.";

export type Guard = { ok: true; ctx: ExternalContext; ip: string | null } | { ok: false; response: NextResponse };

/** Looks up the link and applies the per-address limit. With `needSession`, also requires the code to have been entered. */
export async function guard(token: string, opts: { needSession: boolean; limit?: "signPublic" | "signVerify" | "signCode" }): Promise<Guard> {
  const rawIp = await clientIp();
  const ip = rawIp === "unknown" ? null : rawIp;
  if (!(await allowRequest("signPublic", rawIp))) return { ok: false, response: json({ ok: false, error: "Too many requests. Please wait a few minutes and try again." }, 429) };
  const ctx = await resolveToken(token);
  if (!ctx) return { ok: false, response: json({ ok: false, error: NOT_VALID }, 404) };
  if (opts.limit && !(await allowRequest(opts.limit, sha256(token)))) return { ok: false, response: json({ ok: false, error: "Too many tries. Please wait a while and try again." }, 429) };
  if (opts.needSession) {
    const jar = await cookies();
    if (!sessionValid(ctx, jar.get(SESSION_COOKIE)?.value)) return { ok: false, response: json({ ok: false, error: "Enter the code we emailed you first.", needCode: true }, 401) };
  }
  return { ok: true, ctx, ip };
}

/** Runs the work and turns expected failures into a plain answer; anything unexpected becomes a generic error (no details). */
export async function respond(work: () => Promise<Record<string, unknown> | void>): Promise<NextResponse> {
  try {
    const out = await work();
    return json({ ok: true, ...(out ?? {}) });
  } catch (error) {
    if (error instanceof ActionFailure) return json({ ok: false, error: error.message }, 400);
    console.error("external signing failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
