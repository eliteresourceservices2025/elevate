"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/feedback-dialog";

/** Runs a server action from a button: shows its error or success as a toast, then refreshes the page. `onDone` runs after a success. */
export function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = <T,>(fn: () => Promise<{ ok: boolean; error?: string; data?: T }>, success: (data: T | undefined) => string, onDone?: () => void) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        toast.success(success(result.data));
        onDone?.();
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return { run, pending, router };
}
