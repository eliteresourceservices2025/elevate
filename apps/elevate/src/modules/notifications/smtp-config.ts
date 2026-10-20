// The email provider choice and Brevo's SMTP settings, in one place with no server-only import so the
// go-live check, the sender and scripts/send-test-email.mts all agree.

export type EmailProviderName = "brevo" | "resend";

/** EMAIL_PROVIDER wins; otherwise Brevo when its SMTP key is set, else Resend. */
export function resolveEmailProvider(env: Record<string, string | undefined>): EmailProviderName {
  const chosen = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (chosen === "brevo" || chosen === "resend") return chosen;
  return env.BREVO_SMTP_KEY?.trim() ? "brevo" : "resend";
}

/**
 * Brevo over SMTP: STARTTLS on 587 (port 25 is blocked on Vercel). One pooled connection, so a queue flush
 * reuses it instead of a full connect + TLS + login for every message.
 */
export function brevoTransportOptions(login: string, key: string, host?: string) {
  return {
    host: host || "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    requireTLS: true,
    pool: true,
    maxConnections: 1,
    auth: { user: login, pass: key },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  } as const;
}
