// Sends ONE real test email through Resend to an address you choose, to prove the domain and API key work.
//   pnpm email:test you@example.com
// Reads RESEND_API_KEY and EMAIL_FROM from the git-ignored file apps/elevate/.env.email.local (NOT .env.local, so the
// local background jobs can never email the fake people in the development database). Never prints the key.
import { config } from "dotenv";
import { renderEmail } from "@/modules/notifications/email-content";

config({ path: ".env.email.local" });

const to = process.argv[2];
const key = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM;
if (!to || !to.includes("@")) throw new Error("Usage: pnpm email:test you@example.com");
if (!key || !from) throw new Error("Put RESEND_API_KEY and EMAIL_FROM in apps/elevate/.env.email.local first (see docs/SETUP.md).");

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const mail = renderEmail({
  heading: "ELEVATE test email",
  lines: ["If you can read this, ELEVATE can send email through Resend.", "This message was sent by a one-off test script."],
  link: "/dashboard",
  appUrl,
});

console.log(`Sending from ${from} to ${to} ...`);
const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from, to: [to], subject: "ELEVATE test email", text: mail.text, html: mail.html }),
  signal: AbortSignal.timeout(15_000),
});
const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
if (!response.ok) {
  console.error(`Resend refused it (HTTP ${response.status}): ${body.name ?? ""} ${body.message ?? ""}`.trim());
  console.error("Common causes: the domain is not verified yet, EMAIL_FROM uses a different domain, or the API key is restricted to another domain.");
  process.exit(1);
}
console.log(`Sent. Resend id: ${body.id}. Check the inbox (and spam) for ${to}.`);
