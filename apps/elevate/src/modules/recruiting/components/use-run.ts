"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

/** Runs an action, shows its error or a success message, and refreshes the page data. */
export function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = <T,>(fn: () => Promise<{ ok: boolean; error?: string; data?: T }>, success: string | ((data: T | undefined) => string), after?: (data: T | undefined) => void) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        const message = typeof success === "function" ? success(result.data) : success;
        if (message) toast.success(message);
        after?.(result.data);
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return { run, pending, router };
}
