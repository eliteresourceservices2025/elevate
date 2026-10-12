"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Field } from "./field";

type PasswordFieldProps = Omit<ComponentProps<typeof Field>, "type" | "adornment">;

/**
 * A password box with a button that shows what was typed, so a typo can be found before sending. It is hidden by default and only
 * changes this box; nothing about the value leaves the page. The button is a real button with a name and a pressed state.
 */
export function PasswordField({ id, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      id={id}
      {...props}
      type={visible ? "text" : "password"}
      // A visible password should not be offered to spell-checkers, auto-capitalised or auto-corrected.
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      className="pr-10"
      adornment={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-controls={id}
          className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      }
    />
  );
}
