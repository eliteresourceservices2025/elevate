import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Supabase transaction pooler (port 6543) requires prepared statements off.
// The connection is created lazily so builds and tests without a database still work.
let instance: ReturnType<typeof drizzle> | undefined;

function getDb() {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    instance = drizzle(postgres(url, { prepare: false }));
  }
  return instance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get: (_target, prop) => Reflect.get(getDb(), prop),
});
