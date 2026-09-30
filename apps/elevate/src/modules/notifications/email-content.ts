// Pure helpers for what an email says. Emails carry counts and a link, never names, titles or details:
// email is not a secure channel.

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text plus a simple branded HTML version. `link` must be a relative in-app path. */
export function renderEmail(input: { heading: string; lines: string[]; link: string; appUrl: string }) {
  const path = input.link.startsWith("/") && !input.link.startsWith("//") ? input.link : "/dashboard";
  const url = `${input.appUrl.replace(/\/+$/, "")}${path}`;
  const text = `${input.heading}\n\n${input.lines.join("\n")}\n\nOpen ELEVATE: ${url}\n\nYou are receiving this because you have an ELEVATE account.`;
  const paragraphs = input.lines.map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5">${escapeHtml(l)}</p>`).join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3fb;font-family:Inter,Arial,sans-serif;color:#1f1b2d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#8A2BE2;padding:16px 24px;color:#ffffff;font-weight:700;font-size:18px">ELEVATE</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:18px">${escapeHtml(input.heading)}</h1>
${paragraphs}
<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="background:#8A2BE2;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open ELEVATE</a></p>
<p style="margin:0;font-size:12px;color:#6b6680">You are receiving this because you have an ELEVATE account.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { text, html, url };
}

/** Which heading a notification kind is counted under in the digest. */
export function digestGroup(kind: string): string {
  if (kind.startsWith("announcement.") || kind.startsWith("policy.")) return "announcements and policies";
  if (kind.startsWith("document.")) return "document reminders";
  return "other updates";
}

export type DigestCounts = { kind: string; count: number }[];

/** Subject and lines for one person's digest: how many unread, grouped, nothing identifying. */
export function buildDigest(counts: DigestCounts) {
  const groups = new Map<string, number>();
  let total = 0;
  for (const { kind, count } of counts) {
    const label = digestGroup(kind);
    groups.set(label, (groups.get(label) ?? 0) + count);
    total += count;
  }
  const noun = total === 1 ? "unread notification" : "unread notifications";
  return {
    total,
    subject: `You have ${total} ${noun} in ELEVATE`,
    heading: `You have ${total} ${noun}`,
    lines: [...groups].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label}`),
  };
}

export function buildAckEmail(pending: number, overdue: number) {
  const items = pending === 1 ? "1 item is" : `${pending} items are`;
  return {
    subject: pending === 1 ? "1 item needs your acknowledgment in ELEVATE" : `${pending} items need your acknowledgment in ELEVATE`,
    heading: "Acknowledgment needed",
    lines: [`${items} waiting for you to read and acknowledge.`, ...(overdue > 0 ? [`${overdue} ${overdue === 1 ? "is" : "are"} past the due date.`] : [])],
  };
}
