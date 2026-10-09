/** The address people write to about privacy and these terms: the monitored reply-to address already used for ELEVATE email. */
export function contactEmail(): string | null {
  const raw = process.env.EMAIL_REPLY_TO?.trim();
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim() || null;
}
