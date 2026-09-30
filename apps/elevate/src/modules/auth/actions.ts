"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit, type AuditEntry } from "@/modules/audit/write";
import {
  forgotPasswordSchema,
  mfaCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./validators";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";
const GENERIC = "Something went wrong. Try again.";

// Sign-in events are best effort: a logging failure must not lock people out or leak details.
async function auditAuth(entry: AuditEntry) {
  try {
    await writeAudit(entry);
  } catch {
    console.error("audit write failed for", entry.action);
  }
}

async function siteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function signInWithPassword(input: unknown): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return fail("Enter your email and password.");

  if (!(await allowRequest("login", `${await clientIp()}:${parsed.data.email}`))) return fail(TOO_MANY);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for every failure so the form cannot reveal which emails exist.
  if (error) {
    await auditAuth({ actor: null, action: "auth.login_failed", metadata: { email: parsed.data.email, method: "password" } });
    return fail("Invalid email or password, or the email is not confirmed yet.");
  }
  return { ok: true, data: undefined };
}

export async function signInWithGoogle(): Promise<ActionResult<{ url: string }>> {
  if (!(await allowRequest("login", await clientIp()))) return fail(TOO_MANY);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback`, scopes: "openid email profile" },
  });
  if (error || !data.url) return fail(GENERIC);
  return { ok: true, data: { url: data.url } };
}

export async function signUpWithInvite(input: unknown): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");

  if (!(await allowRequest("signup", `${await clientIp()}:${parsed.data.email}`))) return fail(TOO_MANY);

  // The before-user-created hook in the database rejects emails that were not invited.
  // The same message is returned either way, so this form cannot reveal who is invited.
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/mfa` },
  });
  return { ok: true, data: undefined };
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid email address.");

  if (!(await allowRequest("passwordReset", `${await clientIp()}:${parsed.data.email}`))) return fail(TOO_MANY);

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/reset-password`,
  });
  return { ok: true, data: undefined };
}

export async function updatePassword(input: unknown): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return fail("Your reset link expired. Request a new one.");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(error.message.includes("same") ? "Choose a different password." : GENERIC);

  // End every other session after a password change.
  await supabase.auth.signOut({ scope: "others" });
  return { ok: true, data: undefined };
}

export type EnrollData = { factorId: string; qrCode: string; secret: string };

export async function startTotpEnrollment(): Promise<ActionResult<EnrollData>> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Sign in again.");
  if (!(await allowRequest("mfa", auth.user.id))) return fail(TOO_MANY);

  // Remove abandoned, unverified factors so enrollment can be retried.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "ELEVATE",
    friendlyName: `ELEVATE ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return fail(GENERIC);
  return { ok: true, data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

/** Verifies a 6-digit code for enrollment or sign-in. Success upgrades the session to AAL2. */
export async function verifyTotp(factorId: string, input: unknown): Promise<ActionResult> {
  const parsed = mfaCodeSchema.safeParse(input);
  if (!parsed.success) return fail("Enter the 6-digit code.");

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Sign in again.");
  if (!(await allowRequest("mfa", auth.user.id))) return fail(TOO_MANY);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const enrolling = factors?.all.some((f) => f.id === factorId && f.status === "unverified") ?? false;

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: parsed.data.code });
  const actor = { id: auth.user.id, email: auth.user.email ?? "" };
  if (error) {
    await auditAuth({ actor, action: "auth.mfa_failed" });
    return fail("That code did not work. Check your authenticator app and try again.");
  }

  if (enrolling) await auditAuth({ actor, action: "auth.mfa_enrolled" });
  // Reaching AAL2 is the moment a person is really signed in, for any sign-in method.
  await auditAuth({ actor, action: "auth.login", metadata: { provider: auth.user.app_metadata?.provider ?? null } });
  return { ok: true, data: undefined };
}

export async function signOut(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await auditAuth({ actor: { id: data.user.id, email: data.user.email ?? "" }, action: "auth.logout" });
  await supabase.auth.signOut();
  redirect("/login");
}
