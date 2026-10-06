import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { limitQueries } from "./limit-queries";

// Supabase transaction pooler (port 6543) requires prepared statements off.
// The connection is created lazily so builds and tests without a database still work.
let instance: ReturnType<typeof drizzle> | undefined;

function getDb() {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Timeouts so a stalled connection fails fast instead of hanging a whole page; idle connections are released after 20 seconds.
    // At most 6 queries run at once, leaving connections free for transactions: see limit-queries.ts for why the driver must never queue.
    const client = postgres(url, { prepare: false, connect_timeout: 10, idle_timeout: 20, max: 10 });
    instance = drizzle(limitQueries(client, 6));
  }
  return instance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get: (_target, prop) => Reflect.get(getDb(), prop),
});
