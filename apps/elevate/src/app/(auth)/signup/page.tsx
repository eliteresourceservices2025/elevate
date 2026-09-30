import type { Metadata } from "next";
import { AuthCard } from "@/modules/auth/components/auth-card";
import { SignUpForm } from "@/modules/auth/components/sign-up-form";

export const metadata: Metadata = { title: "Accept your invite" };

export default function SignUpPage() {
  return (
    <AuthCard title="Accept your invite" description="Use the email address HR invited.">
      <SignUpForm />
    </AuthCard>
  );
}
