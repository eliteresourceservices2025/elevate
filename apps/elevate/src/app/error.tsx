"use client";

import Link from "next/link";
import { ErrorState } from "@/components/error-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A page outside the signed-in app (sign-in, careers, legal pages, signing) failed. Fixed wording only. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[70dvh] items-center justify-center bg-background p-6">
      <ErrorState digest={error.digest} reset={reset}>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Go home
        </Link>
      </ErrorState>
    </main>
  );
}
