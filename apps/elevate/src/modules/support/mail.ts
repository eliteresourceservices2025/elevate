// The email a support request becomes. Pure. The message is the person's own words, sent to the support mailbox on purpose.

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderSupportEmail(input: { name: string | null; email: string; topic: string; subject: string; message: string; page: string | null; appUrl: string; requestId: string }) {
  const who = input.name ? `${input.name} <${input.email}>` : input.email;
  const inbox = `${input.appUrl.replace(/\/+$/, "")}/support`;
  const subject = `[ELEVATE support] ${input.topic}: ${input.subject}`.slice(0, 200);
  const lines = [`From: ${who}`, `Topic: ${input.topic}`, input.page ? `Page: ${input.page}` : null, `Request: ${input.requestId}`, "", input.message, "", `Reply to this email to answer the person. The request is also in ${inbox}.`].filter((l): l is string => l !== null);
  const text = lines.join("\n");
  const html = `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#1f1b2d;font-size:14px;line-height:1.5">
<p><strong>From:</strong> ${escapeHtml(who)}<br><strong>Topic:</strong> ${escapeHtml(input.topic)}${input.page ? `<br><strong>Page:</strong> ${escapeHtml(input.page)}` : ""}<br><strong>Request:</strong> ${escapeHtml(input.requestId)}</p>
<p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>
<p style="color:#6b6680;font-size:12px">Reply to this email to answer the person. The request is also in <a href="${escapeHtml(inbox)}">ELEVATE</a>.</p>
</body></html>`;
  return { subject, text, html };
}
