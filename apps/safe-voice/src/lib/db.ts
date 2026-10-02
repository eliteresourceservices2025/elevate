import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

// The only database connection in this app. SAFEVOICE_DATABASE_URL belongs to the `safevoice_app` role, which can add reports,
// messages and attachments and read back only what a reporter is shown (see migration 0037). It cannot reach any other table.
let instance: Sql | undefined;

export function getSql(): Sql {
  if (!instance) {
    const url = process.env.SAFEVOICE_DATABASE_URL;
    if (!url) throw new Error("SAFEVOICE_DATABASE_URL is not set");
    // prepare: false for the Supabase pooler. onnotice: nothing is ever logged from here.
    instance = postgres(url, { prepare: false, max: 3, onnotice: () => {}, connection: { application_name: "safe-voice" } });
  }
  return instance;
}
