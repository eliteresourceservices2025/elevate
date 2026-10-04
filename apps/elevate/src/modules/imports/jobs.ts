import "server-only";
import { discardStaleBatches } from "./service";

/** Daily: a preview nobody committed within 14 days is discarded and its encrypted rows wiped. */
export async function runImportPurge(now = new Date()): Promise<{ discarded: number }> {
  return { discarded: await discardStaleBatches(now) };
}
