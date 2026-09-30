import { randomBytes } from "node:crypto";
import { testDatabaseUrl } from "./global-setup";

// Runs before each test file: point the app at the throwaway database with a throwaway key.
process.env.DATABASE_URL = testDatabaseUrl(process.env.TEST_DB_ADMIN_URL!);
process.env.FIELD_ENCRYPTION_KEYS = `v1:${randomBytes(32).toString("base64")}`;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
