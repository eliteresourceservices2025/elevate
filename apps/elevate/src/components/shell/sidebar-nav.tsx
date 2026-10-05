"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { NAV_GROUPS } from "@/lib/nav";

// The longest matching link wins, so "/people/me" does not also light up "/people".
function activeHref(pathname: string) {
  const matches = ALL_NAV_ITEMS.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** `collapsed` narrows the menu to its icons (desktop only; each icon keeps its name for screen readers and as a hover tip). */
export function SidebarNav({ onNavigate, hidden = [], safeVoiceUrl = null, collapsed = false }: { onNavigate?: () => void; hidden?: string[]; safeVoiceUrl?: string | null; collapsed?: boolean }) {
  const pathname = usePathname();
  const current = activeHref(pathname);

  const groupLabel = "px-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-sidebar-foreground/75";
  const linkBase = "flex items-center rounded-lg text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring";
  const linkSize = collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-2.5 py-2";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      <div className={cn("flex shrink-0 items-center gap-3 py-5", collapsed ? "justify-center px-0" : "px-5")}>
        <Image src="/elite-logo-icon.png" alt="" width={36} height={36} className="h-auto w-9 shrink-0 rounded-full bg-white p-0.5" />
        {collapsed ? (
          <span className="sr-only">ELEVATE, Elite Resource Services</span>
        ) : (
          <div className="leading-tight">
            <p className="font-heading text-lg font-bold tracking-wide">ELEVATE</p>
            <p className="text-xs text-sidebar-foreground/80">Elite Resource Services</p>
          </div>
        )}
      </div>
      <nav id="main-nav" aria-label="Main" className={cn("flex-1 space-y-5 overflow-y-auto overflow-x-hidden pb-6", collapsed ? "px-2" : "px-3")}>
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label}>
            {collapsed ? (
              // A thin line stands in for the group name; the name stays available to screen readers.
              <>
                <p className="sr-only">{group.label}</p>
                {index > 0 ? <div aria-hidden className="mx-2 mb-2 border-t border-sidebar-foreground/15" /> : null}
              </>
            ) : (
              <p className={groupLabel}>{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.filter((i) => !hidden.includes(i.href)).map(({ href, label, icon: Icon }) => {
                const active = href === current;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? label : undefined}
                      className={cn(
                        linkBase,
                        linkSize,
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60",
                      )}
                    >
                      <Icon className={cn("shrink-0", collapsed ? "size-5" : "size-4")} aria-hidden />
                      {collapsed ? <span className="sr-only">{label}</span> : label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {safeVoiceUrl ? (
          <div>
            {collapsed ? (
              <>
                <p className="sr-only">Speak up</p>
                <div aria-hidden className="mx-2 mb-2 border-t border-sidebar-foreground/15" />
              </>
            ) : (
              <p className={groupLabel}>Speak up</p>
            )}
            {/* An ordinary link to a separate site: no referrer is sent, so the anonymous page never learns it came from ELEVATE */}
            <a
              href={safeVoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={collapsed ? "Report a concern (anonymous)" : undefined}
              className={cn(linkBase, linkSize, "text-sidebar-foreground/85 hover:bg-sidebar-accent/60")}
            >
              <ShieldQuestion className={cn("shrink-0", collapsed ? "size-5" : "size-4")} aria-hidden />
              {collapsed ? null : "Report a concern"}
              <span className="sr-only"> anonymously (Safe Voice, opens a separate site)</span>
            </a>
            {collapsed ? null : <p className="px-2.5 pt-1 text-xs text-sidebar-foreground/80">Anonymous: no sign-in, nothing links it to you.</p>}
          </div>
        ) : null}
      </nav>
    </div>
  );
}
