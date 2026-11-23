import type { Metadata } from "next";
import { clientTimeZones } from "@/lib/client-time-zones";
import { orNotFound } from "@/lib/or-not-found";
import { ClientProjects, ClientRow, NewClientForm } from "@/modules/people/components/admin-forms";
import { listClientProjectPeopleForAdmin, listClientProjectsForAdmin, listClients } from "@/modules/people/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const [clients, projects, projectPeople] = await orNotFound(Promise.all([listClients(), listClientProjectsForAdmin(), listClientProjectPeopleForAdmin()]));
  const timeZones = clientTimeZones(Intl.supportedValuesOf("timeZone"), clients.map((client) => client.timeZone));

  return (
    <PageContainer>
      <PageHeader
        title="Clients"
        description="The companies ERS people work for, and their projects. Only names and the time zone are stored here, never any patient or customer information. A person who works for two or more clients picks the client or project on the clock."
        breadcrumbs={[{ label: "People", href: "/people" }, { label: "Clients" }]}
      />
      <NewClientForm timeZones={timeZones} />
      <ul className="divide-y rounded-xl border bg-card px-4">
        {clients.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No clients yet.</li> : null}
        {clients.map((c) => (
          <li key={c.id} className="py-3">
            <ClientRow client={{ id: c.id, name: c.name, timeZone: c.timeZone, holidayCalendar: c.holidayCalendar === "PH" ? "PH" : "US", isActive: c.isActive, handlesPhi: c.handlesPhi }} timeZones={timeZones} />
            <ClientProjects clientId={c.id} projects={projects.filter((p) => p.clientId === c.id).map((p) => ({ id: p.id, name: p.name }))} people={projectPeople.clientPeople[c.id] ?? []} members={projectPeople.members} />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
