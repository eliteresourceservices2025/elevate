import type { Metadata } from "next";
import { AuthCard } from "@/modules/auth/components/auth-card";
import { ForgotPasswordForm } from "@/modules/auth/components/forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password" description="We will email you a reset link.">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
