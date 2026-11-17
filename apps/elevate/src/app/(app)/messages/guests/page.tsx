import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { GuestsPanel } from "@/modules/messages/components/guest-admin";
import { listActiveClients, listGuests } from "@/modules/messages/guests";

export const metadata: Metadata = { title: "Client guests" };

// HR Admins and Super Admins only: anyone else gets a 404. No loading.tsx: this route can call notFound().
export default async function Page() {
  const user = await requireUser();
  await orNotFound(authorize(user, "messages.invite_guests"));
  const [{ guests, pending }, clients] = await Promise.all([listGuests(), listActiveClients()]);
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Client guests"
        description="Invite a client's people to chat with your team about attendance. Guests see Messages only."
        breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: "Client guests" }]}
      />
      <GuestsPanel guests={guests} pending={pending} clients={clients} timeZone={DEFAULT_TIMEZONE} />
    </PageContainer>
  );
}
