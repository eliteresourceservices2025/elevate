"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { revealSensitiveField } from "../actions";
import type { SensitiveField } from "../constants";

const HIDE_AFTER_MS = 30_000;

/**
 * Shows a masked value. "Reveal" asks the server to decrypt it (audited every time) and the value
 * disappears again after 30 seconds. The plaintext is never part of the page itself.
 */
export function RevealField({
  employeeId,
  field,
  label,
  mask,
  canReveal,
}: {
  employeeId: string;
  field: SensitiveField;
  label: string;
  mask: string | undefined;
  canReveal: boolean;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (value === null) return;
    const timer = setTimeout(() => setValue(null), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [value]);

  if (!mask) return <span className="text-muted-foreground">Not set</span>;

  function reveal() {
    startTransition(async () => {
      const result = await revealSensitiveField({ employeeId, field });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setValue(result.data.value);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-sm" aria-live="polite">
        {value ?? mask}
      </span>
      {canReveal ? (
        value === null ? (
          <Button type="button" variant="ghost" size="xs" onClick={reveal} disabled={pending} aria-label={`Reveal ${label}`}>
            <Eye aria-hidden /> Reveal
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="xs" onClick={() => setValue(null)} aria-label={`Hide ${label}`}>
            <EyeOff aria-hidden /> Hide
          </Button>
        )
      ) : null}
    </span>
  );
}
