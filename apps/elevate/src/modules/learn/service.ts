import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { LAUNCH_TOKEN_SECONDS, newLaunchToken } from "./token";

type Executor = Pick<typeof db, "execute">;

/**
 * Stores a new one-time launch token for a person and returns the token (the only time it exists in clear). Only its hash is kept.
 * Old unused tokens of the same person are left to expire: they are useless after 60 seconds and the purge job removes them.
 */
export async function createLaunchToken(executor: Executor, userId: string, authMethods: string[]): Promise<string> {
  const { token, hash } = newLaunchToken();
  // Only plain words survive the filter, so a Postgres array literal built from them cannot be broken out of.
  const methods = authMethods.filter((m) => /^[a-z0-9_.-]{1,40}$/i.test(m)).slice(0, 8);
  const literal = `{${methods.join(",")}}`;
  await executor.execute(sql`
    insert into learn.launch_tokens (token_hash, user_id, auth_methods, expires_at)
    values (${hash}, ${userId}, ${literal}::text[], now() + make_interval(secs => ${LAUNCH_TOKEN_SECONDS}))`);
  return token;
}
