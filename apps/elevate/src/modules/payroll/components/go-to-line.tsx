"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

// "Go to this line": the sheet draws every person twice (a card for phones and a table row for wider screens) and hides one of them, so the
// two copies have different ids (`card-<id>` and `row-<id>`) and these helpers scroll to whichever one is showing. A link to another page of
// the run (`?page=2#line-<id>`) arrives with the id in the address; LineHashScroller finds the line once that page has loaded.

const FLASH_MS = 2600;

const showing = (el: HTMLElement | null): el is HTMLElement => el !== null && el.offsetParent !== null;

/** Scrolls the visible copy of a run line into the middle of the window, moves focus to it and flashes it. False when this page doesn't have it. */
export function scrollToLine(runLineId: string): boolean {
  const el = [document.getElementById(`row-${runLineId}`), document.getElementById(`card-${runLineId}`)].find(showing);
  if (!el) return false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  el.setAttribute("data-flash", "");
  window.setTimeout(() => el.removeAttribute("data-flash"), FLASH_MS);
  return true;
}

/** A link to a run line. On the same page it scrolls and flashes the line; for a line on another page it follows the link. */
export function GoToLine({ href, runLineId, className, children }: { href: string; runLineId: string; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (scrollToLine(runLineId)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </Link>
  );
}

/**
 * When the address has #line-<id> (a link to a line on another page of the run), scrolls to that line once it is drawn. Moving between pages
 * of the same run keeps this component mounted, so it runs again whenever the page or the filter in the address changes.
 */
export function LineHashScroller() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const go = () => {
      const match = /^#line-([0-9a-f-]{36})$/i.exec(window.location.hash);
      if (match) scrollToLine(match[1]);
    };
    const timer = window.setTimeout(go, 50); // after the first paint, so the rows are in place
    window.addEventListener("hashchange", go);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", go);
    };
  }, [pathname, search]);
  return null;
}
