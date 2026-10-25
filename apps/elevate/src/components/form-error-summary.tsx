"use client";

import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type FormErrorItem = { id: string; message: string };

/** The visible label of the field with this id, without the "(required)" cue. Empty when the field has none. */
function labelOf(id: string): string {
  if (typeof document === "undefined") return "";
  const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
  return (label?.textContent ?? "").replace(/\s*\(required\)\s*$/, "").trim();
}

/**
 * For a long form: after a failed submit, one list of everything to fix at the top, each item a link that moves to its field. The fields
 * keep their own messages and the first invalid field still gets focus; the summary is for finding the rest without scrolling.
 * `id` of an item is the id of its input (the field's `id` prop). Renders nothing when there are no errors.
 */
export function FormErrorSummary({ items }: { items: FormErrorItem[] }) {
  if (items.length === 0) return null;
  const go = (event: React.MouseEvent, id: string) => {
    const field = document.getElementById(id);
    if (!field) return;
    event.preventDefault();
    field.scrollIntoView({ block: "center" });
    field.focus();
  };
  return (
    <Alert variant="destructive" className="rounded-xl p-3" aria-labelledby="form-errors-title">
      <AlertCircle aria-hidden />
      <AlertTitle id="form-errors-title">{items.length === 1 ? "1 thing to fix before you can save" : `${items.length} things to fix before you can save`}</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {items.map((item) => {
            const label = labelOf(item.id);
            return (
              <li key={item.id}>
                <a href={`#${item.id}`} onClick={(e) => go(e, item.id)} className="underline underline-offset-2">
                  {label || item.id}
                </a>
                : {item.message}
              </li>
            );
          })}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/** react-hook-form's `errors` as summary items (top-level fields that have a message), in the order the fields are on the page. */
export function errorItems(errors: Record<string, unknown>): FormErrorItem[] {
  const items: FormErrorItem[] = [];
  for (const [id, value] of Object.entries(errors)) {
    const message = (value as { message?: unknown } | undefined)?.message;
    if (typeof message === "string" && message) items.push({ id, message });
  }
  return typeof document === "undefined"
    ? items
    : items.sort((a, b) => {
        const x = document.getElementById(a.id);
        const y = document.getElementById(b.id);
        return !x || !y ? 0 : x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
}
