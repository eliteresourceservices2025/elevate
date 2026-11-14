import Link from "next/link";
import { cn } from "@/lib/utils";

// The row of views above a list: "All (12) | Live (3) | Void (1)". The current one is bold and marked for a screen reader; a view with
// nothing in it is left out unless it is the current one. Plain links, so the view is in the address and the back button works.

export type ViewLink = { key: string; label: string; count: number; href: string; active: boolean; /** Keep the link even when it is empty. */ always?: boolean };

export function ViewLinks({ label, items }: { label: string; items: ViewLink[] }) {
  const shown = items.filter((i) => i.count > 0 || i.active || i.always);
  return (
    <nav aria-label={label} className="text-sm">
      <ul className="flex flex-wrap items-center gap-y-1">
        {shown.map((i, index) => (
          <li key={i.key} className="inline-flex items-center">
            {index > 0 ? (
              <span aria-hidden className="mx-2 text-muted-foreground">
                |
              </span>
            ) : null}
            <Link
              href={i.href}
              aria-current={i.active ? "page" : undefined}
              className={cn("inline-flex min-h-8 items-center pointer-coarse:min-h-11", i.active ? "font-semibold text-foreground" : "text-primary underline-offset-2 hover:underline")}
            >
              {i.label}
              <span className="ml-1 font-normal tabular-nums text-muted-foreground">({i.count})</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
