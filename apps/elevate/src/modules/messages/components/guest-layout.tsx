import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { signOut } from "@/modules/auth/actions";
import { GUEST_NOTICE_BODY, GUEST_NOTICE_TITLE, guestStatus } from "../guests";
import { GuestCallFrame } from "@/modules/calls/components/guest-call-frame";
import { GuestNoticeGate } from "./guest-notice-gate";

/**
 * What a client guest sees instead of the staff shell: the guest notice until it is accepted, then a plain frame around Messages.
 * No menu, search, clock or notifications. Every other page is a 404 for a guest (requireUser turns them away), so the frame holds
 * only Messages. A guest whose access ended is signed out by requireUser before this runs.
 */
export async function GuestLayout({ userId, email, children }: { userId: string; email: string; children: ReactNode }) {
  const status = await guestStatus(userId);
  if (!status.noticeAccepted) {
    return (
      <GuestNoticeGate title={GUEST_NOTICE_TITLE} clientName={status.clientName}>
        <Markdown source={GUEST_NOTICE_BODY} />
      </GuestNoticeGate>
    );
  }
  return (
    <GuestCallFrame userId={userId}>
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <span className="font-heading text-base font-bold text-primary">ELEVATE</span>
        <span className="text-sm text-muted-foreground">Messages{status.clientName ? ` · ${status.clientName}` : ""}</span>
        <span className="ml-auto hidden text-sm text-muted-foreground sm:inline">{email}</span>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            <LogOut aria-hidden /> Sign out
          </Button>
        </form>
      </header>
      <main id="main" className="min-h-0 flex-1 px-4 py-4">
        {children}
      </main>
    </div>
    </GuestCallFrame>
  );
}
