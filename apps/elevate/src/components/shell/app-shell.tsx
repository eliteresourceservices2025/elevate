"use client";

import { Suspense, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { UnsavedChangesProvider } from "@/components/unsaved-changes";
import { AppHeader } from "./app-header";
import { QuickTour } from "./quick-tour";
import { SidebarNav } from "./sidebar-nav";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

type HeaderProps = Omit<ComponentProps<typeof AppHeader>, "collapsed" | "onToggleSidebar">;

/**
 * The frame of every signed-in page: the menu and the header stay put and only the content scrolls.
 * The menu can be narrowed to icons; the choice is a plain cookie so the server renders the right width at once.
 */
export function AppShell({ initialCollapsed, tourAutoStart = false, banner, children, ...header }: HeaderProps & { initialCollapsed: boolean; tourAutoStart?: boolean; banner: ReactNode; children: ReactNode }) {
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
    // "overflow-clip", not "overflow-hidden": a hidden box can still be scrolled by the browser itself (focusing a field, scrolling a
    // link into view, a route change), which pushed the header and the top of the menu out of sight until a refresh. A clipped box
    // cannot scroll at all, so only the content area below ever moves.
    <div data-app-shell className="relative flex h-dvh overflow-clip print:block print:h-auto print:overflow-visible">
      <aside
        data-tour="menu"
        className={cn(
          "hidden shrink-0 transition-[width] duration-200 motion-reduce:transition-none lg:block print:hidden",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <SidebarNav hidden={header.hiddenNav} safeVoiceUrl={header.safeVoiceUrl} collapsed={collapsed} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip">
        <AppHeader {...header} collapsed={collapsed} onToggleSidebar={toggle} />
        <div className="flex-1 overflow-y-auto print:overflow-visible">
          {banner}
          {/* Side padding: 16px on a phone, 40px on a tablet or laptop, 48px on a large screen. Pages fill the width between. */}
          <UnsavedChangesProvider>
            <main id="main" className="px-4 py-5 md:px-10 md:py-6 2xl:px-12 print:p-0">
              {children}
            </main>
          </UnsavedChangesProvider>
        </div>
      </div>
      <Suspense fallback={null}>
        <QuickTour autoStart={tourAutoStart} />
      </Suspense>
    </div>
  );
}
