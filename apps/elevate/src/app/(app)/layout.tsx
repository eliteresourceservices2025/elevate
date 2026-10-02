import { Markdown } from "@/components/markdown";
import { AppHeader } from "@/components/shell/app-header";
import { SidebarNav } from "@/components/shell/sidebar-nav";

import { requireUser } from "@/lib/auth";
import { hiddenNavFor } from "@/lib/nav-access";
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

  const hiddenNav = hiddenNavFor(user);
  // The anonymous reporting site is a separate app on its own address. Not set in production = no link (nothing to point at).
  const safeVoiceUrl = process.env.NEXT_PUBLIC_SAFEVOICE_URL || (process.env.NODE_ENV === "production" ? null : "http://localhost:3100");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block print:hidden">
        <SidebarNav hidden={hiddenNav} safeVoiceUrl={safeVoiceUrl} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader hiddenNav={hiddenNav} safeVoiceUrl={safeVoiceUrl} zone={DEFAULT_TIMEZONE} email={user.email} unread={unread} clock={clock} />
        <AckBanner items={pending} today={todayInZone()} />
        <main id="main" className="flex-1 p-4 sm:p-6 lg:p-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
