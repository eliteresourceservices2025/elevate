import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { getEmailSender } from "@/modules/notifications/email";
import { esignEnvelopes, esignSigners } from "./schema";

// Outside signers (a candidate with an offer) have no ELEVATE account. They get an emailed link and, to sign, a 6-digit code emailed
// to the same address. Both go straight out through the email service (never queued, never BCC'd: the link and code are secrets) and
// are never logged. Only SHA-256 hashes are stored.

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const codeHash = (signerId: string, code: string) => sha256(`${signerId}:${code}`);

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
export const signLink = (token: string) => `${appUrl()}/sign/${token}`;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstName = (full: string) => full.trim().split(/\s+/)[0] || "there";

function frame(heading: string, lines: string[], button?: { label: string; url: string }) {
  const text = `${lines.join("\n\n")}${button ? `\n\n${button.label}: ${button.url}` : ""}\n\nElite Resource Services`;
  const paragraphs = lines.map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${escapeHtml(l)}</p>`).join("\n");
  const cta = button ? `<p style="margin:20px 0"><a href="${escapeHtml(button.url)}" style="background:#8A2BE2;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">${escapeHtml(button.label)}</a></p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3fb;font-family:Inter,Arial,sans-serif;color:#1f1b2d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#8A2BE2;padding:16px 24px;color:#ffffff;font-weight:700;font-size:18px">Elite Resource Services</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:18px">${escapeHtml(heading)}</h1>${paragraphs}${cta}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export type ExternalMailKind = "turn" | "reminder" | "completed";

export function linkMail(kind: ExternalMailKind, name: string, url: string) {
  if (kind === "completed") {
    const m = frame("Your document is signed", [`Hi ${firstName(name)},`, "Everyone has signed. You can read and download the signed copy with the link below. You will be asked for a new code."], { label: "Open your signed document", url });
    return { subject: "Your signed document is ready", ...m };
  }
  const reminder = kind === "reminder";
  const m = frame(reminder ? "Reminder: a document is waiting for you" : "A document is waiting for your signature", [`Hi ${firstName(name)},`, reminder ? "This is a reminder that a document from Elite Resource Services is still waiting for your signature." : "Elite Resource Services has sent you a document to read and sign.", "Open the link below. To keep it secure, we will email you a 6-digit code to confirm it is you before you can read and sign. The link works only for you; please do not forward it."], { label: "Read and sign", url });
  return { subject: reminder ? "Reminder: a document is waiting for your signature" : "A document is waiting for your signature", ...m };
}

export function codeMail(name: string, code: string) {
  const m = frame("Your code", [`Hi ${firstName(name)},`, `Your 6-digit code is ${code}. It works for 15 minutes. If you did not ask for it, you can ignore this message.`]);
  return { subject: `Your code is ${code}`, ...m };
}

/** Sends one email through the configured service; false when there is none or it refuses. Never logs the address or the content. */
export async function sendDirect(to: string, mail: { subject: string; text: string; html: string }): Promise<boolean> {
  const sender = getEmailSender();
  if (!sender) return false;
  try {
    await sender.send({ to, ...mail });
    return true;
  } catch {
    console.error("external signer email failed");
    return false;
  }
}

/**
 * Gives each outside signer a fresh link (replacing any earlier one) and emails it. Returns how many emails went out. A signer whose
 * turn has not come, or who already finished, is skipped for "turn" and "reminder".
 */
export async function issueExternalLinks(signerIds: string[], kind: ExternalMailKind): Promise<{ sent: number; failed: number }> {
  if (signerIds.length === 0) return { sent: 0, failed: 0 };
  const rows = await db
    .select({ id: esignSigners.id, tokenHash: esignSigners.accessTokenHash, email: esignSigners.externalEmail, name: esignSigners.externalName, status: esignSigners.status, envelopeId: esignSigners.envelopeId })
    .from(esignSigners)
    .where(inArray(esignSigners.id, signerIds));
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    if (!r.email || !r.name) continue;
    if (kind !== "completed" && r.status !== "pending") continue;
    if (kind === "completed" && r.status !== "signed") continue;
    const token = newToken();
    // A "turn" or "reminder" link replaces the old one for good. The "signed copy" link keeps the old one working too (to open the signed copy).
    await db
      .update(esignSigners)
      .set({ accessTokenHash: sha256(token), previousTokenHash: kind === "completed" ? r.tokenHash : null, lastNoticeAt: new Date() })
      .where(eq(esignSigners.id, r.id));
    const ok = await sendDirect(r.email, linkMail(kind, r.name, signLink(token)));
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** Does an envelope still accept this outside signer? Used to reject stale links. */
export async function envelopeOf(envelopeId: string) {
  const [env] = await db.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId));
  return env ?? null;
}
