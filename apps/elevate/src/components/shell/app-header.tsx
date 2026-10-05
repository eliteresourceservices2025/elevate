"use client";

import { useState } from "react";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { signOut } from "@/modules/auth/actions";
import { NotificationBell } from "@/modules/notifications/components/notification-bell";
import type { ClockStatus } from "@/modules/attendance/queries";
import { ClockWidget } from "./clock-widget";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarNav } from "./sidebar-nav";
import { ZoneClock } from "./zone-clock";

export function AppHeader({
  zone,
  email,
  unread = 0,
  clock = null,
  hiddenNav = [],
  safeVoiceUrl = null,
  collapsed = false,
  onToggleSidebar,
}: {
  safeVoiceUrl?: string | null;
  hiddenNav?: string[];
  zone?: string | null;
  email?: string;
  unread?: number;
  clock?: ClockStatus | null;
  collapsed?: boolean;
  onToggleSidebar?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 print:hidden">
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
          <SidebarNav hidden={hiddenNav} safeVoiceUrl={safeVoiceUrl} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="ml-auto hidden items-center md:flex">
        <ZoneClock zone={zone} />
      </div>
      <ThemeToggle />
      {/* keyed by the count so a fresh server count resets the bell */}
      <NotificationBell key={unread} unread={unread} />
      <ClockWidget status={clock} />
      <form action={signOut} className="flex items-center gap-2">
        {email ? <span className="hidden text-xs text-muted-foreground xl:inline">{email}</span> : null}
        <Button type="submit" variant="ghost" size="sm">
          <LogOut aria-hidden />
          Sign out
        </Button>
      </form>
    </header>
  );
}
