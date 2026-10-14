import "server-only";
import { purgeStaleScheduleBatches } from "@/modules/schedule-import/service";
import { discardStaleBatches } from "./service";

/** Daily: a preview nobody committed within 14 days is discarded and its encrypted rows wiped. */
export async function runImportPurge(now = new Date()): Promise<{ discarded: number }> {
  return { discarded: (await discardStaleBatches(now)) + (await purgeStaleScheduleBatches(now)) };
}
