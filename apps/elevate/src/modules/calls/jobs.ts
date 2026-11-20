import "server-only";
import { expireRecordings } from "./recording";
import { endAbandonedCalls } from "./service";

/** Daily: calls nobody is in any more are ended, and recordings past their 30 days are deleted. Counts only. */
export async function runCallsDaily(): Promise<{ endedCalls: number; deletedRecordings: number }> {
  const endedCalls = await endAbandonedCalls();
  const deletedRecordings = await expireRecordings();
  return { endedCalls, deletedRecordings };
}
