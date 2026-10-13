import { SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES } from "./constants";
import { clearedCookie, readSessionValue, sessionCookie } from "./cookie";
import type { Sql } from "./db";
import { originMatches, sameSiteOrigin } from "./origin";
import { hashValue, isWellFormedToken, newSessionValue } from "./tokens";

// Request handlers for the sign-in handoff and sessions, kept apart from the route files so they can be tested against the real
// database (tests/integration/learn-handoff.test.ts in apps/elevate runs them by relative path, as it does for Safe Voice).

export type Deps = {
  sql: Sql;
  /** ELEVATE's address: the only site a handoff may come from. */
  elevateOrigin: string | null;
  production: boolean;
  /** Whether this address may try again (the rate limit). */
  allow: (request: Request) => Promise<boolean>;
};

const see = (request: Request, path: string) => new URL(path, request.url);

function redirect(request: Request, path: string, cookie?: string): Response {
  const headers = new Headers({ location: see(request, path).toString(), "cache-control": "no-store" });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

const refuse = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * ELEVATE posts a one-time token here. The token is looked up by its hash and works once, for 60 seconds, for an active account.
 * Any failure (unknown, used, expired, deactivated, malformed) sends the person to the same "open it again" page.
 */
export async function handleHandoff(request: Request, deps: Deps): Promise<Response> {
  if (!originMatches(request, deps.elevateOrigin)) return refuse(403, "This request was not allowed.");
  if (!(await deps.allow(request))) return refuse(429, "Too many tries. Please wait a few minutes.");
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 2048) return refuse(413, "Request too large.");

  let token: unknown;
  try {
    token = (await request.formData()).get("token");
  } catch {
    return redirect(request, "/expired");
  }
  if (!isWellFormedToken(token)) return redirect(request, "/expired");

  const value = newSessionValue();
  try {
    await deps.sql.begin(async (tx) => {
      const used = await tx`select user_id, auth_methods from learn.consume_launch_token(${hashValue(token)})`;
      if (used.length !== 1) throw new Error("no token");
      await tx`select learn.create_session(${used[0].user_id}::uuid, ${hashValue(value)}, ${used[0].auth_methods}::text[], ${SESSION_ABSOLUTE_HOURS})`;
    });
  } catch (error) {
    // Only a short code or the error class is written (never the token, a person or a request).
    const message = error instanceof Error ? error.message : "";
    console.error("handoff failed:", /^learn:[a-z_]+$/.test(message) ? message : error instanceof Error ? error.name : "unknown");
    return redirect(request, "/expired");
  }
  return redirect(request, "/", sessionCookie(value, deps.production));
}

/** The person behind a session cookie, or null. Enforces the idle and absolute limits and that the account is still active. */
export async function resolveSession(cookieHeader: string | null, deps: Pick<Deps, "sql" | "production">): Promise<{ userId: string; authMethods: string[] } | null> {
  const value = readSessionValue(cookieHeader, deps.production);
  if (!value || !isWellFormedToken(value)) return null;
  try {
    const rows = await deps.sql`select user_id, auth_methods from learn.resolve_session(${hashValue(value)}, ${SESSION_IDLE_MINUTES})`;
    if (rows.length !== 1) return null;
    return { userId: rows[0].user_id as string, authMethods: rows[0].auth_methods as string[] };
  } catch {
    return null;
  }
}

/** Ends the session and sends the person on to ELEVATE (through /signed-out). Only this site may ask (a same-origin form post). */
export async function handleSignOut(request: Request, deps: Deps): Promise<Response> {
  if (!sameSiteOrigin(request)) return refuse(403, "This request was not allowed.");
  const value = readSessionValue(request.headers.get("cookie"), deps.production);
  if (value && isWellFormedToken(value)) {
    try {
      await deps.sql`select learn.end_session(${hashValue(value)})`;
    } catch {
      // the cookie is cleared either way
    }
  }
  // Back to a page on this site first: the content-security policy (form-action 'self') would block a form post being redirected
  // straight to another site. That page then sends the person on to ELEVATE.
  const headers = new Headers({ location: see(request, "/signed-out").toString(), "cache-control": "no-store" });
  headers.append("set-cookie", clearedCookie(deps.production));
  return new Response(null, { status: 303, headers });
}
