import { AppHeader } from "@/components/shell/app-header";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { requireUser } from "@/lib/auth";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { countMyUnread } from "@/modules/notifications/queries";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // AAL2 or redirect. Pages and actions still call requireUser() and authorize() themselves.
  const user = await requireUser();
  const unread = await countMyUnread();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader zone={DEFAULT_TIMEZONE} email={user.email} unread={unread} />
        <main id="main" className="flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
