import "server-only";
import { ForbiddenError } from "@/lib/authz";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * Runs an action body and converts failures to `{ ok: false }`. Forbidden becomes a plain
 * message; anything unexpected is logged without request data and shown as a generic error,
 * so stack traces and internals never reach the browser.
 * Call requireUser() BEFORE this (it redirects, and redirects must not be caught).
 */
export async function runAction<T>(body: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ForbiddenError) return fail("You do not have access to do that.");
    console.error("action failed:", error instanceof Error ? error.name : "unknown error");
    return fail("Something went wrong. Try again.");
  }
}
