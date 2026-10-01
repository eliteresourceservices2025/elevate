"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { NAV_GROUPS } from "@/lib/nav";

// The longest matching link wins, so "/people/me" does not also light up "/people".
function activeHref(pathname: string) {
  const matches = ALL_NAV_ITEMS.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function SidebarNav({ onNavigate, hidden = [] }: { onNavigate?: () => void; hidden?: string[] }) {
  const pathname = usePathname();
  const current = activeHref(pathname);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-5 py-5">
        <Image src="/elite-logo-icon.png" alt="" width={36} height={36} className="h-auto w-9 rounded-full bg-white p-0.5" />
        <div className="leading-tight">
          <p className="font-heading text-lg font-bold tracking-wide">ELEVATE</p>
          <p className="text-xs text-sidebar-foreground/70">Elite Resource Services</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.filter((i) => !hidden.includes(i.href)).map(({ href, label, icon: Icon }) => {
                const active = href === current;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
