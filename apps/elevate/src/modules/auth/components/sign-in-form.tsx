"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signInWithGoogle, signInWithPassword } from "../actions";
import { signInSchema, type SignInInput } from "../validators";
import { Field } from "./field";

function urlErrorMessage(code?: string) {
  if (code === "oauth") return "Google sign-in did not work. Your email may not be invited yet.";
  if (code === "link") return "That link is invalid or has expired.";
  return null;
}

export function SignInForm({ errorCode, next }: { errorCode?: string; next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const urlError = urlErrorMessage(errorCode);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });

  async function onSubmit(values: SignInInput) {
    setBusy(true);
    const result = await signInWithPassword(values);
    if (!result.ok) {
      toast.error(result.error);
      setBusy(false);
      return;
    }
    // The proxy sends AAL1 sessions to MFA, then on to `next`.
    router.replace(next ?? "/dashboard");
    router.refresh();
  }

  async function onGoogle() {
    setBusy(true);
    const result = await signInWithGoogle();
    if (!result.ok) {
      toast.error(result.error);
      setBusy(false);
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <div className="space-y-4">
      {urlError ? (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {urlError}
        </p>
      ) : null}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <Button type="submit" className="w-full" disabled={busy}>
          Sign in
        </Button>
      </form>
      <Button type="button" variant="outline" className="w-full" onClick={onGoogle} disabled={busy}>
        Continue with Google
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
          Accept an invite
        </Link>
      </div>
    </div>
  );
}
