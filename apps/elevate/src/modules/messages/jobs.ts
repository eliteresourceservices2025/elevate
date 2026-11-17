import "server-only";
import { syncChannels, type SyncResult } from "./channels";

/** Daily: keeps the team, department and company chat channels in step with the organization. A plain function so it can be tested. */
export async function runChatChannelSync(): Promise<SyncResult & { skipped?: string }> {
  return syncChannels();
}
