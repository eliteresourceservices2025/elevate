import { Markdown } from "@/components/markdown";
import { AppHeader } from "@/components/shell/app-header";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { scopeFor, type ActionName } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { AckBanner } from "@/modules/announcements/components/ack-display";
import { listMyPending } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";
import { getClockStatus } from "@/modules/attendance/queries";
import { countMyUnread } from "@/modules/notifications/queries";
import { PrivacyGate } from "@/modules/privacy/components/privacy-gate";
import { getPrivacyGate } from "@/modules/privacy/queries";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // AAL2 or redirect. Pages and actions still call requireUser() and authorize() themselves.
  const user = await requireUser();
  // Until the current privacy notice is accepted, nothing else in the app opens.
  const gate = await getPrivacyGate();
  if (gate) {
    return (
      <PrivacyGate versionId={gate.versionId} title={gate.title} version={gate.version} updated={gate.updated} changeNote={gate.changeNote}>
        <Markdown source={gate.body} />
      </PrivacyGate>
    );
  }
  const [unread, pending, clock] = await Promise.all([countMyUnread(), listMyPending(), getClockStatus()]);

  const hiddenNav = ALL_NAV_ITEMS.filter((i) => {
    if (!i.access) return false;
    const rules = Array.isArray(i.access) ? i.access : [i.access];
    return !rules.some((rule) => {
      const scope = scopeFor(user, rule.action as ActionName);
      return scope !== null && rule.scopes.includes(scope);
    });
  }).map((i) => i.href);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block print:hidden">
        <SidebarNav hidden={hiddenNav} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader hiddenNav={hiddenNav} zone={DEFAULT_TIMEZONE} email={user.email} unread={unread} clock={clock} />
        <AckBanner items={pending} today={todayInZone()} />
        <main id="main" className="flex-1 p-4 sm:p-6 lg:p-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
