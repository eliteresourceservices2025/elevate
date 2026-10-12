import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FieldProps = ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string;
  /** Something placed inside the right edge of the box (the show/hide button of a password). */
  adornment?: ReactNode;
};

export function Field({ id, label, error, adornment, ...props }: FieldProps) {
  const input = (
    <Input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      {...props}
    />
  );
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {adornment ? (
        <div className="relative">
          {input}
          {adornment}
        </div>
      ) : (
        input
      )}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
