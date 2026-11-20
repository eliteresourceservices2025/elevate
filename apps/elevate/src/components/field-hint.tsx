"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A small (i) button that explains a form field. Its accessible name is generic on purpose (a label-based lookup of the field must not also find the button); `data-hint-for` names the field for tests. It opens on hover, on keyboard focus + Enter, and on a tap, so it works on a phone
 * or tablet where a plain tooltip never would. Put plain words in `children`: what the box is for and what to type.
 */
export function FieldHint({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label="More information"
        data-hint-for={label}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-9",
          className,
        )}
      >
        <Info className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 max-w-[calc(100vw-2rem)] text-sm leading-snug">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** A form label with its (i) explanation beside it. Use in place of `<Label>` for any field a newcomer could misread. */
export function HintedLabel({ htmlFor, hint, children, labelText }: { htmlFor: string; hint: ReactNode; children: ReactNode; labelText?: string }) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor}>{children}</Label>
      <FieldHint label={labelText ?? (typeof children === "string" ? children : "this field")}>{hint}</FieldHint>
    </div>
  );
}
