"use client";

import Link from "next/link";
import { ErrorState } from "@/components/error-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A page in the signed-in app failed: the shell stays, only the content shows this. No message or stack is ever shown. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState digest={error.digest} reset={reset}>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to dashboard
      </Link>
    </ErrorState>
  );
}
