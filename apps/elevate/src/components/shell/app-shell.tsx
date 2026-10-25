"use client";

import { Suspense, useCallback, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { UnsavedChangesProvider } from "@/components/unsaved-changes";
import { PopupQueue, type PopupItem } from "@/modules/announcements/components/popup-queue";
import { AppHeader } from "./app-header";
import { QuickTour } from "./quick-tour";
import { SidebarNav } from "./sidebar-nav";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

type HeaderProps = Omit<ComponentProps<typeof AppHeader>, "collapsed" | "onToggleSidebar">;

/**
 * The frame of every signed-in page: the menu and the header stay put and only the content scrolls.
 * The menu can be narrowed to icons; the choice is a plain cookie so the server renders the right width at once.
 */
export function AppShell({ initialCollapsed, tourAutoStart = false, popups = [], banner, children, ...header }: HeaderProps & { initialCollapsed: boolean; tourAutoStart?: boolean; popups?: PopupItem[]; banner: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // Queued announcements and policies come first; the quick tour waits until they are closed or acknowledged.
  const [popupsDone, setPopupsDone] = useState(popups.length === 0);
  const onPopupsDone = useCallback(() => setPopupsDone(true), []);

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
      {/* Skip link: first stop for keyboard users. Fixed, not absolute, so focusing it can never scroll the shell. */}
      <a
        href="#main"
        className="fixed top-2 left-2 z-[100] -translate-y-20 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg focus:translate-y-0 focus-visible:ring-3 focus-visible:ring-ring/50 print:hidden"
      >
        Skip to content
      </a>
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
        <div className="flex-1 scroll-smooth overflow-y-auto motion-reduce:scroll-auto print:overflow-visible">
          {banner}
          {/* Side padding: 16px on a phone, 40px on a tablet or laptop, 48px on a large screen. Pages fill the width between. */}
          <ConfirmProvider>
            <UnsavedChangesProvider>
              <main id="main" tabIndex={-1} className="px-4 py-5 md:px-10 md:py-6 2xl:px-12 print:p-0 focus:outline-none">
                {children}
              </main>
            </UnsavedChangesProvider>
          </ConfirmProvider>
        </div>
      </div>
      <Suspense fallback={null}>
        <QuickTour autoStart={tourAutoStart && popupsDone} />
      </Suspense>
      {popups.length > 0 ? <PopupQueue items={popups} onDone={onPopupsDone} /> : null}
    </div>
  );
}
