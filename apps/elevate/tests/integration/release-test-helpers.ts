import { sql } from "drizzle-orm";

// Release versions must always be higher than every release that exists, and the integration files share one database, so a test cannot
// pick a fixed number: it asks for the next one instead. (Files run one after another, never at the same time.)

export async function nextVersion(): Promise<string> {
  const { db } = await import("@/lib/db");
  const rows = (await db.execute(sql`select version from time.tracker_releases`)) as unknown as { version: string }[];
  let best: [number, number, number] = [0, 0, 0];
  for (const { version } of rows) {
    const p = version.split(".").map(Number) as [number, number, number];
    if (p[0] > best[0] || (p[0] === best[0] && (p[1] > best[1] || (p[1] === best[1] && p[2] > best[2])))) best = p;
  }
  return `${best[0]}.${best[1] + 1}.0`;
}
