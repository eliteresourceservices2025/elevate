import Link from "next/link";
import { PAGE_SIZES, type PageInfo } from "@/lib/pagination";
import { cn } from "@/lib/utils";

const linkClass = "rounded-lg border px-3 py-1 text-sm hover:bg-secondary/50";
const off = "pointer-events-none rounded-lg border px-3 py-1 text-sm text-muted-foreground opacity-50";

/**
 * Pager for server-rendered lists. Page and size live in the address, under names that can be changed
 * (`pageKey`, `sizeKey`) so a page with two lists keeps them apart. `query` carries every other address value.
 */
export function PagerLinks({ info, basePath, query = {}, pageKey = "page", sizeKey = "size", label = "rows", defaultSize = 25 }: { defaultSize?: number; info: PageInfo; basePath: string; query?: Record<string, string | undefined>; pageKey?: string; sizeKey?: string; label?: string }) {
  if (info.total <= PAGE_SIZES[0]) return <p className="text-xs text-muted-foreground">{info.total} {label}</p>;
  const href = (page: number, size = info.pageSize) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "" && k !== pageKey && k !== sizeKey) q.set(k, v);
    if (page > 1) q.set(pageKey, String(page));
    if (size !== defaultSize) q.set(sizeKey, String(size));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">
        Showing {info.from} to {info.to} of {info.total} {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Per page</span>
        {PAGE_SIZES.map((s) => (
          <Link key={s} href={href(1, s)} aria-current={s === info.pageSize ? "true" : undefined} className={cn("rounded-md px-2 py-0.5 text-xs", s === info.pageSize ? "bg-primary text-primary-foreground" : "hover:bg-secondary/50")}>
            {s}
          </Link>
        ))}
        {info.page > 1 ? (
          <Link href={href(info.page - 1)} className={linkClass} aria-label="Previous page">
            Previous
          </Link>
        ) : (
          <span className={off} aria-hidden>Previous</span>
        )}
        <span>Page {info.page} of {info.pages}</span>
        {info.page < info.pages ? (
          <Link href={href(info.page + 1)} className={linkClass} aria-label="Next page">
            Next
          </Link>
        ) : (
          <span className={off} aria-hidden>Next</span>
        )}
      </div>
    </nav>
  );
}
