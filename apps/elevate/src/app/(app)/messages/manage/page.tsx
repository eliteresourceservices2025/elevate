import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { ManageGroups } from "@/modules/messages/components/manage-groups";
import { listActiveClients, listGuests } from "@/modules/messages/guests";
import { listManagedGroups } from "@/modules/messages/queries";

export const metadata: Metadata = { title: "Manage groups" };

// HR Admins and Super Admins only: anyone else gets a 404 (the query refuses them). No loading.tsx: this route can call notFound().
export default async function Page() {
  await requireUser();
  const groups = await orNotFound(listManagedGroups());
  const [clients, { guests }] = await Promise.all([listActiveClients(), listGuests()]);
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Manage groups"
        description="Create, rename and delete group chats and channels, and choose who is in them."
        breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: "Manage groups" }]}
      />
      <ManageGroups groups={groups} timeZone={DEFAULT_TIMEZONE} clients={clients} guests={guests} />
    </PageContainer>
  );
}
