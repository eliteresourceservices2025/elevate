"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AppHeader } from "./app-header";
import { SidebarNav } from "./sidebar-nav";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

type HeaderProps = Omit<ComponentProps<typeof AppHeader>, "collapsed" | "onToggleSidebar">;

/**
 * The frame of every signed-in page: the menu and the header stay put and only the content scrolls.
 * The menu can be narrowed to icons; the choice is a plain cookie so the server renders the right width at once.
 */
export function AppShell({ initialCollapsed, banner, children, ...header }: HeaderProps & { initialCollapsed: boolean; banner: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // The choice just will not be remembered.
    }
  }

  return (
    // "relative" makes this the containing block for the screen-reader-only text (absolutely positioned), so it cannot stretch the page.
    <div className="relative flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <aside
        className={cn(
          "hidden shrink-0 transition-[width] duration-200 motion-reduce:transition-none lg:block print:hidden",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <SidebarNav hidden={header.hiddenNav} safeVoiceUrl={header.safeVoiceUrl} collapsed={collapsed} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader {...header} collapsed={collapsed} onToggleSidebar={toggle} />
        <div className="flex-1 overflow-y-auto print:overflow-visible">
          {banner}
          <main id="main" className="p-4 sm:p-6 lg:p-8 print:p-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
