import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type Shared = { id: string; label: string; error?: string; hint?: string };

function Describe({ id, error, hint }: Pick<Shared, "id" | "error" | "hint">) {
  return (
    <>
      {hint ? (
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

// A hint stays visible next to an error: the rule that was broken is usually in it.
const describedBy = ({ id, error, hint }: Pick<Shared, "id" | "error" | "hint">) => [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

/** The label, with a visible "required" cue on a required field (screen readers get it from the field itself). Optional fields stay unmarked. */
function FieldLabel({ id, label, required }: { id: string; label: string; required?: boolean }) {
  return (
    <Label htmlFor={id}>
      {label}
      {required ? <span aria-hidden className="font-normal text-muted-foreground"> (required)</span> : null}
    </Label>
  );
}

export function TextField({ id, label, error, hint, ...props }: Shared & ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <FieldLabel id={id} label={label} required={props.required} />
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
      <FieldLabel id={id} label={label} required={props.required} />
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
