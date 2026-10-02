import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// ELEVATE's connection to the Safe Voice tables. It is NOT the main application role: SAFEVOICE_HANDLER_DATABASE_URL belongs to the
// `safevoice_handler` role, which can read cases (never the code or passphrase hashes), add handler messages, and change a case's
// status and outcome, and nothing else in the database (migration 0037). The main DATABASE_URL role is not used for case content.

export class SafevoiceNotConfigured extends Error {
  constructor() {
    super("SAFEVOICE_HANDLER_DATABASE_URL is not set");
    this.name = "SafevoiceNotConfigured";
  }
}

let instance: ReturnType<typeof drizzle> | undefined;

function getSvDb() {
  if (!instance) {
    const url = process.env.SAFEVOICE_HANDLER_DATABASE_URL;
    if (!url) throw new SafevoiceNotConfigured();
    instance = drizzle(postgres(url, { prepare: false, max: 3, onnotice: () => {} }));
  }
  return instance;
}

export const svdb = new Proxy({} as ReturnType<typeof drizzle>, {
  get: (_target, prop) => Reflect.get(getSvDb(), prop),
});
