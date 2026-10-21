import type { Metadata } from "next";
import { clientTimeZones } from "@/lib/client-time-zones";
import { orNotFound } from "@/lib/or-not-found";
import { ClientRow, NewClientForm } from "@/modules/people/components/admin-forms";
import { listClients } from "@/modules/people/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const clients = await orNotFound(listClients());
  const timeZones = clientTimeZones(Intl.supportedValuesOf("timeZone"), clients.map((client) => client.timeZone));

  return (
    <PageContainer>
      <PageHeader
        title="Clients"
        description="The companies ERS people work for. Only the name and time zone are stored here, and never any patient or customer information."
        breadcrumbs={[{ label: "People", href: "/people" }, { label: "Clients" }]}
      />
      <NewClientForm timeZones={timeZones} />
      <ul className="divide-y rounded-xl border bg-card px-4">
        {clients.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No clients yet.</li> : null}
        {clients.map((c) => (
          <li key={c.id} className="py-3">
            <ClientRow client={{ id: c.id, name: c.name, timeZone: c.timeZone, holidayCalendar: c.holidayCalendar === "PH" ? "PH" : "US", isActive: c.isActive, handlesPhi: c.handlesPhi }} timeZones={timeZones} />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
