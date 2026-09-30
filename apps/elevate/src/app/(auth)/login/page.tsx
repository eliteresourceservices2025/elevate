import type { Metadata } from "next";
import { safeNext } from "@/lib/route-access";
import { AuthCard } from "@/modules/auth/components/auth-card";
import { SignInForm } from "@/modules/auth/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const next = typeof params.next === "string" ? safeNext(params.next) : undefined;

  return (
    <AuthCard title="Sign in to ELEVATE" description="Use your ERS account.">
      <SignInForm errorCode={error} next={next} />
    </AuthCard>
  );
}
