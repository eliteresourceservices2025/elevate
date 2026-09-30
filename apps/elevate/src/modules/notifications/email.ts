import "server-only";

// Sending email. Production uses Resend over its HTTP API; with no key configured nothing is sent and
// the queue simply waits. Tests install a fake with setEmailSender().

export type EmailAttachment = { fileName: string; mimeType: string; /** The file's text (a calendar invite). */ content: string };
export type OutgoingEmail = { to: string; subject: string; text: string; html: string; attachments?: EmailAttachment[] };
export interface EmailSender {
  send(mail: OutgoingEmail): Promise<void>;
}

class ResendSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(mail: OutgoingEmail) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.attachments?.length ? { attachments: mail.attachments.map((a) => ({ filename: a.fileName, content: Buffer.from(a.content, "utf8").toString("base64") })) } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // Only the status is kept: the response can echo the recipient's address.
    if (!response.ok) throw new Error(`Email provider refused the message (HTTP ${response.status})`);
  }
}

let override: EmailSender | null | undefined;
/** Tests only: install a fake sender, or null to behave as "not configured". Pass undefined to restore the default. */
export function setEmailSender(sender: EmailSender | null | undefined) {
  override = sender;
}

/** The configured sender, or null when RESEND_API_KEY / EMAIL_FROM are not set (emails stay queued). */
export function getEmailSender(): EmailSender | null {
  if (override !== undefined) return override;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  return key && from ? new ResendSender(key, from) : null;
}
