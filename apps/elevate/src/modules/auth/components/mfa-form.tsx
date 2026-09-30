"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startTotpEnrollment, verifyTotp, type EnrollData } from "../actions";
import { mfaCodeSchema, type MfaCodeInput } from "../validators";
import { Field } from "./field";

// `factorId` is set when the user already has a verified authenticator (challenge).
// Otherwise the form enrolls a new one and shows the QR code.
export function MfaForm({ factorId }: { factorId: string | null }) {
  const router = useRouter();
  const [enroll, setEnroll] = useState<EnrollData | null>(null);
  const [loading, setLoading] = useState(factorId === null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MfaCodeInput>({ resolver: zodResolver(mfaCodeSchema) });

  useEffect(() => {
    if (factorId !== null) return;
    let cancelled = false;
    startTotpEnrollment().then((result) => {
      if (cancelled) return;
      if (result.ok) setEnroll(result.data);
      else toast.error(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [factorId]);

  const activeFactor = factorId ?? enroll?.factorId ?? null;

  async function onSubmit(values: MfaCodeInput) {
    if (!activeFactor) return;
    const result = await verifyTotp(activeFactor, values);
    if (!result.ok) return toast.error(result.error);
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {factorId === null ? (
        <div className="space-y-3 text-center text-sm">
          <p>
            Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password),
            then enter the 6-digit code.
          </p>
          {loading ? <p role="status">Preparing your code…</p> : null}
          {enroll ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL from Supabase; nothing to optimise */}
              <img
                src={enroll.qrCode}
                alt="QR code for your authenticator app"
                width={176}
                height={176}
                className="mx-auto rounded-lg border bg-white p-2"
              />
              <p className="text-xs text-muted-foreground">
                Cannot scan? Enter this key instead: <span className="font-mono break-all">{enroll.secret}</span>
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <p className="text-center text-sm">Enter the 6-digit code from your authenticator app.</p>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field
          id="code"
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={errors.code?.message}
          {...register("code")}
        />
        <Button type="submit" className="w-full" disabled={isSubmitting || !activeFactor}>
          Verify
        </Button>
      </form>
    </div>
  );
}
