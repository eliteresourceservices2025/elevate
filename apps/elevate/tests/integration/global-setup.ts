import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const TEST_DB_NAME = "elevate_test";

export function testDatabaseUrl(adminUrl: string) {
  const url = new URL(adminUrl);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

// Drops and recreates a throwaway database, then applies every migration to it.
export default async function setup() {
  const adminUrl = process.env.TEST_DB_ADMIN_URL;
  if (!adminUrl) {
    throw new Error("Set TEST_DB_ADMIN_URL (for example your local Supabase database URL) to run integration tests.");
  }
  const host = new URL(adminUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(host)) {
    throw new Error("Refusing to run integration tests against a remote database host.");
  }

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${TEST_DB_NAME} with (force)`);
    await admin.unsafe(`create database ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const client = postgres(testDatabaseUrl(adminUrl), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  } finally {
    await client.end();
  }
}
