import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { InvitationsPanel } from "@/modules/settings/components/invitations-panel";
import { listInvitations } from "@/modules/settings/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Invitations" };

export default async function InvitationsPage() {
  const user = await requireUser();
  const invitations = await orNotFound(listInvitations()); // authorize("invitations.create") inside
  // Only a Super Admin chooses roles and the Safe Voice handler flag for an invitation (the action checks again).
  const canAssign = can(user, "settings.manage_roles") && can(user, "settings.set_safevoice_handler");
  const now = new Date().getTime();

  return (
    <PageContainer>
      <PageHeader title="Invitations" breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Invitations" }]} />
      <InvitationsPanel invitations={invitations} now={now} canAssign={canAssign} />
    </PageContainer>
  );
}
