import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { AppShell } from "@/components/shell/app-shell";
import { SIDEBAR_COOKIE } from "@/components/shell/sidebar-cookie";

import { requireUser } from "@/lib/auth";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { hiddenNavFor } from "@/lib/nav-access";
import { withTimeout } from "@/modules/dashboard/timeout";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { AckBanner } from "@/modules/announcements/components/ack-display";
import { listMyPending } from "@/modules/announcements/queries";
import { listMyPopups } from "@/modules/announcements/popup-queries";
import type { PopupItem } from "@/modules/announcements/components/popup-queue";
import { dueState } from "@/modules/announcements/due";
import { todayInZone } from "@/modules/org/service";
import { getClockStatus } from "@/modules/attendance/queries";
import { countMyUnread } from "@/modules/notifications/queries";
import { getMyDisplayName } from "@/modules/people/queries";
import { tourStartsByItself } from "@/modules/dashboard/tour";
import { getMyPhotoVersion } from "@/modules/people/photo-queries";
import { roleLabel } from "@/lib/roles";
import { PrivacyGate } from "@/modules/privacy/components/privacy-gate";
import { getPrivacyGate } from "@/modules/privacy/queries";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // AAL2 or redirect. Pages and actions still call requireUser() and authorize() themselves.
  const user = await requireUser();
  // Until the current privacy notice is accepted, nothing else in the app opens.
  // One round of reads, not two: the gate is checked alongside what the page needs, and only decides whether to show it.
  // The bell count and the acknowledgment banner are nice to have: if they are slow or fail, the page still opens without them.
  const optional = <T,>(read: Promise<T>, fallback: T) => withTimeout(read, 8_000).catch((error: unknown) => {
    unstable_rethrow(error);
    console.error("layout read skipped:", error instanceof Error ? error.name : "unknown error");
    return fallback;
  });
  const [gate, unread, pending, clock, accountName, tourAutoStart, photoVersion, queued] = await Promise.all([getPrivacyGate(), optional(countMyUnread(), 0), optional(listMyPending(), []), getClockStatus(), optional(getMyDisplayName(), null), optional(tourStartsByItself(), false), optional(getMyPhotoVersion(), null), optional(listMyPopups(), [])]);
  if (gate) {
    return (
      <PrivacyGate versionId={gate.versionId} title={gate.title} updated={gate.updated} changeNote={gate.changeNote}>
        <Markdown source={gate.body} />
      </PrivacyGate>
    );
  }

  const today = todayInZone();
  // Queued announcements and policies, shown before the page (the text is rendered here, on the server).
  const popups: PopupItem[] = queued.map((p) => {
    const due = p.requiresAck && p.dueOn ? dueState(p.dueOn, today) : "none";
    return {
      subjectId: p.subjectId,
      kind: p.kind,
      title: p.title,
      requiresAck: p.requiresAck,
      dueText: p.requiresAck && p.dueOn ? (due === "overdue" ? `was due ${p.dueOn}` : `due ${p.dueOn}`) : null,
      version: p.version,
      link: p.link,
      content: <Markdown source={p.body} />,
    };
  });

  const hiddenNav = hiddenNavFor(user);
  // The anonymous reporting site is a separate app on its own address. Not set in production = no link (nothing to point at).
  const safeVoiceUrl = process.env.NEXT_PUBLIC_SAFEVOICE_URL || (process.env.NODE_ENV === "production" ? null : "http://localhost:3100");

  const initialCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <AppShell
      initialCollapsed={initialCollapsed}
      tourAutoStart={tourAutoStart}
      popups={popups}
      hiddenNav={hiddenNav}
      searchPages={ALL_NAV_ITEMS.filter((i) => !hiddenNav.includes(i.href)).map((i) => ({ href: i.href, label: i.label, description: i.description }))}
      safeVoiceUrl={safeVoiceUrl}
      zone={DEFAULT_TIMEZONE}
      email={user.email}
      accountName={accountName}
      userId={user.id}
      photoVersion={photoVersion}
      roles={user.roles.filter((r) => r !== "employee").map(roleLabel)}
      unread={unread}
      clock={clock}
      banner={<AckBanner items={pending} today={today} />}
    >
      {children}
    </AppShell>
  );
}
