import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { brevoTransportOptions, resolveEmailProvider, type EmailProviderName } from "./smtp-config";

// Sending email. Production uses Brevo over SMTP or Resend over its HTTP API (see emailProvider()); with no
// key configured nothing is sent and the queue simply waits. Tests install a fake with setEmailSender().

export type EmailAttachment = { fileName: string; mimeType: string; /** The file's text (a calendar invite), or base64 when `base64` is true (a PDF). */ content: string; base64?: boolean };
export type OutgoingEmail = { to: string; subject: string; text: string; html: string; attachments?: EmailAttachment[]; /** A silent copy to a shared mailbox (applicant emails only). */ bcc?: string; /** Replies go here instead of the default address (support requests: the person who asked). */ replyTo?: string };
export interface EmailSender {
  send(mail: OutgoingEmail): Promise<void>;
}

class ResendSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {}

  async send(mail: OutgoingEmail) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        ...(mail.replyTo || this.replyTo ? { reply_to: mail.replyTo ?? this.replyTo } : {}),
        ...(mail.bcc ? { bcc: [mail.bcc] } : {}),
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.attachments?.length ? { attachments: mail.attachments.map((a) => ({ filename: a.fileName, content: a.base64 ? a.content : Buffer.from(a.content, "utf8").toString("base64") })) } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // Only the status is kept: the response can echo the recipient's address.
    if (!response.ok) throw new Error(`Email provider refused the message (HTTP ${response.status})`);
  }
}

/** Brevo over plain SMTP (settings in smtp-config.ts). The send is always awaited by the caller. */
class SmtpSender implements EmailSender {
  constructor(
    private readonly transport: Pick<Transporter, "sendMail">,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {}

  async send(mail: OutgoingEmail) {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: mail.to,
        ...(mail.replyTo || this.replyTo ? { replyTo: mail.replyTo ?? this.replyTo } : {}),
        ...(mail.bcc ? { bcc: mail.bcc } : {}),
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.attachments?.length
          ? { attachments: mail.attachments.map((a) => ({ filename: a.fileName, contentType: a.mimeType, content: a.content, ...(a.base64 ? { encoding: "base64" } : {}) })) }
          : {}),
      });
    } catch (error) {
      // Only the SMTP status code is kept: the message can echo the recipient's address.
      const code = (error as { responseCode?: number; code?: string }).responseCode ?? (error as { code?: string }).code ?? "unknown";
      throw new Error(`Email provider refused the message (SMTP ${code})`);
    }
  }
}

function brevoSender(): EmailSender | null {
  const login = process.env.BREVO_SMTP_LOGIN;
  const key = process.env.BREVO_SMTP_KEY;
  const from = process.env.EMAIL_FROM;
  if (!login || !key || !from) return null;
  const transport = nodemailer.createTransport(brevoTransportOptions(login, key, process.env.BREVO_SMTP_HOST));
  return new SmtpSender(transport, from, process.env.EMAIL_REPLY_TO || undefined);
}

/** Which provider sends: "brevo" or "resend" (see resolveEmailProvider). */
export function emailProvider(): EmailProviderName {
  return resolveEmailProvider(process.env);
}

let override: EmailSender | null | undefined;
/** Tests only: install a fake sender, or null to behave as "not configured". Pass undefined to restore the default. */
export function setEmailSender(sender: EmailSender | null | undefined) {
  override = sender;
}

/** The configured sender, or null when the chosen provider's keys / EMAIL_FROM are not set (emails stay queued). */
export function getEmailSender(): EmailSender | null {
  if (override !== undefined) return override;
  if (emailProvider() === "brevo") return brevoSender();
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  // EMAIL_REPLY_TO: a monitored address, so people can answer (a one-way "no-reply" sender lowers trust with inbox providers).
  return key && from ? new ResendSender(key, from, process.env.EMAIL_REPLY_TO || undefined) : null;
}
