import { AppHeader } from "@/components/shell/app-header";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { DEFAULT_TIMEZONE } from "@/lib/time";

// Phase 0.2 adds requireUser() (AAL2) here; until then this shell is unauthenticated placeholder UI.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader zone={DEFAULT_TIMEZONE} />
        <main id="main" className="flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
