import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type Shared = { id: string; label: string; error?: string; hint?: string };

function Describe({ id, error, hint }: Pick<Shared, "id" | "error" | "hint">) {
  return (
    <>
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

const describedBy = ({ id, error, hint }: Pick<Shared, "id" | "error" | "hint">) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextField({ id, label, error, hint, ...props }: Shared & ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy({ id, error, hint })} {...props} />
      <Describe id={id} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({
  id,
  label,
  error,
  hint,
  children,
  ...props
}: Shared & ComponentProps<typeof NativeSelect> & { children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy({ id, error, hint })} {...props}>
        {children}
      </NativeSelect>
      <Describe id={id} error={error} hint={hint} />
    </div>
  );
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {description ? <p className="-mt-2 text-sm text-muted-foreground">{description}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
