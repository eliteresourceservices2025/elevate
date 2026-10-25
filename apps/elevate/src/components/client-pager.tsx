"use client";

import { useState } from "react";
import { PAGE_SIZES, DEFAULT_PAGE_SIZE, paginate, type PageInfo } from "@/lib/pagination";
import { PAGER_BUTTON, PAGER_OFF, sizeChip } from "./pager-style";

/** State for a list that is already in the browser (filtering happens first, then this cuts one page). Changing `resetKey` (say, the filter text) goes back to page 1. */
export function usePaged<T>(rows: readonly T[], resetKey: string = "", defaultSize: number = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultSize);
  // Going back to page 1 when the filter changes is done while rendering (React discards this render and redoes it).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setPage(1);
  }
  const { rows: pageRows, info } = paginate(rows, page, pageSize);
  return { rows: pageRows, info, setPage, setPageSize: (n: number) => { setPageSize(n); setPage(1); } };
}

export function ClientPager({ info, onPage, onSize, label = "rows" }: { info: PageInfo; onPage: (p: number) => void; onSize: (n: number) => void; label?: string }) {
  if (info.total <= PAGE_SIZES[0]) return <p className="text-xs text-muted-foreground">{info.total} {label}</p>;
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">
        Showing {info.from} to {info.to} of {info.total} {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Per page</span>
        {PAGE_SIZES.map((n) => (
          <button key={n} type="button" aria-current={n === info.pageSize ? "true" : undefined} className={sizeChip(n === info.pageSize)} onClick={() => onSize(n)}>
            {n}
          </button>
        ))}
        {info.page > 1 ? (
          <button type="button" className={PAGER_BUTTON} aria-label="Previous page" onClick={() => onPage(info.page - 1)}>
            Previous
          </button>
        ) : (
          <span className={PAGER_OFF} aria-hidden>
            Previous
          </span>
        )}
        <span>Page {info.page} of {info.pages}</span>
        {info.page < info.pages ? (
          <button type="button" className={PAGER_BUTTON} aria-label="Next page" onClick={() => onPage(info.page + 1)}>
            Next
          </button>
        ) : (
          <span className={PAGER_OFF} aria-hidden>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
