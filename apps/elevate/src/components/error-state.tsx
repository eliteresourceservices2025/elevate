"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What the person sees when a page or panel fails. It never shows the error's message or stack (they can hold names, ids or SQL):
 * only fixed wording and the digest, a short code the team can look up in the logs. `reset` retries the part that failed.
 */
export function ErrorState({ title = "Something went wrong", description = "We could not load this page. Try again, and if it keeps happening tell support.", digest, reset, children, className }: { title?: string; description?: string; digest?: string; reset?: () => void; children?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center", className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      {digest ? <p className="text-xs text-muted-foreground tabular-nums">Reference: {digest}</p> : null}
      {reset || children ? (
        <div className="flex flex-wrap justify-center gap-2">
          {reset ? <Button onClick={reset}>Try again</Button> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
