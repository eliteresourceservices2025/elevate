import "server-only";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { getEmailSender } from "@/modules/notifications/email";
import { renderInvitation } from "@/modules/notifications/email-content";

/**
 * Emails the invitation straight away (one message, sent by the person who invited, so it is not queued behind the daily budget).
 * Returns false when no email service is configured or it refuses: the invitation itself is already saved, and the person can still
 * be told to use "Accept an invite". Never logs the address or the provider's reply.
 */
export async function sendInvitationEmail(email: string, expiresAt: Date): Promise<boolean> {
  const sender = getEmailSender();
  if (!sender) return false;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const mail = renderInvitation({ appUrl, expiresOn: formatInZone(expiresAt, DEFAULT_TIMEZONE, "MMM d, yyyy") });
  try {
    await sender.send({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
    return true;
  } catch {
    console.error("invitation email failed");
    return false;
  }
}
