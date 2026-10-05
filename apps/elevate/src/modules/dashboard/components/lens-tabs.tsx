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
    <nav aria-label="Dashboard view" className="flex flex-wrap gap-1 rounded-xl border bg-card p-1">
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
            "rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            lens === current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          {/* eslint-disable-next-line security/detect-object-injection -- lens is a typed Lens */}
          {LENS_LABELS[lens]}
        </Link>
      ))}
    </nav>
  );
}
