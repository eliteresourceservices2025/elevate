"use client";

import { useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/modules/notifications/components/notification-bell";
import type { ClockStatus } from "@/modules/attendance/queries";
import { AccountMenu } from "./account-menu";
import { ClockWidget } from "./clock-widget";
import { ThemeToggle } from "@/components/theme-toggle";
import type { PageEntry } from "@/modules/dashboard/search";
import { GlobalSearch } from "./global-search";
import { SidebarNav } from "./sidebar-nav";
import { ZoneClock } from "./zone-clock";

export function AppHeader({
  zone,
  email,
  accountName = null,
  roles = [],
  unread = 0,
  clock = null,
  hiddenNav = [],
  safeVoiceUrl = null,
  collapsed = false,
  onToggleSidebar,
  searchPages = [],
}: {
  searchPages?: PageEntry[];
  safeVoiceUrl?: string | null;
  hiddenNav?: string[];
  zone?: string | null;
  email?: string;
  accountName?: string | null;
  roles?: string[];
  unread?: number;
  clock?: ClockStatus | null;
  collapsed?: boolean;
  onToggleSidebar?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 sm:gap-3 sm:px-4 print:hidden">
      {onToggleSidebar ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden lg:inline-flex"
          onClick={onToggleSidebar}
          aria-label={collapsed ? "Show menu labels" : "Hide menu labels"}
          aria-expanded={!collapsed}
          aria-controls="main-nav"
          title={collapsed ? "Show menu labels" : "Hide menu labels"}
        >
          {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Open menu"
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "lg:hidden")}
        >
          <Menu aria-hidden />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="min-h-0 flex-1">
            <SidebarNav hidden={hiddenNav} safeVoiceUrl={safeVoiceUrl} onNavigate={() => setOpen(false)} />
          </div>
          {/* The theme buttons leave the header on a phone (no room) and live at the bottom of the menu instead */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-sidebar-foreground/15 bg-sidebar px-4 py-3 text-sm text-sidebar-foreground">
            <span>Theme</span>
            <ThemeToggle className="bg-card text-card-foreground" />
          </div>
        </SheetContent>
      </Sheet>
      <GlobalSearch pages={searchPages} />
      <div className="ml-auto lg:hidden" aria-hidden />
      <div className="ml-auto hidden items-center lg:flex">
        <ZoneClock zone={zone} />
      </div>
      <ThemeToggle className="hidden sm:flex" />
      {/* keyed by the count so a fresh server count resets the bell */}
      <NotificationBell key={unread} unread={unread} />
      <ClockWidget status={clock} />
      {/* The badge (initials) opens the account menu: profile, my data, the quick tour and Sign out, which asks first */}
      <AccountMenu name={accountName} email={email ?? ""} roles={roles} clocked={clock !== null && clock.state !== "out"} />
    </header>
  );
}
