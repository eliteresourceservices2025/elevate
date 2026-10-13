import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

// The only database connection in this app. LEARN_DATABASE_URL belongs to the `learn_app` role, which can only read its own rows and
// run the functions of the `learn` schema (migration 0054). It cannot read the exam answer key or reach any other schema.
let instance: Sql | undefined;

export function getSql(): Sql {
  if (!instance) {
    const url = process.env.LEARN_DATABASE_URL;
    if (!url) throw new Error("LEARN_DATABASE_URL is not set");
    // prepare: false for the Supabase pooler. onnotice: nothing is ever logged from here.
    instance = postgres(url, { prepare: false, max: 5, onnotice: () => {}, connection: { application_name: "learn" } });
  }
  return instance;
}

/** Runs queries as one person: sets the value the row-level-security policies compare against, for this transaction only. */
export async function withUser<T>(sql: Sql, userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('learn.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}
