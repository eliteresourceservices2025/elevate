// Sends ONE real test email to an address you choose, to prove the domain and keys work.
//   pnpm email:test you@example.com
// Brevo (SMTP): BREVO_SMTP_LOGIN, BREVO_SMTP_KEY and EMAIL_FROM. Resend (API): RESEND_API_KEY and EMAIL_FROM.
// Brevo is used when BREVO_SMTP_KEY is set (or EMAIL_PROVIDER=brevo). Reads the git-ignored file
// apps/elevate/.env.email.local (NOT .env.local, so the local background jobs can never email the fake people in the
// development database). Never prints a key.
import { config } from "dotenv";
import nodemailer from "nodemailer";
import { renderEmail } from "@/modules/notifications/email-content";
import { brevoTransportOptions, resolveEmailProvider } from "@/modules/notifications/smtp-config";

config({ path: ".env.email.local" });

const to = process.argv[2];
const from = process.env.EMAIL_FROM;
const brevo = resolveEmailProvider(process.env) === "brevo";
if (!to || !to.includes("@")) throw new Error("Usage: pnpm email:test you@example.com");
if (!from) throw new Error("Put EMAIL_FROM in apps/elevate/.env.email.local first (see docs/SETUP.md).");

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const mail = renderEmail({
  heading: "ELEVATE test email",
  lines: [`If you can read this, ELEVATE can send email through ${brevo ? "Brevo" : "Resend"}.`, "This message was sent by a one-off test script."],
  link: "/dashboard",
  appUrl,
});

console.log(`Sending from ${from} to ${to} through ${brevo ? "Brevo (SMTP)" : "Resend (API)"} ...`);

if (brevo) {
  const login = process.env.BREVO_SMTP_LOGIN;
  const key = process.env.BREVO_SMTP_KEY;
  if (!login || !key) throw new Error("Put BREVO_SMTP_LOGIN and BREVO_SMTP_KEY in apps/elevate/.env.email.local first.");
  const transport = nodemailer.createTransport(brevoTransportOptions(login, key, process.env.BREVO_SMTP_HOST));
  try {
    const info = await transport.sendMail({
      from,
      to,
      subject: "ELEVATE test email",
      text: mail.text,
      html: mail.html,
      ...(process.env.EMAIL_REPLY_TO ? { replyTo: process.env.EMAIL_REPLY_TO } : {}),
      ...(process.env.EMAIL_APPLICANT_BCC ? { bcc: process.env.EMAIL_APPLICANT_BCC } : {}),
    });
    console.log(`Sent. Brevo message id: ${info.messageId}. Check the inbox (and spam) for ${to}.`);
  } catch (error) {
    const e = error as { responseCode?: number; response?: string; code?: string };
    console.error(`Brevo refused it (${e.responseCode ?? e.code ?? "no code"}): ${e.response ?? ""}`.trim());
    console.error("Common causes: the SMTP key is wrong (use the SMTP key, not the API key), EMAIL_FROM is not on the authenticated domain, or the domain is not verified yet.");
    process.exit(1);
  }
} else {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Put RESEND_API_KEY in apps/elevate/.env.email.local first (see docs/SETUP.md).");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: "ELEVATE test email", text: mail.text, html: mail.html, ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}), ...(process.env.EMAIL_APPLICANT_BCC ? { bcc: [process.env.EMAIL_APPLICANT_BCC] } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok) {
    console.error(`Resend refused it (HTTP ${response.status}): ${body.name ?? ""} ${body.message ?? ""}`.trim());
    console.error("Common causes: the domain is not verified yet, EMAIL_FROM uses a different domain, or the API key is restricted to another domain.");
    process.exit(1);
  }
  console.log(`Sent. Resend id: ${body.id}. Check the inbox (and spam) for ${to}.`);
}
