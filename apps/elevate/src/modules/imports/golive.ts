// The go-live checklist's pure parts: the manual steps and which environment settings must be present. No database.

export const MANUAL_STEPS = [
  { key: "domain_dns", title: "Domain and DNS", detail: "The ELEVATE address and the Safe Voice address point at the right Vercel projects, with HTTPS." },
  { key: "backups_restore", title: "Backups checked with a restore test", detail: "Restore a recent backup into a scratch project and confirm the people and documents are there. A backup nobody has restored is only a hope." },
  { key: "sentry_alerts", title: "Error alerts switched on", detail: "Sentry (or the host's alerts) tells someone when the app errors. Confirm no personal data is sent." },
  { key: "auth_email", title: "Sign-in emails work", detail: "Supabase's own emails (sign-up confirmation, password reset) go through your custom mail service, not the built-in one, which is heavily limited." },
  { key: "email_domain", title: "Email sending domain verified", detail: "Resend sends from a monitored address on your verified domain, with a reply-to set." },
  { key: "counsel_wording", title: "Counsel has read the wording", detail: "Contractor wording, the signing consent text, the monitoring policy and the retention periods." },
  { key: "pilot_team", title: "Pilot team chosen", detail: "One team clocks in with ELEVATE (and Jibble screenshots if used) for a week before everyone else." },
  { key: "invites_waves", title: "Invitations sent in waves", detail: "Pilot team first, then the rest, so support questions arrive in manageable numbers." },
  { key: "help_shared", title: "HR has the runbook and a help page", detail: "docs/RUNBOOK.md is shared with HR and the people who answer questions." },
  { key: "parallel_run", title: "Two-week parallel run finished", detail: "TalentHR stays active while both systems are used. Re-run the reconciliation daily until HR signs off." },
  { key: "talenthr_archive", title: "Full TalentHR export saved and TalentHR cancelled", detail: "Keep an encrypted export for the retention period, then cancel at the end of TalentHR's billing period." },
] as const;

export type ManualKey = (typeof MANUAL_STEPS)[number]["key"];
export const MANUAL_KEYS: readonly string[] = MANUAL_STEPS.map((s) => s.key);

/** Settings the production deployment needs. Only the NAMES are ever shown, never the values. */
export const REQUIRED_ENV = [
  "NEXT_PUBLIC_APP_URL",
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "FIELD_ENCRYPTION_KEYS",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "CRON_SECRET",
  "SAFEVOICE_HANDLER_DATABASE_URL",
  "NEXT_PUBLIC_SAFEVOICE_URL",
] as const;

/** The names that are missing or empty, plus a note when this is not the production deployment. */
export function envProblems(env: Record<string, string | undefined>): { missing: string[]; notProduction: boolean } {
  return { missing: REQUIRED_ENV.filter((k) => !(env[k] ?? "").trim()), notProduction: env.ELEVATE_ENV !== "production" };
}
