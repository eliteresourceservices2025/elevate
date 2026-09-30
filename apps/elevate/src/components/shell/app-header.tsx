"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClockWidget } from "./clock-widget";
import { SidebarNav } from "./sidebar-nav";
import { ZoneClock } from "./zone-clock";

export function AppHeader({ zone }: { zone?: string | null }) {
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
    </header>
  );
}
