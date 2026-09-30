import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthCard } from "@/modules/auth/components/auth-card";
import { MfaForm } from "@/modules/auth/components/mfa-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function MfaPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.[0]; // `totp` lists only verified authenticator factors

  return (
    <AuthCard
      title={verified ? "Two-step verification" : "Set up two-step verification"}
      description={verified ? undefined : "Required for every ELEVATE account."}
    >
      <MfaForm factorId={verified?.id ?? null} />
    </AuthCard>
  );
}
