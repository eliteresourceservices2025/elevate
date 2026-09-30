// Seeding writes fake people, so it must never run against production or an unknown database.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export type SeedEnv = {
  DATABASE_URL_DIRECT?: string;
  DATABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  ELEVATE_ENV?: string;
};

/**
 * Allowed only when the database and the auth service are both local, or when ELEVATE_ENV is
 * explicitly "staging". Anything else (including "production" or unset on a remote host) is refused.
 */
export function assertSeedAllowed(env: SeedEnv): void {
  if (env.ELEVATE_ENV === "production") throw new Error("Refusing to seed: ELEVATE_ENV is production.");

  const dbHost = hostOf(env.DATABASE_URL_DIRECT ?? env.DATABASE_URL);
  const authHost = hostOf(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!dbHost || !authHost) throw new Error("Refusing to seed: database or Supabase URL is missing or invalid.");

  const local = LOCAL_HOSTS.has(dbHost) && LOCAL_HOSTS.has(authHost);
  if (!local && env.ELEVATE_ENV !== "staging") {
    throw new Error("Refusing to seed a remote database. Set ELEVATE_ENV=staging only for the staging project.");
  }
}
