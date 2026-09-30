"use client";

import { useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { signOut } from "@/modules/auth/actions";
import { ClockWidget } from "./clock-widget";
import { SidebarNav } from "./sidebar-nav";
import { ZoneClock } from "./zone-clock";

export function AppHeader({ zone, email }: { zone?: string | null; email?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Open menu"
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "lg:hidden")}
        >
          <Menu aria-hidden />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="ml-auto hidden items-center md:flex">
        <ZoneClock zone={zone} />
      </div>
      <ClockWidget />
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
