"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updatePassword } from "../actions";
import { PASSWORD_MIN_LENGTH, resetPasswordSchema, type ResetPasswordInput } from "../validators";
import { Field } from "./field";

export function ResetPasswordForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  async function onSubmit(values: ResetPasswordInput) {
    const result = await updatePassword(values);
    if (!result.ok) return toast.error(result.error);
    toast.success("Password updated.");
    router.replace("/mfa");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <p className="-mt-2 text-xs text-muted-foreground">At least {PASSWORD_MIN_LENGTH} characters.</p>
      <Field
        id="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        Update password
      </Button>
    </form>
  );
}
