import "server-only";
import { flushEmailQueue } from "@/modules/notifications/email-queue";
import { sendCandidateEmails } from "./jobs";

/**
 * Sends what recruiting just queued (the interview invitation to the applicant and the interviewers' calendar emails, a rejection, the
 * "we got your application" note) now, instead of at the next 30-minute run: people expect these the moment they are sent. Best effort,
 * called after the transaction commits: if no sender is configured, a daily budget is used up or the send fails, the emails stay queued
 * and the regular jobs send them.
 */
export async function sendRecruitingEmailsNow(): Promise<void> {
  for (const send of [() => sendCandidateEmails(), () => flushEmailQueue()]) {
    try {
      await send();
    } catch (error) {
      console.error("immediate recruiting email send failed:", error instanceof Error ? error.name : "unknown error");
    }
  }
}
