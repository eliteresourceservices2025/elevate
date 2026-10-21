"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { LENS_COOKIE, LENS_LABELS, type Lens } from "../lens";

/**
 * Switches which dashboard widgets come first. It only changes the page's emphasis: permissions are the same in every view.
 * The choice is remembered in a plain cookie so the server shows it next time.
 */
export function LensTabs({ lenses, current }: { lenses: Lens[]; current: Lens }) {
  if (lenses.length < 2) return null;
  return (
    <nav aria-label="Dashboard view" className="-mb-px flex flex-wrap gap-5">
      {lenses.map((lens) => (
        <Link
          key={lens}
          href={`/dashboard?view=${lens}`}
          aria-current={lens === current ? "page" : undefined}
          onClick={() => {
            try {
              document.cookie = `${LENS_COOKIE}=${lens}; path=/; max-age=31536000; samesite=lax`;
            } catch {
              // Not remembered; the address still carries the choice.
            }
          }}
          className={cn(
            "border-b-2 py-2 text-sm font-medium outline-none transition-colors focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
            lens === current ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {/* eslint-disable-next-line security/detect-object-injection -- lens is a typed Lens */}
          {LENS_LABELS[lens]}
        </Link>
      ))}
    </nav>
  );
}
