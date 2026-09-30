import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { InvitationsPanel } from "@/modules/settings/components/invitations-panel";
import { listInvitations } from "@/modules/settings/queries";

export const metadata: Metadata = { title: "Invitations" };

export default async function InvitationsPage() {
  const invitations = await orNotFound(listInvitations()); // authorize("invitations.create") inside
  const now = new Date().getTime();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Invitations</h1>
      </div>
      <InvitationsPanel invitations={invitations} now={now} />
    </div>
  );
}
